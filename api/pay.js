// HQ -> Payments (DS Elite): the screen's API. POST { action, ... } with the
// signed-in admin's Supabase token (or the service role key, for scripts).
// The pieces are in api/_lib/payments.js and api/_lib/stripe.js.
//
//   status                         is Stripe connected, to which account
//   connect {key}                  check a Stripe secret key, set up the webhook, save
//   requests                       every request with its totals
//   request {id}                   one request and its families
//   create {title, description?, unit_amount, unit_label?, allow_qty_change?, max_qty?, due_date?, source?}
//   update {id, ...same + email_subject?, email_body?, sms_body?, status?}
//   import_ncaa {id}               add every family that said yes on the NCAA form
//   add_family {id, player_id, qty?}
//   item_update {item_id, qty?, note?}       only while unpaid
//   mark_paid {item_id, method, qty?, note?} cash / Venmo / check / other
//   mark_unpaid {item_id}          undo a hand-recorded payment
//   cancel {item_id} · restore {item_id}
//   refund {item_id, amount_cents?}           a card payment, through Stripe (full by default)
//   preview {id, item_id?}         the email and text one family would get
//   send {id, item_ids?, email?, text?, remind?}   email / text the links (unpaid families)
//   players                        names for "Add a family"
import { createClient } from "@supabase/supabase-js";
import { stripe, stripeKey, connectStripe, stripeStatus } from "./_lib/stripe.js";
import { usd, payLink, familyOf, messagesFor, defaults, importNcaa, addFamily } from "./_lib/payments.js";

export const config = { maxDuration: 300 };
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const APP = (process.env.DSE_PUBLIC_BASE || "https://dseliteevals.vercel.app").replace(/\/+$/, "");
const nowIso = () => new Date().toISOString();
const OWNERS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
// Drew and approved DS Elite admins only (the same rule as HQ -> Social).
async function verifyAdmin(sb, req) {
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return { error: "Sign in first", status: 401 };
  if (bearer === process.env.SUPABASE_SERVICE_ROLE_KEY) return { me: "drew@dselitevolleyball.com", name: "Drew" };
  const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
  const me = String(user?.email || "").trim().toLowerCase();
  if (!me) return { error: "Sign in first", status: 401 };
  if (OWNERS.includes(me)) return { me, name: "Drew" };
  const { data: c } = await sb.from("coaches").select("display_name, is_admin, is_approved").ilike("email", me).maybeSingle();
  if (!(c?.is_approved && c?.is_admin)) return { error: "Payments are for DS Elite admins", status: 403 };
  return { me, name: c.display_name || me };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const who = await verifyAdmin(sb, req);
  if (who.error) return res.status(who.status).json({ error: who.error });
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  try { return res.status(200).json({ ok: true, ...(await run(sb, who, b || {})) }); }
  catch (e) { console.error("pay", b?.action, e); return res.status(e.status || 500).json({ error: e.message || String(e) }); }
}

