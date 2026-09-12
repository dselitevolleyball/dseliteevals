// Cancel scheduled emails that haven't gone out yet.
//
// send-email can hold a message at Resend until a set time. Plans change
// inside that window — 16 Diamond's commitment email was queued for 2pm
// Sunday saying "we went through this at orientation last night", and then
// their orientation moved to a team meeting at practice. Without this the
// wrong email reaches ten families and cannot be recalled.
//
// POST /api/cancel-email  { ids: ["uuid", ...] }
//
// The id IS the authorisation. A Resend message id is an unguessable uuid
// returned only to whoever queued the send, so holding one is proof you queued
// it — the same basis as the token links families use. Ids that are already
// sent, already cancelled or unknown come back as failures, not errors, so one
// stale id doesn't stop the rest.
//
// Env: RESEND_API_KEY (or resend_api_key).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX = 200;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;
  if (!RESEND_API_KEY) return res.status(500).json({ error: "Email not configured" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const ids = [...new Set((Array.isArray(body?.ids) ? body.ids : []).map(s => String(s || "").trim()))]
    .filter(s => UUID_RE.test(s));
  if (!ids.length) return res.status(400).json({ error: "ids[] of Resend message ids required" });
  if (ids.length > MAX) return res.status(400).json({ error: `Too many ids (max ${MAX})` });

  const cancelled = [], failed = [];
  // Serial: cancelling is rare and small, and Resend rate-limits bursts.
  for (const id of ids) {
    try {
      const r = await fetch("https://api.resend.com/emails/" + id + "/cancel", {
        method: "POST", headers: { Authorization: "Bearer " + RESEND_API_KEY },
      });
      if (r.ok) { cancelled.push(id); continue; }
      const d = await r.json().catch(() => ({}));
      failed.push({ id, error: (d && (d.message || d.error)) || ("Resend " + r.status) });
    } catch (e) { failed.push({ id, error: (e && e.message) || "request failed" }); }
  }
  return res.status(200).json({ ok: failed.length === 0, cancelled: cancelled.length, failed });
}
