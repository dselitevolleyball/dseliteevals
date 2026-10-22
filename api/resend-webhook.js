// POST /api/resend-webhook — what happened to each marketing email, from Resend.
//
//   email.bounced     → the address is marked bounced in People and never
//                       emailed again (a permanent bounce; a temporary one is
//                       only logged)
//   email.complained  → marked complained AND unsubscribed (someone hit "spam")
//   email.opened      → dssc_contacts.last_opened_at (segments: "opened in 90 days")
//   email.clicked     → dssc_contacts.last_clicked_at
// Every event is kept in mkt_email_events, tied to the marketing item through
// the `mkt_item` tag the sender puts on each message.
//
// Set up in Resend → Webhooks → Add endpoint:
//   https://www.drippingsportsclub.com/hq/api/resend-webhook
//   events: email.bounced, email.complained, email.opened, email.clicked
// then put its signing secret (whsec_…) in RESEND_WEBHOOK_SECRET. Requests are
// verified with it (Svix headers). If the raw body isn't available to check
// the signature, ?token=<RESEND_WEBHOOK_SECRET> on the URL works instead.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_WEBHOOK_SECRET.

import { createHmac } from "node:crypto";
import { serviceClient } from "./_lib/site-forms.js";
import { nrm, safeEqual } from "./_lib/site-inbox.js";

// The exact bytes Resend signed. Vercel may already have parsed the JSON; then
// the compact re-serialisation is tried as well (Resend sends compact JSON).
async function bodyCandidates(req) {
  const b = req.body;
  if (typeof b === "string") return [b];
  if (Buffer.isBuffer(b)) return [b.toString("utf8")];
  if (b && typeof b === "object") return [JSON.stringify(b)];
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return [Buffer.concat(chunks).toString("utf8")];
}

// Svix: base64 HMAC-SHA256 of "<id>.<timestamp>.<body>" with the base64 key
// after "whsec_"; the header holds one or more "v1,<sig>" separated by spaces.
export function verifySvix(secret, headers, body, now = Date.now()) {
  const id = headers["svix-id"], ts = headers["svix-timestamp"], sigs = String(headers["svix-signature"] || "");
  if (!secret || !id || !ts || !sigs || body == null) return false;
  if (Math.abs(now / 1000 - Number(ts)) > 5 * 60) return false;
  const key = Buffer.from(String(secret).replace(/^whsec_/, ""), "base64");
  const want = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return sigs.split(" ").some(s => safeEqual(s.replace(/^v1,/, ""), want));
}

// What one event means for the contact. Exported for the tests.
export function eventEffect(evt) {
  const type = String(evt?.type || "").replace(/^email\./, "");
  const d = evt?.data || {};
  const emails = [].concat(d.to || []).map(nrm).filter(Boolean);
  const tags = d.tags || {};
  const itemTag = Array.isArray(tags) ? tags.find(t => t?.name === "mkt_item")?.value : tags.mkt_item;
  const item_id = Number(itemTag) || null;
  const at = evt?.created_at || d.created_at || new Date().toISOString();
  const bounceType = String(d.bounce?.type || d.bounce?.subType || "").toLowerCase();
  const permanent = type === "bounced" && !/transient|temporary|soft/.test(bounceType);
  const patch = type === "bounced" ? (permanent ? { email_status: "bounced", email_status_at: at } : null)
    : type === "complained" ? { email_status: "complained", email_status_at: at }
    : type === "opened" ? { last_opened_at: at }
    : type === "clicked" ? { last_clicked_at: at, last_opened_at: at }
    : null;
  return { type, emails, item_id, at, patch, unsubscribe: type === "complained", resend_id: d.email_id || d.id || null, detail: type === "bounced" ? { bounce: d.bounce || null } : type === "clicked" ? { link: d.click?.link || null } : {} };
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).json({ ok: false, error: "POST only" }); }
  const secret = process.env.RESEND_WEBHOOK_SECRET || "";
  if (!secret) return res.status(500).json({ ok: false, error: "RESEND_WEBHOOK_SECRET isn't set" });
  const bodies = await bodyCandidates(req).catch(() => []);
  const byToken = req.query?.token && safeEqual(String(req.query.token), secret);
  if (!byToken && !bodies.some(b => verifySvix(secret, req.headers || {}, b))) return res.status(401).json({ ok: false, error: "Bad signature" });
  let evt;
  try { evt = JSON.parse(bodies[0]); } catch { return res.status(400).json({ ok: false, error: "Bad JSON" }); }
  const e = eventEffect(evt);
  if (!["bounced", "complained", "opened", "clicked", "delivery_delayed"].includes(e.type) || !e.emails.length) return res.status(200).json({ ok: true, ignored: e.type || "?" });
  const sb = serviceClient();
  if (!sb) return res.status(500).json({ ok: false, error: "Server not configured" });
  const rows = e.emails.map(email => ({ email, type: e.type, resend_id: e.resend_id, item_id: e.item_id, detail: e.detail, at: e.at }));
  const { error: insErr } = await sb.from("mkt_email_events").insert(rows);
  // A repeat open of the same email hits the unique index — that's fine.
  if (insErr && !/duplicate|unique/i.test(insErr.message)) return res.status(500).json({ ok: false, error: insErr.message });
  if (e.patch) {
    const { error } = await sb.from("dssc_contacts").update(e.patch).in("email", e.emails);
    if (error) return res.status(500).json({ ok: false, error: error.message });
  }
  if (e.unsubscribe) await sb.from("mkt_unsubscribes").upsert(e.emails.map(email => ({ email })), { onConflict: "email", ignoreDuplicates: true });
  return res.status(200).json({ ok: true, type: e.type });
}
