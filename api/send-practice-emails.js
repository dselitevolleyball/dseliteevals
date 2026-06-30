// Vercel serverless function: email coaches their team's practice schedule with
// a no-login "Approve" link (signed token) and a "Request a change" mailto.
//
// Env: SUPABASE_SERVICE_ROLE_KEY (HMAC signing secret), RESEND_API_KEY,
//      DSE_FROM_EMAIL, DSE_REPLY_TO (optional).
//
// Body: { recipients: [{ email, coach, team, scheduleText }] }

import crypto from "crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sign = (obj, secret) => { const p = b64url(Buffer.from(JSON.stringify(obj))); const sig = b64url(crypto.createHmac("sha256", secret).update(p).digest()); return p + "." + sig; };
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).json({ error: "Method not allowed" }); }
  const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const RESEND = process.env.RESEND_API_KEY || process.env.resend_api_key;
  const FROM = process.env.DSE_FROM_EMAIL;
  const REPLY = (process.env.DSE_REPLY_TO || "drew@dselitevolleyball.com").trim();
  if (!SECRET) return res.status(500).json({ error: "Signing secret (SUPABASE_SERVICE_ROLE_KEY) not set." });
  if (!RESEND || !FROM) return res.status(500).json({ error: "Email not configured (RESEND_API_KEY / DSE_FROM_EMAIL)." });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; } catch (e) { return res.status(400).json({ error: "Invalid JSON" }); }
  const recipients = Array.isArray(body && body.recipients) ? body.recipients : [];
  if (!recipients.length) return res.status(400).json({ error: "No recipients" });

  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const base = "https://" + host;
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 days

  const messages = [];
  for (const r of recipients) {
    const email = String((r && r.email) || "").trim();
    if (!EMAIL_RE.test(email)) continue;
    const token = sign({ team: r.team, coach: r.coach, email, exp }, SECRET);
    const approveUrl = base + "/api/practice-approval?token=" + encodeURIComponent(token);
    const changeMail = "mailto:" + REPLY + "?subject=" + encodeURIComponent("Practice change request — " + (r.team || "")) +
      "&body=" + encodeURIComponent("Team: " + (r.team || "") + "\nCoach: " + (r.coach || "") + "\n\nRequested change:\n");
    const sched = esc(r.scheduleText || "(no practices listed)");
    const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#222;line-height:1.5">
      <p>Hi ${esc(r.coach || "Coach")},</p>
      <p>Here is the practice schedule for <b>${esc(r.team)}</b>:</p>
      <pre style="white-space:pre-wrap;background:#f6f6f6;border:1px solid #ddd;border-radius:8px;padding:12px;font-family:inherit">${sched}</pre>
      <p>Please review it &mdash; no login needed, just tap a button:</p>
      <p>
        <a href="${approveUrl}" style="display:inline-block;background:#22c55e;color:#06210f;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:8px">&#10003; Approve schedule</a>
        &nbsp;&nbsp;
        <a href="${changeMail}" style="display:inline-block;background:#f59e0b;color:#3a2400;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:8px">Request a change</a>
      </p>
      <p style="color:#777;font-size:13px">"Approve" confirms there are no conflicts. "Request a change" opens an email to Drew. You can also log in any time at ${base}.</p>
    </div>`;
    const text = "Practice schedule for " + (r.team || "") + ":\n\n" + (r.scheduleText || "") + "\n\nApprove (no login): " + approveUrl + "\nRequest a change: email " + REPLY;
    messages.push({ from: FROM, to: [email], reply_to: REPLY, subject: "Approve your practice schedule — " + (r.team || "DS Elite"), html, text });
  }
  if (!messages.length) return res.status(400).json({ error: "No valid recipient emails." });

  let sent = 0; const failed = [];
  for (let i = 0; i < messages.length; i += 100) {
    const group = messages.slice(i, i + 100);
    try {
      const r = await fetch("https://api.resend.com/emails/batch", {
        method: "POST", headers: { Authorization: "Bearer " + RESEND, "Content-Type": "application/json" }, body: JSON.stringify(group),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) failed.push((d && (d.message || d.error)) || ("Resend " + r.status));
      else sent += group.length;
    } catch (e) { failed.push((e && e.message) || "request failed"); }
  }
  return res.status(200).json({ ok: failed.length === 0, sent, failed });
}
