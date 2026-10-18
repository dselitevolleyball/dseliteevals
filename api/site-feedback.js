// POST /api/site-feedback — the website's "thanks for visiting" feedback pop-up.
//
// Saves a 1–5 star rating plus two optional comments in site_feedback (HQ → Website → Feedback)
// and, when the visitor wrote something, emails it to Drew. Star-only ratings are saved
// without an email so a busy day doesn't flood his inbox.
//
//   body  { rating: 1-5, navigation?, needs_help?, page?, company? }
//   200   { ok: true, message }            (+ test: true for a test)
//   400   { ok: false, error, field }
//
// Same test header, honeypot (company) and throttle as /api/site-contact (see _lib/site-forms.js).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, DSE_FROM_EMAIL, SITE_CONTACT_TO (optional).

import { cors, readBody, str, longStr, clientIp, testMode, badTestToken, throttled, serviceClient, esc } from "./_lib/site-forms.js";

const DEFAULT_TO = "drew@dselitevolleyball.com";
const THANKS = "Thank you! Your feedback helps us make the site better.";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") { res.setHeader("Allow", "POST, OPTIONS"); return res.status(405).json({ ok: false, error: "Use POST." }); }

  const mode = testMode(req);
  if (mode === "invalid") return badTestToken(res);
  const test = mode === "valid";
  const b = readBody(req);
  if (str(b.company, 200)) return res.status(200).json({ ok: true, message: THANKS });
  const ip = clientIp(req);
  if (throttled((test ? "feedback-test:" : "feedback:") + ip, { max: test ? 20 : 5 })) return res.status(429).json({ ok: false, error: "Thanks, we already have your feedback." });

  const rating = Number(b.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ ok: false, field: "rating", error: "Please pick a rating from 1 to 5 stars." });
  const navigation = longStr(b.navigation, 3000) || null, needsHelp = longStr(b.needs_help, 3000) || null;
  const page = str(b.page, 200) || null;

  const sb = serviceClient();
  if (!sb) return res.status(500).json({ ok: false, error: "Feedback isn't available right now. Please try again later." });
  const { error } = await sb.from("site_feedback").insert({ rating, navigation, needs_help: needsHelp, page, ip, is_test: test });
  if (error) { console.error("site-feedback insert", error); return res.status(500).json({ ok: false, error: "Something went wrong. Please try again." }); }
  if (test) return res.status(200).json({ ok: true, test: true, message: "Test saved (no email sent)." });

  if (navigation || needsHelp) {
    try {
      const key = process.env.RESEND_API_KEY || process.env.resend_api_key, from = process.env.DSE_FROM_EMAIL;
      const to = str(process.env.SITE_CONTACT_TO, 200) || DEFAULT_TO;
      if (!key || !from) throw new Error("email not configured");
      const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
      const block = (label, v) => v ? `<p style="margin:12px 0 4px;color:#666">${esc(label)}</p><div style="padding:10px 12px;background:#f6f4f7;border-radius:8px;white-space:pre-wrap">${esc(v)}</div>` : "";
      const html = `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#191919;max-width:640px">
<p style="margin:0 0 6px"><b>Website feedback</b> · <span style="color:#d12c74;font-size:16px">${stars}</span> (${rating}/5)${page ? ` · on ${esc(page)}` : ""}</p>
${block("Navigation: was anything hard to find?", navigation)}${block("What could use some help?", needsHelp)}
<p style="color:#888;font-size:12px;margin-top:14px">Anonymous. Every rating is in HQ → Website → Feedback.</p></div>`;
      const text = `Website feedback: ${rating}/5${page ? ` on ${page}` : ""}\n\n${navigation ? `Navigation: ${navigation}\n\n` : ""}${needsHelp ? `Could use help: ${needsHelp}\n` : ""}`;
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject: `Website feedback: ${rating}/5`, html, text }) });
      if (!r.ok) throw new Error("Resend " + r.status);
    } catch (e) { console.error("site-feedback email", e.message); }
  }
  return res.status(200).json({ ok: true, message: THANKS });
}
