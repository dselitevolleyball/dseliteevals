// DS Elite Payments - the shared pieces (Drew, Oct 29 2026: "set up a payment
// system through Stripe that I can use for things like the NCAA tickets").
// migrations/20261111_payments.sql has the tables; api/pay.js is HQ's API,
// api/pay-form.js the family's page (/pay?t=), api/pay-webhook.js Stripe's.
//
// One pay_item per family (brothers and sisters share parent emails, as on
// the NCAA form). The link opens Stripe Checkout for qty x the request's price;
// when the request allows it the family can change the number there. DS Elite
// absorbs the card fees. Paid / pending / refunded come back from Stripe.

import { stripe, stripeKey, PUBLIC_BASE } from "./stripe.js";
import { families as familyGroups, NCAA_WHEN, NCAA_WHERE, NCAA_SEATS } from "../../shared/ncaa-tickets.js";

const fail = (status, msg) => Object.assign(new Error(msg), { status });
export const usd = (c) => "$" + (Number(c || 0) / 100).toFixed(2).replace(/\.00$/, "");
export const payLink = (item) => `${PUBLIC_BASE}/pay?t=${item.token}`;
const teamLabel = (t) => String(t || "").replace(/^(\d+ Rise) 1$/, "$1");
const PLAYER_COLS = "id, first_name, last_name, team_assignment, parent_name, parent2_name, parent_email, parent_email2, parent_email3, parent_phone, parent2_phone";

// "Ava & Mia Smith (12 Rise, 15 Ruby)"
export function familyLabel(fam) {
  const byLast = new Map();
  for (const p of fam) { const k = p.last_name || ""; if (!byLast.has(k)) byLast.set(k, []); byLast.get(k).push(p.first_name); }
  const names = [...byLast].map(([last, firsts]) => `${firsts.join(" & ")} ${last}`.trim()).join(" & ");
  const teams = [...new Set(fam.map(p => teamLabel(p.team_assignment)).filter(Boolean))];
  return `${names}${teams.length ? ` (${teams.join(", ")})` : ""}`;
}
export async function familyOf(sb, item) {
  const { data } = await sb.from("players").select(PLAYER_COLS).in("id", item.player_ids || []);
  const fam = data || [];
  const emails = [...new Set(fam.flatMap(p => [p.parent_email, p.parent_email2, p.parent_email3]).map(e => String(e || "").trim().toLowerCase()).filter(e => /@/.test(e)))];
  const phones = [], seen = new Set();
  for (const p of fam) for (const [ph, nm] of [[p.parent_phone, p.parent_name], [p.parent2_phone, p.parent2_name]]) {
    const k = String(ph || "").replace(/\D/g, "").slice(-10);
    if (k.length === 10 && !seen.has(k)) { seen.add(k); phones.push({ to: String(ph).trim(), name: String(nm || "").trim() || null, player_id: p.id, team_name: p.team_assignment, kind: "parent" }); }
  }
  const parents = [...new Set(fam.flatMap(p => [p.parent_name, p.parent2_name]).map(x => String(x || "").trim().split(/\s+/)[0]).filter(Boolean))];
  const greeting = parents.length ? "Hi " + (parents.length === 1 ? parents[0] : parents.slice(0, -1).join(", ") + " and " + parents[parents.length - 1]) + "," : "Hi,";
  return { players: fam, emails, phones, greeting };
}

