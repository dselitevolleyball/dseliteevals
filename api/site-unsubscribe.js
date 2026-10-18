// GET/POST /api/site-unsubscribe?t=<unsub_token> — leave the DS Elite website email list (site_leads).
// GET shows a confirmation page (and unsubscribes); POST is the one-click List-Unsubscribe from mail apps.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { serviceClient } from "./_lib/site-forms.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const page = (msg) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DS Elite Volleyball</title></head>
<body style="margin:0;background:#0a0a0a;color:#eee;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif"><div style="max-width:480px;margin:0 auto;padding:48px 16px">
<h1 style="font-size:24px;color:#ff5ba3;margin:0 0 10px">DS Elite Volleyball</h1><p style="font-size:17px;line-height:1.5">${msg}</p>
<p><a href="https://www.dselitevolleyball.com" style="color:#ff5ba3">Back to dselitevolleyball.com</a></p></div></body></html>`;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const t = String((req.query || {}).t || "").trim();
  if (!UUID_RE.test(t)) return res.status(400).send(page("That unsubscribe link is incomplete. Reply to any of our emails and we'll take you off the list."));
  const sb = serviceClient();
  if (!sb) return res.status(500).send(page("Something went wrong. Please try again in a minute."));
  const { data } = await sb.from("site_leads").update({ unsubscribed_at: new Date().toISOString() }).eq("unsub_token", t).is("unsubscribed_at", null).select("id");
  if (req.method === "POST") return res.status(200).json({ ok: true });
  const { data: row } = await sb.from("site_leads").select("id").eq("unsub_token", t).maybeSingle();
  if (!row) return res.status(404).send(page("We couldn't find that address on our list. You won't get any more emails from it."));
  return res.status(200).send(page((data && data.length ? "You're unsubscribed." : "You were already unsubscribed.") + " You won't get any more club news emails from us. If that was a mistake, you can sign up again on our website."));
}
