// Stripe -> DS Elite Payments. Stripe calls this for the events in
// api/_lib/stripe.js WEBHOOK_EVENTS (the endpoint is created when Stripe is
// connected in HQ). Every call is checked against the endpoint's signing
// secret before anything changes.
//   checkout.session.completed / async_payment_succeeded   -> paid (or pending for a bank payment still clearing)
//   checkout.session.async_payment_failed                  -> back to unpaid, with a note
//   charge.refunded                                        -> refunded (a refund made in the Stripe dashboard too)
import { createClient } from "@supabase/supabase-js";
import { verifySignature, webhookSecret } from "./_lib/stripe.js";
import { applySession, usd } from "./_lib/payments.js";

export const config = { api: { bodyParser: false }, maxDuration: 30 };

async function rawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("POST only");
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const raw = await rawBody(req);
  if (!verifySignature(raw, req.headers["stripe-signature"], await webhookSecret(sb))) return res.status(400).send("Bad signature");
  let ev;
  try { ev = JSON.parse(raw); } catch { return res.status(400).send("Bad JSON"); }
  const o = ev.data?.object || {};
  try {
    if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") await applySession(sb, o);
    else if (ev.type === "checkout.session.async_payment_failed") {
      const id = Number(o.metadata?.pay_item_id || o.client_reference_id);
      if (id) await sb.from("pay_items").update({ status: "unpaid", paid_at: null, paid_cents: null, paid_qty: null, note: "The bank payment didn't go through", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "pending");
    } else if (ev.type === "charge.refunded" && o.payment_intent) {
      const { data: it } = await sb.from("pay_items").select("id, paid_cents, note").eq("stripe_payment_intent", o.payment_intent).maybeSingle();
      if (it) await sb.from("pay_items").update({ refunded_cents: o.amount_refunded, status: o.amount_refunded >= (it.paid_cents || o.amount) ? "refunded" : "paid", note: it.note?.includes("Refunded") ? it.note : `${it.note ? it.note + " · " : ""}Refunded ${usd(o.amount_refunded)}`, updated_at: new Date().toISOString() }).eq("id", it.id);
    }
  } catch (e) {
    console.error("pay-webhook", ev.type, e);
    return res.status(500).send("error");   // Stripe retries
  }
  return res.status(200).json({ received: true });
}
