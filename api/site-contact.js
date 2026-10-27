// POST /api/site-contact — the website's contact form.
//
// Saves the message in site_inquiries (HQ → Website → Inquiries, and the shared
// DSSC → Inbox as a 'dselite' thread) and emails it to Drew (Resend, from
// DSE_FROM_EMAIL) with Reply-To = the sender, so a reply from his inbox goes
// straight back to the family.
//
//   body  { name, email, phone?, player_name?, age_group?, topic: 'tryouts'|'general'|'coaching'|'other', message, company? }
//   200   { ok: true, message }            (+ id and test: true for a test)
//   400   { ok: false, error, field }
//
// Testing: the header `x-site-test: <secret>` (SITE_TEST_TOKEN — see testMode() in
// _lib/site-forms.js; only its hash is in the repo) saves a validated row with
// is_test = true and sends NO email, so trying the form never lands in Drew's inbox.
// Test requests are throttled like everyone else's; a wrong token is a 403 (never a
// real submission). HQ's Inquiries tab doesn't list test rows.
// company is a honeypot (bots get a 200, nothing is saved or sent).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, DSE_FROM_EMAIL,
//      SITE_CONTACT_TO (optional, default drew@dselitevolleyball.com).

import { cors, readBody, str, longStr, isEmail, usPhone, clientIp, testMode, badTestToken, throttled, serviceClient, esc } from "./_lib/site-forms.js";
import { isBlockedSender } from "./_lib/site-inbox.js";

const TOPICS = { tryouts: "Tryouts", general: "General question", coaching: "Coaching at DS Elite", other: "Other" };
const DEFAULT_TO = "drew@dselitevolleyball.com";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") { res.setHeader("Allow", "POST, OPTIONS"); return res.status(405).json({ ok: false, error: "Use POST." }); }

  const mode = testMode(req);
  if (mode === "invalid") return badTestToken(res);
  const test = mode === "valid";
  const b = readBody(req);
  if (str(b.company, 200)) return res.status(200).json({ ok: true, message: "Thanks — we got your message and will get back to you soon." });
  const ip = clientIp(req);
  if (throttled((test ? "contact-test:" : "contact:") + ip, { max: test ? 20 : 5 })) return res.status(429).json({ ok: false, error: "That's a lot of messages from one connection. Please wait a few minutes, or email drew@dselitevolleyball.com." });

  const name = str(b.name, 120), email = str(b.email, 200).toLowerCase();
  const phoneRaw = str(b.phone, 40), phone = phoneRaw ? usPhone(phoneRaw) : null;
  const player = str(b.player_name, 200) || null, age = str(b.age_group, 40) || null;
  const topic = str(b.topic, 20).toLowerCase() || "general";
  const message = longStr(b.message, 5000);
  const bad = (field, error) => res.status(400).json({ ok: false, field, error });
  if (!name) return bad("name", "Please enter your name.");
  if (!isEmail(email)) return bad("email", "Please enter an email address we can reply to.");
  if (phoneRaw && !phone) return bad("phone", "That phone number doesn't look right — use a 10-digit US number, or leave it blank.");
  if (!TOPICS[topic]) return bad("topic", "Please choose what your message is about.");
  if (message.length < 2) return bad("message", "Please write a short message.");

  const sb = serviceClient();
  if (!sb) return res.status(500).json({ ok: false, error: "The contact form isn't available right now. Please email drew@dselitevolleyball.com." });
  let id;
  // A sender marked as spam in the Inbox is saved straight to Spam, and Drew isn't emailed.
  const spam = !test && await isBlockedSender(sb, email);
  try {
    const row = { name, email, phone, player_name: player, age_group: age, topic, message, ip, is_test: test, ...(spam ? { status: "spam" } : {}) };
    // The row is also a thread in the shared Inbox (migrations/20261020_site_inbox.sql:
    // site 'dselite', kind = topic, first message). Until that migration has run
    // the extra columns don't exist, so the plain insert is the fallback.
    let ins = await sb.from("site_inquiries").insert({ ...row, site: "dselite", kind: topic }).select("id").single();
    if (ins.error && /column/i.test(ins.error.message)) ins = await sb.from("site_inquiries").insert(row).select("id").single();
    if (ins.error) throw new Error(ins.error.message);
    id = ins.data.id;
    const { error: mErr } = await sb.from("site_inbox_messages").insert({ inquiry_id: id, direction: "in", from_name: name, from_email: email, to_email: str(process.env.SITE_CONTACT_TO, 200) || DEFAULT_TO, subject: `Website: ${TOPICS[topic]} — ${name}`, body_text: message });
    if (mErr && !/relation|does not exist|schema cache/i.test(mErr.message)) console.error("site-contact inbox message", id, mErr.message);
  } catch (e) {
    console.error("site-contact insert", e);
    return res.status(500).json({ ok: false, error: "Something went wrong sending that. Please try again, or email drew@dselitevolleyball.com." });
  }
  if (test) return res.status(200).json({ ok: true, test: true, id, message: "Test saved (no email sent)." });
  if (spam) return res.status(200).json({ ok: true, id, message: "Thanks — we got your message and will get back to you soon." });

  // The message is saved either way; a failed email only means Drew sees it in HQ.
  try {
    const key = process.env.RESEND_API_KEY || process.env.resend_api_key;
    const from = process.env.DSE_FROM_EMAIL;
    const to = str(process.env.SITE_CONTACT_TO, 200) || DEFAULT_TO;
    if (!key || !from) throw new Error("email not configured");
    const rows = [["From", `${name} <${email}>`], ["Phone", phone || phoneRaw || ""], ["Player", player || ""], ["Age group", age || ""], ["Topic", TOPICS[topic]]].filter(([, v]) => v);
    const html = `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#191919;max-width:640px">
<p style="margin:0 0 10px"><b>New message from the DS Elite website</b></p>
<table style="border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#666">${esc(k)}</td><td style="padding:2px 0">${esc(v)}</td></tr>`).join("")}</table>
<div style="margin:14px 0;padding:12px 14px;background:#f6f4f7;border-radius:8px;white-space:pre-wrap">${esc(message)}</div>
<p style="color:#888;font-size:12px">Reply to this email to answer ${esc(name)} directly. It's also in HQ → Website → Inquiries.</p></div>`;
    const text = `New message from the DS Elite website\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${message}\n\nReply to this email to answer ${name} directly.`;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], reply_to: email, subject: `Website: ${TOPICS[topic]} — ${name}`.slice(0, 180), html, text }),
    });
    if (!r.ok) throw new Error("Resend " + r.status + " " + (await r.text().catch(() => "")).slice(0, 200));
    await sb.from("site_inquiries").update({ emailed_at: new Date().toISOString() }).eq("id", id);
  } catch (e) {
    console.error("site-contact email", id, e.message);
  }
  return res.status(200).json({ ok: true, message: "Thanks — we got your message and will get back to you soon." });
}
