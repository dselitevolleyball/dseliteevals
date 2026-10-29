// The family's payment page: /pay?t=<pay_items.token> (DS Elite Payments).
//
// GET  /pay?t=…                    what they owe, a Pay button
// POST /pay?t=…                    makes a Stripe Checkout Session and sends them to it
// GET  /pay?t=…&done=1&session_id  back from Stripe: checks the session, says thank you
// GET  /pay?preview=1              a sample page, nothing real
//
// Not part of the React app, like /ncaa and /poll: it opens from an email or
// text with nothing to log into. The token is a per-family uuid. The card is
// typed on Stripe's page, never here.
import { createClient } from "@supabase/supabase-js";
import { checkoutUrl, applySession, sessionById, usd } from "./_lib/payments.js";

export const config = { maxDuration: 30 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtDue = (d) => d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }) : "";

const page = (inner, title = "DS Elite Volleyball · Payment") => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
  :root { --bg:#0a0a0a; --card:#151515; --ink:#fff; --body:#d9d9d9; --mut:#9a9a9a; --rule:#2a2a2a; --pink:#e91e8c; --hot:#ff69b4; --grn:#22c55e; --warn:#f59e0b; --err:#f87171; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  body { margin:0; background:var(--bg); color:var(--body); font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif; font-size:17px; line-height:1.5; }
  .wrap { max-width:560px; margin:0 auto; padding:26px 16px 64px; }
  .logo { height:40px; margin-bottom:18px; }
  .eyebrow { font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:var(--hot); font-weight:800; }
  h1 { margin:6px 0 6px; color:var(--ink); font-size:clamp(1.7rem,7vw,2.2rem); line-height:1.1; }
  .sub { margin:0 0 18px; color:var(--mut); white-space:pre-line; }
  .card { background:var(--card); border:1px solid var(--rule); border-radius:14px; padding:18px; margin-top:12px; }
  .row { display:flex; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px solid var(--rule); }
  .row:last-child { border-bottom:0; } .row b { color:var(--ink); }
  .total b { font-size:1.6rem; }
  .pay { width:100%; margin-top:16px; padding:17px; font:inherit; font-weight:800; font-size:19px; cursor:pointer; background:var(--pink); color:#fff; border:none; border-radius:12px; }
  .note { color:var(--mut); font-size:14px; margin-top:12px; }
  .change { margin:14px 0 0; padding:12px 14px; border-radius:10px; background:rgba(233,30,140,.12); border:1px solid rgba(233,30,140,.35); font-size:15px; }
  .change b { color:var(--ink); }
  .ok h2 { color:var(--grn); margin:0 0 6px; } .warn h2 { color:var(--warn); margin:0 0 6px; }
  .err { color:var(--err); font-weight:700; }
</style></head><body><div class="wrap">
<img class="logo" src="/logos/ds-elite-white-logo.png" alt="DS Elite Volleyball">
${inner}
<p class="note">Payments are processed securely by Stripe. Questions? Email <a href="mailto:drew@dselitevolleyball.com" style="color:var(--hot)">drew@dselitevolleyball.com</a>.</p>
</div></body></html>`;
const sorry = (msg) => page(`<h1>Hmm.</h1><p class="sub">${esc(msg)}</p>`);

function body(req, item, { error = "" } = {}) {
  const unit = (n) => `${n} ${req.unit_label}${n === 1 ? "" : "s"}`;
  const total = req.unit_amount_cents * item.qty;
  if (item.status === "paid" || item.status === "refunded") {
    const net = (item.paid_cents || 0) - (item.refunded_cents || 0);
    return `<div class="eyebrow">DS Elite Volleyball</div><h1>${esc(req.title)}</h1>
<div class="card ok"><h2>Paid ✓</h2><p style="margin:0">${esc(item.family_label)}: ${esc(unit(item.paid_qty || item.qty))}, ${usd(item.paid_cents)}${item.paid_at ? ` on ${new Date(item.paid_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })}` : ""}.${item.refunded_cents ? ` ${usd(item.refunded_cents)} refunded${net > 0 ? `, ${usd(net)} kept` : ""}.` : ""}</p></div>`;
  }
  if (item.status === "pending") return `<div class="eyebrow">DS Elite Volleyball</div><h1>${esc(req.title)}</h1>
<div class="card warn"><h2>Payment received - clearing</h2><p style="margin:0">Your bank payment of ${usd(item.paid_cents)} is on its way. Bank payments take a few business days to clear; there's nothing else to do.</p></div>`;
  if (item.status === "canceled") return `<h1>${esc(req.title)}</h1><p class="sub">This payment link has been canceled. If that's a mistake, email Drew.</p>`;
  if (req.status !== "open") return `<h1>${esc(req.title)}</h1><p class="sub">Payments for this are closed. If you still need to pay, email Drew.</p>`;
  return `<div class="eyebrow">DS Elite Volleyball</div><h1>${esc(req.title)}</h1>
${req.description ? `<p class="sub">${esc(req.description)}</p>` : ""}
<div class="card">
  <div class="row"><span>Family</span><b>${esc(item.family_label)}</b></div>
  <div class="row"><span>${esc(unit(item.qty))} at ${usd(req.unit_amount_cents)}</span><b>${usd(total)}</b></div>
  <div class="row total"><span>Total</span><b>${usd(total)}</b></div>
  ${req.due_date ? `<p class="note" style="margin-top:6px">Please pay by ${esc(fmtDue(req.due_date))}.</p>` : ""}
  ${error ? `<p class="err">${esc(error)}</p>` : ""}
  ${req.allow_qty_change ? `<p class="change"><b>Need more or fewer ${esc(req.unit_label)}s?</b> Tap Pay, then change the number on the next screen before you pay. Your total updates there.</p>` : ""}
  <form method="post"><button class="pay" type="submit">Pay ${usd(total)}</button></form>
  <p class="note">Card, Apple Pay or Google Pay. You'll get a receipt by email.</p>
</div>`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const q = req.query || {};
  if (q.preview === "1") {
    const r = { title: "NCAA Championship tickets", description: "The DS Elite group at the NCAA women's volleyball championship match, Alamodome, Sun, Dec 20 at 2:30pm. Seats in the 300 level.", unit_label: "ticket", unit_amount_cents: 5500, allow_qty_change: true, status: "open", due_date: null };
    return res.status(200).send(page(body(r, { family_label: "Ava & Mia Smith (12 Rise, 15 Ruby)", qty: 4, status: "unpaid" }).replace("<form method=\"post\">", "<form onsubmit=\"return false\">")));
  }
  const tok = String(q.t || "").trim();
  if (!UUID_RE.test(tok)) return res.status(400).send(sorry("That link isn't right. Use the one from your email or text."));
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const load = async () => (await sb.from("pay_items").select("*, pay_requests(*)").eq("token", tok).maybeSingle()).data;
  let item = await load();
  if (!item) return res.status(404).send(sorry("We can't find that payment. Email Drew and we'll sort it out."));
  const r = item.pay_requests;

  if (req.method === "POST") {
    if (item.status !== "unpaid" || r.status !== "open") return res.status(200).send(page(body(r, item)));
    try {
      const url = await checkoutUrl(sb, item, r);
      res.setHeader("Location", url);
      return res.status(303).send("");
    } catch (e) {
      console.error("pay-form checkout", e);
      return res.status(200).send(page(body(r, item, { error: "We couldn't open the payment page just now. Please try again in a minute." })));
    }
  }
  // Back from Stripe: don't wait for the webhook.
  if (q.done === "1" && q.session_id && item.status === "unpaid") {
    const s = await sessionById(sb, String(q.session_id));
    if (s && String(s.metadata?.pay_item_id) === String(item.id)) { await applySession(sb, s).catch(e => console.error("pay-form apply", e)); item = await load(); }
  }
  if (!item.opened_at) await sb.from("pay_items").update({ opened_at: new Date().toISOString() }).eq("id", item.id);
  return res.status(200).send(page(body(r, item), `${r.title} · DS Elite`));
}
