// Vercel serverless function: bulk-send email via Resend (send-only).
//
// Sends each recipient an individual email (no shared To/CC, so parents never
// see each other) from the DS Elite address, with Reply-To set so replies go
// straight to the coach's normal inbox.
//
// Env vars (Vercel -> Project Settings -> Environment Variables):
//   RESEND_API_KEY   - required. From resend.com after verifying the domain.
//   DSE_FROM_EMAIL   - required. e.g. "DS Elite Volleyball <drew@dselitevolleyball.com>"
//                      The address/domain must be verified in Resend.
//   DSE_REPLY_TO     - optional. Where replies go (e.g. drew@dselitevolleyball.com).
//                      Defaults to the address inside DSE_FROM_EMAIL.
//
// Request body: { subject: string, body: string, recipients: string[],
//                 html?: boolean }   // body is plain text unless html=true
// Response: { ok, sent, failed: [{ email, error }] }

const RESEND_BATCH = "https://api.resend.com/emails/batch";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};
const extractAddress = (from) => {
  const m = String(from || "").match(/<([^>]+)>/);
  return m ? m[1] : String(from || "").trim();
};
const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Env var names are case-sensitive; accept either casing for the key.
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;
  const { DSE_FROM_EMAIL, DSE_REPLY_TO } = process.env;
  if (!RESEND_API_KEY) return res.status(500).json({ error: "RESEND_API_KEY is not set. Add it in Vercel after verifying your domain in Resend." });
  if (!DSE_FROM_EMAIL) return res.status(500).json({ error: "DSE_FROM_EMAIL is not set (e.g. \"DS Elite <drew@dselitevolleyball.com>\")." });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: "Invalid JSON body" }); }

  const subject = (body && typeof body.subject === "string" ? body.subject : "").trim();
  const text    = (body && typeof body.body === "string" ? body.body : "").trim();
  const asHtml  = !!(body && body.html);
  const recipients = Array.isArray(body && body.recipients) ? body.recipients : [];

  if (!subject) return res.status(400).json({ error: "Subject is required." });
  if (!text)    return res.status(400).json({ error: "Message body is required." });

  // Dedupe + validate recipient addresses.
  const seen = new Set();
  const valid = [];
  const failed = [];
  for (const raw of recipients) {
    const email = String(raw || "").trim().toLowerCase();
    if (!email) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    if (EMAIL_RE.test(email)) valid.push(email);
    else failed.push({ email, error: "invalid address" });
  }
  if (!valid.length) return res.status(400).json({ error: "No valid recipient email addresses.", failed });

  // Optional per-request reply-to (e.g. a coach's address for a schedule-change
  // request) so replies reach them directly; falls back to the club default.
  const reqReplyTo = (body && typeof body.replyTo === "string" ? body.replyTo : "").trim();
  const replyTo = (reqReplyTo && EMAIL_RE.test(reqReplyTo)) ? reqReplyTo : (DSE_REPLY_TO || extractAddress(DSE_FROM_EMAIL)).trim();
  // Pre-rendered HTML from the composer's formatting toolbar takes priority;
  // otherwise fall back to the plain-text wrap (or raw html when html=true).
  const preRendered = (body && typeof body.bodyHtml === "string" && body.bodyHtml.trim()) ? body.bodyHtml : null;
  const htmlBody = preRendered ? preRendered
    : asHtml ? text
    : "<div style=\"white-space:pre-wrap;font-family:sans-serif;font-size:15px;line-height:1.5\">" + escapeHtml(text) + "</div>";

  let sent = 0;
  // Resend batch endpoint accepts up to 100 messages per request.
  for (const group of chunk(valid, 100)) {
    const payload = group.map(email => ({
      from: DSE_FROM_EMAIL,
      to: [email],
      reply_to: replyTo,
      subject,
      html: htmlBody,
      text,
    }));
    try {
      const r = await fetch(RESEND_BATCH, {
        method: "POST",
        headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (data && (data.message || data.error)) || ("Resend error " + r.status);
        group.forEach(email => failed.push({ email, error: msg }));
      } else {
        sent += group.length;
      }
    } catch (err) {
      group.forEach(email => failed.push({ email, error: (err && err.message) || "request failed" }));
    }
  }

  // Log EVERY send, here, rather than trusting each caller to remember.
  // The app sends mail from 25 places and only 4 of them were writing to
  // email_log — so Kristen's USAV/Lone Star note went out with no record of it
  // anywhere, and neither she nor Drew could find it afterwards. Logging at the
  // one door every message goes through means no future feature can forget.
  //
  // Best-effort: a logging failure must never fail a send that already left.
  try {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
    // The four composer paths write their own richer row (they know the
      // audience and the sender); they pass skipLog so we don't duplicate it.
      if (!body?.skipLog && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && (sent > 0 || failed.length)) {
      const who = (body && typeof body.sentBy === "string" && body.sentBy.trim()) || null;
      const whoEmail = (body && typeof body.sentByEmail === "string" && body.sentByEmail.trim()) || null;
      // Which feature sent it, so an unattributed message is still traceable.
      const src = (body && typeof body.source === "string" && body.source.trim()) || null;
      await fetch(SUPABASE_URL + "/rest/v1/email_log", {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          subject, body: text.slice(0, 20000),
          recipient_count: valid.length, recipients: valid.slice(0, 200),
          sent_count: sent, failed_count: failed.length,
          sent_by: who || (src ? "(" + src + ")" : "(unattributed)"),
          sent_by_email: whoEmail,
        }),
      });
    }
  } catch (e) { console.error("email_log write failed (send already went out):", e?.message); }

  // …and the same rule the other way: an email is also a notification.
  // Callers that already push pass skipPush. Mirrored pushes carry skipEmail so
  // send-push does not bounce a second email straight back.
  let pushed = 0;
  if (!body?.skipPush && valid.length) {
    try {
      const origin = process.env.APP_URL || ("https://" + (req.headers["x-forwarded-host"] || req.headers.host));
      const r = await fetch(origin + "/api/send-push", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: subject,
          body: text.replace(/\s+/g, " ").slice(0, 160),
          url: (body && typeof body.url === "string" && body.url) || "/?view=home",
          audience: { type: "emails", emails: valid },
          skipEmail: true,
        }),
      });
      const d = await r.json().catch(() => ({}));
      pushed = Number(d?.sent) || 0;
    } catch (e) { console.error("email→push mirror failed (email already sent):", e?.message); }
  }

  return res.status(200).json({ ok: failed.length === 0, sent, failed, pushed });
}