const cents = (v) => { const n = Math.round(Number(String(v ?? "").replace(/[$,\s]/g, "")) * 100); if (!Number.isFinite(n) || n < 50) throw fail(400, "Enter a price of at least $0.50"); return n; };
async function getRequest(sb, id) {
  const { data } = await sb.from("pay_requests").select("*").eq("id", Number(id)).maybeSingle();
  if (!data) throw fail(404, "No such payment request");
  return data;
}
async function getItem(sb, id) {
  const { data } = await sb.from("pay_items").select("*").eq("id", Number(id)).maybeSingle();
  if (!data) throw fail(404, "No such family on this list");
  return data;
}
const totals = (items) => {
  const t = { families: 0, paid: 0, pending: 0, unpaid: 0, canceled: 0, refunded: 0, collected_cents: 0, qty_paid: 0, qty_open: 0 };
  for (const i of items) {
    t[i.status] = (t[i.status] || 0) + 1;
    if (i.status !== "canceled") t.families++;
    if (i.status === "paid" || i.status === "pending") { t.collected_cents += (i.paid_cents || 0) - (i.refunded_cents || 0); t.qty_paid += i.paid_qty || i.qty; }
    if (i.status === "unpaid") t.qty_open += i.qty;
  }
  return t;
};
// Through the app's own senders, so mail and texts land in the usual history.
async function sendEmail(to, subject, body, by) {
  const r = await fetch(APP + "/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject, body, recipients: to, replyTo: "drew@dselitevolleyball.com", sentBy: by, sentByEmail: "drew@dselitevolleyball.com", source: "payments" }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || "email HTTP " + r.status);
  return j;
}
async function sendText(phones, body, audience, by) {
  const r = await fetch(APP + "/api/send-sms", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY },
    body: JSON.stringify({ body, audience, recipients: phones, sent_by_label: by }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error || !j.sent) throw new Error(j.error || (j.failed || []).map(f => f.error).join("; ") || "text HTTP " + r.status);
  return j;
}

export async function run(sb, { me, name }, b) {
  const by = String(name || me).split(/[\s@]/)[0];
  switch (b.action) {
    case "status": return { stripe: await stripeStatus(sb) };
    case "connect": return { stripe: { ...(await connectStripe(sb, b.key, me)), connected: true } };
    case "requests": {
      const [{ data: reqs }, { data: items }] = await Promise.all([
        sb.from("pay_requests").select("*").order("created_at", { ascending: false }),
        sb.from("pay_items").select("request_id, status, qty, paid_qty, paid_cents, refunded_cents"),
      ]);
      return { requests: (reqs || []).map(r => ({ ...r, totals: totals((items || []).filter(i => i.request_id === r.id)) })) };
    }
    case "request": {
      const r = await getRequest(sb, b.id);
      const { data: items } = await sb.from("pay_items").select("*").eq("request_id", r.id).order("family_label");
      return { request: { ...r, defaults: defaults(r), totals: totals(items || []) }, items: (items || []).map(i => ({ ...i, link: payLink(i) })) };
    }
    case "create": {
      const title = String(b.title || "").trim().slice(0, 140);
      if (!title) throw fail(400, "Give it a name");
      const row = { title, description: String(b.description || "").trim().slice(0, 1500) || null, unit_amount_cents: cents(b.unit_amount), unit_label: String(b.unit_label || "ticket").trim().slice(0, 30) || "ticket",
        allow_qty_change: b.allow_qty_change !== false, max_qty: Math.max(1, Math.min(99, Number(b.max_qty) || 30)), due_date: /^\d{4}-\d{2}-\d{2}$/.test(b.due_date || "") ? b.due_date : null,
        source: ["ncaa"].includes(b.source) ? b.source : null, created_by: me };
      const { data, error } = await sb.from("pay_requests").insert(row).select().single();
      if (error) throw fail(500, error.message);
      const imported = data.source === "ncaa" ? await importNcaa(sb, data.id) : null;
      return { request: data, imported };
    }
    case "update": {
      const r = await getRequest(sb, b.id);
      const patch = { updated_at: nowIso() };
      if (typeof b.title === "string" && b.title.trim()) patch.title = b.title.trim().slice(0, 140);
      if (typeof b.description === "string") patch.description = b.description.trim().slice(0, 1500) || null;
      if (b.unit_amount !== undefined) {
        const { count } = await sb.from("pay_items").select("id", { count: "exact", head: true }).eq("request_id", r.id).in("status", ["paid", "pending"]);
        const c = cents(b.unit_amount);
        if (count && c !== r.unit_amount_cents) throw fail(400, "Families have already paid at the current price - make a new request for a different price");
        patch.unit_amount_cents = c;
      }
      if (typeof b.unit_label === "string" && b.unit_label.trim()) patch.unit_label = b.unit_label.trim().slice(0, 30);
      if (typeof b.allow_qty_change === "boolean") patch.allow_qty_change = b.allow_qty_change;
      if (b.max_qty !== undefined) patch.max_qty = Math.max(1, Math.min(99, Number(b.max_qty) || 30));
      if (b.due_date !== undefined) patch.due_date = /^\d{4}-\d{2}-\d{2}$/.test(b.due_date || "") ? b.due_date : null;
      for (const k of ["email_subject", "email_body", "sms_body"]) if (typeof b[k] === "string") patch[k] = b[k].trim() || null;
      if (["open", "closed"].includes(b.status)) patch.status = b.status;
      const { data, error } = await sb.from("pay_requests").update(patch).eq("id", r.id).select().single();
      if (error) throw fail(500, error.message);
      return { request: data };
    }
    case "import_ncaa": await getRequest(sb, b.id); return await importNcaa(sb, Number(b.id));
    case "add_family": await getRequest(sb, b.id); return await addFamily(sb, Number(b.id), b.player_id, b.qty);
    case "players": {
      const { data } = await sb.from("players").select("id, first_name, last_name, team_assignment").not("team_assignment", "is", null).order("last_name");
      return { players: (data || []).map(p => ({ id: p.id, name: `${p.first_name} ${p.last_name}`, team: String(p.team_assignment || "").replace(/^(\d+ Rise) 1$/, "$1") })) };
    }
    case "item_update": {
      const it = await getItem(sb, b.item_id);
      const patch = { updated_at: nowIso() };
      if (b.qty !== undefined) { if (it.status !== "unpaid") throw fail(400, "Only an unpaid family's number can change"); patch.qty = Math.max(1, Math.min(99, Number(b.qty) || 1)); }
      if (typeof b.note === "string") patch.note = b.note.trim().slice(0, 500) || null;
      const { data, error } = await sb.from("pay_items").update(patch).eq("id", it.id).select().single();
      if (error) throw fail(500, error.message);
      return { item: data };
    }
    case "mark_paid": {
      const it = await getItem(sb, b.item_id);
      const r = await getRequest(sb, it.request_id);
      if (["paid", "pending"].includes(it.status)) throw fail(400, "It's already paid");
      const method = ["cash", "venmo", "check", "zelle", "other"].includes(b.method) ? b.method : "other";
      const qty = Math.max(1, Number(b.qty) || it.qty);
      const { data, error } = await sb.from("pay_items").update({ status: "paid", method, paid_qty: qty, qty, paid_cents: qty * r.unit_amount_cents, paid_at: nowIso(), note: String(b.note || it.note || "").trim() || `Recorded by ${by}`, updated_at: nowIso() }).eq("id", it.id).select().single();
      if (error) throw fail(500, error.message);
      return { item: data };
    }
    case "mark_unpaid": {
      const it = await getItem(sb, b.item_id);
      if (it.stripe_payment_intent || ["card", "bank"].includes(it.method)) throw fail(400, "That was paid through Stripe - refund it instead");
      const { data, error } = await sb.from("pay_items").update({ status: "unpaid", method: null, paid_qty: null, paid_cents: null, paid_at: null, updated_at: nowIso() }).eq("id", it.id).select().single();
      if (error) throw fail(500, error.message);
      return { item: data };
    }
    case "cancel": case "restore": {
      const it = await getItem(sb, b.item_id);
      if (["paid", "pending"].includes(it.status)) throw fail(400, "It's paid - refund it first");
      const { data, error } = await sb.from("pay_items").update({ status: b.action === "cancel" ? "canceled" : "unpaid", updated_at: nowIso() }).eq("id", it.id).select().single();
      if (error) throw fail(500, error.message);
      return { item: data };
    }
    case "refund": {
      const it = await getItem(sb, b.item_id);
      if (it.status !== "paid" || !it.stripe_payment_intent) throw fail(400, "Only a card payment made through Stripe can be refunded here");
      const k = await stripeKey(sb);
      if (!k) throw fail(503, "Stripe isn't connected");
      const left = (it.paid_cents || 0) - (it.refunded_cents || 0);
      const amount = b.amount_cents ? Math.min(left, Math.round(Number(b.amount_cents))) : left;
      if (!(amount > 0)) throw fail(400, "Nothing left to refund");
      const rf = await stripe(k.key, "POST", "refunds", { payment_intent: it.stripe_payment_intent, amount, metadata: { pay_item_id: String(it.id), by } }, { idempotencyKey: `refund-${it.id}-${(it.refunded_cents || 0)}-${amount}` });
      const refunded = (it.refunded_cents || 0) + rf.amount;
      const { data, error } = await sb.from("pay_items").update({ refunded_cents: refunded, status: refunded >= (it.paid_cents || 0) ? "refunded" : "paid", note: `${it.note ? it.note + " · " : ""}Refunded ${usd(rf.amount)} by ${by}`, updated_at: nowIso() }).eq("id", it.id).select().single();
      if (error) throw fail(500, error.message);
      return { item: data, refund: { id: rf.id, amount: rf.amount, status: rf.status } };
    }
    case "preview": {
      const r = await getRequest(sb, b.id);
      const it = b.item_id ? await getItem(sb, b.item_id) : (await sb.from("pay_items").select("*").eq("request_id", r.id).eq("status", "unpaid").order("family_label").limit(1).maybeSingle()).data;
      if (!it) throw fail(400, "Add a family first");
      const fam = await familyOf(sb, it);
      return { family: it.family_label, emails: fam.emails, phones: fam.phones.map(p => p.to), ...messagesFor(r, it, fam) };
    }
    case "send": {
      const r = await getRequest(sb, b.id);
      if (r.status !== "open") throw fail(400, "This request is closed");
      if (!(await stripeKey(sb))) throw fail(400, "Connect Stripe first - the links won't work until it is");
      const doEmail = b.email !== false, doText = !!b.text;
      let q = sb.from("pay_items").select("*").eq("request_id", r.id).eq("status", "unpaid");
      if (Array.isArray(b.item_ids) && b.item_ids.length) q = q.in("id", b.item_ids.map(Number));
      else if (!b.remind) q = q.is("sent_at", null);
      const { data: items } = await q.order("family_label");
      const out = { families: 0, emailed: 0, texted: 0, failed: [] };
      for (const it of items || []) {
        const fam = await familyOf(sb, it);
        const m = messagesFor(r, it, fam);
        let ok = false;
        if (doEmail && fam.emails.length) { try { await sendEmail(fam.emails, (b.remind ? "Reminder: " : "") + m.subject, m.body, by); out.emailed += fam.emails.length; ok = true; } catch (e) { out.failed.push({ family: it.family_label, how: "email", error: e.message }); } }
        if (doText && fam.phones.length) { try { const t = await sendText(fam.phones, (b.remind ? "Reminder: " : "") + m.sms, `${r.title} · ${it.family_label}`.slice(0, 120), by); out.texted += t.sent; ok = true; } catch (e) { out.failed.push({ family: it.family_label, how: "text", error: e.message }); } }
        if (!fam.emails.length && !fam.phones.length) out.failed.push({ family: it.family_label, how: "-", error: "no email or mobile on file" });
        if (ok) { out.families++; await sb.from("pay_items").update(b.remind ? { reminded_at: nowIso() } : { sent_at: nowIso() }).eq("id", it.id); }
      }
      return out;
    }
    default: throw fail(400, "Unknown action");
  }
}