// ── the words ───────────────────────────────────────────────────────────────
const fmtDue = (d) => d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }) : "";
export function defaults(req) {
  if (req.source === "ncaa") return {
    email_subject: "DS Elite at the NCAA Championship: pay for your tickets",
    email_body: `{greeting}

Thank you for joining the DS Elite group at the NCAA women's volleyball championship match at ${NCAA_WHERE} on ${NCAA_WHEN}! You asked for {qty} at {price} each ({total}), with seats in ${NCAA_SEATS}.

Please pay here{due_by}. It takes a minute, and you can use a card, Apple Pay or Google Pay:
{link}

Need a different number of tickets? You can change it on the payment page before you pay.

Questions? Just reply to this email.

Thanks,
Drew Rose
DS Elite Volleyball`,
    sms_body: `Hi {first}, thanks for joining the DS Elite group at the NCAA championship (Sun, Dec 20, Alamodome)! Your total for {qty} is {total}. Please pay here{due_by_short}: {link} - Drew, DS Elite`,
  };
  return {
    email_subject: `DS Elite: ${req.title}`,
    email_body: `{greeting}

${req.description ? req.description.trim() + "\n\n" : ""}Your total is {total} ({qty} at {price} each). Please pay here{due_by}. It takes a minute, and you can use a card, Apple Pay or Google Pay:
{link}

Questions? Just reply to this email.

Thanks,
Drew Rose
DS Elite Volleyball`,
    sms_body: `Hi {first}, DS Elite: ${req.title}. Your total is {total}. Please pay here{due_by_short}: {link} - Drew, DS Elite`,
  };
}
export function fill(tpl, req, item, fam) {
  const unit = (n) => `${n} ${req.unit_label}${n === 1 ? "" : "s"}`;
  const vals = {
    greeting: fam.greeting, qty: unit(item.qty), price: usd(req.unit_amount_cents), total: usd(req.unit_amount_cents * item.qty),
    link: payLink(item), title: req.title, due: fmtDue(req.due_date),
    due_by: req.due_date ? ` by ${fmtDue(req.due_date)}` : "", due_by_short: req.due_date ? ` by ${fmtDue(req.due_date).replace(/^\w+, /, "")}` : "",
  };
  return String(tpl || "").replace(/\{(greeting|qty|price|total|link|title|due|due_by|due_by_short)\}/g, (_, k) => vals[k]);
}
export function messagesFor(req, item, fam) {
  const d = defaults(req);
  return {
    subject: fill(req.email_subject || d.email_subject, req, item, fam),
    body: fill(req.email_body || d.email_body, req, item, fam),
    // {first} is filled per number by /api/send-sms
    sms: fill(req.sms_body || d.sms_body, req, item, fam),
  };
}

