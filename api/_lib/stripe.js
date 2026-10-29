// DS Elite's Stripe connection for Payments (api/pay.js, api/pay-form.js,
// api/pay-webhook.js). Plain REST calls - no SDK.
//
// The secret key is pasted once in HQ -> Payments -> Stripe (or set as
// STRIPE_SECRET_KEY in Vercel). Connecting checks the key against Stripe,
// then creates the webhook endpoint for /api/pay-webhook and keeps its signing
// secret. Both live in mkt_secrets ('dse_stripe', 'dse_stripe_whsec'), never
// in the browser.

import crypto from "node:crypto";

const KEY = "dse_stripe", WHSEC = "dse_stripe_whsec";
export const PUBLIC_BASE = (process.env.DSE_PUBLIC_BASE || "https://dseliteevals.vercel.app").replace(/\/+$/, "");
export const WEBHOOK_URL = PUBLIC_BASE + "/api/pay-webhook";
export const WEBHOOK_EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "charge.refunded"];
const fail = (status, msg) => Object.assign(new Error(msg), { status });

// Stripe's form encoding: nested objects and arrays as a[b][0]=...
function form(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (x !== null && typeof x === "object" ? form(x, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === "object") form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}
export async function stripe(key, method, path, params, { idempotencyKey } = {}) {
  const get = method === "GET";
  const qs = get && params ? "?" + form(params).toString() : "";
  const r = await fetch(`https://api.stripe.com/v1/${path}${qs}`, {
    method, signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2024-06-20", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    body: get ? undefined : form(params).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw fail(r.status >= 500 ? 502 : 400, "Stripe: " + (j.error?.message || `HTTP ${r.status}`));
  return j;
}

// -> { key, account, livemode } or null
export async function stripeKey(sb) {
  const { data } = await sb.from("mkt_secrets").select("value, meta").eq("key", KEY).maybeSingle();
  if (data?.value) return { key: data.value, ...(data.meta || {}) };
  if (process.env.STRIPE_SECRET_KEY) return { key: process.env.STRIPE_SECRET_KEY, source: "env" };
  return null;
}
export async function webhookSecret(sb) {
  const { data } = await sb.from("mkt_secrets").select("value").eq("key", WHSEC).maybeSingle();
  return data?.value || process.env.STRIPE_WEBHOOK_SECRET || null;
}
const nameOf = (a) => a.settings?.dashboard?.display_name || a.business_profile?.name || a.email || a.id;

// Check a pasted key, (re)create the webhook endpoint, save both.
export async function connectStripe(sb, raw, by) {
  const key = String(raw || "").trim();
  if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]{20,}$/.test(key)) throw fail(400, "That doesn't look like a Stripe secret key (it starts with sk_live_ or rk_live_)");
  const acct = await stripe(key, "GET", "account");
  const livemode = key.includes("_live_");
  // Signing secrets are only shown when an endpoint is created, so replace ours.
  const existing = await stripe(key, "GET", "webhook_endpoints", { limit: 100 }).catch(() => ({ data: [] }));
  for (const w of existing.data || []) if (w.url === WEBHOOK_URL) await stripe(key, "DELETE", `webhook_endpoints/${w.id}`).catch(() => {});
  const hook = await stripe(key, "POST", "webhook_endpoints", { url: WEBHOOK_URL, enabled_events: WEBHOOK_EVENTS, description: "DS Elite HQ Payments" });
  const now = new Date().toISOString();
  const meta = { account_id: acct.id, account: nameOf(acct), livemode, webhook_id: hook.id, charges_enabled: !!acct.charges_enabled };
  const r1 = await sb.from("mkt_secrets").upsert({ key: KEY, value: key, meta, updated_at: now, updated_by: by || null }, { onConflict: "key" });
  const r2 = await sb.from("mkt_secrets").upsert({ key: WHSEC, value: hook.secret, meta: { webhook_id: hook.id }, updated_at: now, updated_by: by || null }, { onConflict: "key" });
  if (r1.error || r2.error) throw fail(500, (r1.error || r2.error).message);
  return { account: meta.account, livemode, charges_enabled: meta.charges_enabled };
}
export async function stripeStatus(sb) {
  const k = await stripeKey(sb);
  if (!k) return { connected: false };
  const acct = await stripe(k.key, "GET", "account").catch(e => ({ error: e.message }));
  if (acct.error) return { connected: true, ok: false, problem: acct.error, account: k.account || null };
  return { connected: true, ok: !!acct.charges_enabled, account: nameOf(acct), livemode: k.key.includes("_live_"), charges_enabled: !!acct.charges_enabled, webhook: !!(await webhookSecret(sb)), problem: acct.charges_enabled ? null : "Stripe hasn't turned on payments for this account yet - finish the account setup in the Stripe dashboard" };
}

// The Stripe-Signature header: t=<ts>,v1=<hmac of "t.body">; 5 minutes' tolerance.
export function verifySignature(raw, header, secret, now = Date.now()) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(",").map(p => p.split("=").map(s => s.trim())).filter(p => p.length === 2 && p[0] !== "v1"));
  const sigs = String(header).split(",").map(p => p.trim()).filter(p => p.startsWith("v1=")).map(p => p.slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > 300) return false;
  const want = crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return sigs.some(s => s.length === want.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want)));
}