// ── Stripe Checkout ─────────────────────────────────────────────────────────
export async function checkoutUrl(sb, item, req) {
  const k = await stripeKey(sb);
  if (!k) throw fail(503, "Payments aren't switched on yet");
  const fam = await familyOf(sb, item);
  const s = await stripe(k.key, "POST", "checkout/sessions", {
    mode: "payment",
    // Cards only (Apple Pay and Google Pay ride on "card"): DS Elite covers the
    // fees, and Klarna / Afterpay / Cash App cost several times what a card does.
    payment_method_types: ["card"],
    line_items: [{
      price_data: { currency: "usd", unit_amount: req.unit_amount_cents, product_data: { name: req.title, ...(req.description ? { description: String(req.description).slice(0, 500) } : {}) } },
      quantity: item.qty,
      ...(req.allow_qty_change ? { adjustable_quantity: { enabled: true, minimum: 1, maximum: Math.max(item.qty, req.max_qty || 30) } } : {}),
    }],
    ...(fam.emails[0] ? { customer_email: fam.emails[0] } : {}),
    client_reference_id: String(item.id),
    metadata: { pay_item_id: String(item.id), pay_request_id: String(req.id), family: item.family_label.slice(0, 450) },
    payment_intent_data: { description: `${req.title} · ${item.family_label}`.slice(0, 1000), metadata: { pay_item_id: String(item.id), pay_request_id: String(req.id) }, ...(fam.emails[0] ? { receipt_email: fam.emails[0] } : {}) },
    success_url: `${payLink(item)}&done=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: payLink(item),
  });
  await sb.from("pay_items").update({ stripe_session_id: s.id, updated_at: new Date().toISOString() }).eq("id", item.id);
  return s.url;
}

// A finished Checkout Session -> the item. Called by the webhook and by the
// success page (whichever gets there first; both are safe to repeat).
export async function applySession(sb, session) {
  const id = Number(session?.metadata?.pay_item_id || session?.client_reference_id);
  if (!id) return { skipped: "not a DS Elite payment" };
  const { data: item } = await sb.from("pay_items").select("*, pay_requests(unit_amount_cents)").eq("id", id).maybeSingle();
  if (!item) return { skipped: "no such item" };
  if (item.status === "refunded") return { skipped: "already refunded" };
  const unit = item.pay_requests?.unit_amount_cents || 1;
  const paid = session.payment_status === "paid";
  const pending = !paid && session.status === "complete";   // a bank payment still clearing
  if (!paid && !pending) return { skipped: "not paid" };
  const patch = {
    status: paid ? "paid" : "pending", method: (session.payment_method_types || []).includes("us_bank_account") && !(session.payment_method_types || []).includes("card") ? "bank" : "card",
    paid_cents: session.amount_total, paid_qty: Math.round((session.amount_total || 0) / unit), qty: Math.max(1, Math.round((session.amount_total || 0) / unit)),
    stripe_session_id: session.id, stripe_payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null,
    paid_at: paid ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  if (item.status === "paid" && !paid) return { skipped: "already paid" };
  const { error } = await sb.from("pay_items").update(patch).eq("id", id);
  if (error) throw fail(500, error.message);
  return { id, status: patch.status };
}
export async function sessionById(sb, sessionId) {
  const k = await stripeKey(sb);
  if (!k || !/^cs_/.test(String(sessionId || ""))) return null;
  return stripe(k.key, "GET", `checkout/sessions/${sessionId}`).catch(() => null);
}

// ── NCAA: everyone who said yes, with the number they asked for ─────────────
export async function importNcaa(sb, requestId) {
  const [{ data: answers }, { data: players }] = await Promise.all([
    sb.from("ncaa_tickets").select("player_id, answer, tickets").eq("answer", "yes"),
    sb.from("players").select(PLAYER_COLS).not("team_assignment", "is", null),
  ]);
  const byId = new Map((players || []).map(p => [p.id, p]));
  const fams = familyGroups(players || []);
  const famOf = new Map(); fams.forEach(f => f.forEach(p => famOf.set(p.id, f)));
  const rows = [];
  for (const a of answers || []) {
    const lead = byId.get(a.player_id); if (!lead) continue;
    const fam = famOf.get(lead.id) || [lead];
    rows.push({ request_id: requestId, player_ids: fam.map(p => p.id), family_label: familyLabel(fam), qty: Math.max(1, Math.min(30, Number(a.tickets) || 1)) });
  }
  if (!rows.length) return { added: 0 };
  const { data, error } = await sb.from("pay_items").upsert(rows, { onConflict: "request_id,family_label", ignoreDuplicates: true }).select("id");
  if (error) throw fail(500, error.message);
  return { added: (data || []).length, families: rows.length, tickets: rows.reduce((n, r) => n + r.qty, 0) };
}
// Add families by player (HQ's "Add a family"): the player and everyone who shares a parent email.
export async function addFamily(sb, requestId, playerId, qty = 1) {
  const { data: players } = await sb.from("players").select(PLAYER_COLS).not("team_assignment", "is", null);
  const lead = (players || []).find(p => p.id === Number(playerId));
  if (!lead) throw fail(404, "No such player");
  const fam = familyGroups(players).find(f => f.some(p => p.id === lead.id)) || [lead];
  const { data, error } = await sb.from("pay_items").insert({ request_id: requestId, player_ids: fam.map(p => p.id), family_label: familyLabel(fam), qty: Math.max(1, Number(qty) || 1) }).select().single();
  if (error) throw fail(error.code === "23505" ? 400 : 500, error.code === "23505" ? "That family is already on this list" : error.message);
  return { item: data };
}
