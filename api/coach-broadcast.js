// One announcement to every coach, by text from the club number and by app
// notification — each coach gets her own text, so a reply lands in the SMS
// inbox under Coaches, one thread per person.
//
// POST body: { sms, push_title, push_body, url?, label? }
//   sms         the text message (the link goes in the text itself)
//   push_title  / push_body  the app notification
//   url         where tapping the notification goes (app path or full URL)
//   label       what this send is, for the SMS inbox ("clock-in guide")
//
// Query: ?test=1  Drew only.   ?dry=1  list recipients, send nothing.
//        ?channels=sms,push (default both)
// Auth: the service-role key as bearer (operator script), or a signed-in
// owner / admin coach.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (+ Twilio for SMS).

import { createClient } from "@supabase/supabase-js";
import { appOrigin } from "../shared/app-origin.js";
import { sendOneSms, normalizePhone, twilioReady } from "./_lib/sms.js";

const OWNERS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const DREW = { name: "Drew Rose", email: "drew@dselitevolleyball.com", phone: "+15122029099" };
const isPlaceholder = (nm) => /assistant coach|head coach|tbd|coach needed|floater/i.test(nm || "");

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).json({ error: "POST only" }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();

  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  let who = null;
  if (bearer && bearer === SUPABASE_SERVICE_ROLE_KEY) who = "operator";
  else {
    if (!bearer) return res.status(401).json({ error: "Not signed in" });
    const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
    const email = (user?.email || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ error: "Not signed in" });
    let ok = OWNERS.includes(email);
    if (!ok) { const { data: c } = await sb.from("coaches").select("is_admin, is_approved").ilike("email", email).maybeSingle(); ok = !!(c && c.is_approved && c.is_admin); }
    if (!ok) return res.status(403).json({ error: "Admins only" });
    who = email;
  }

  let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  const sms = String(b?.sms || "").trim(), pushTitle = String(b?.push_title || "").trim(), pushBody = String(b?.push_body || "").trim();
  if (!sms && !pushTitle) return res.status(400).json({ error: "Need sms and/or push_title." });
  const test = url?.searchParams.get("test") === "1", dry = url?.searchParams.get("dry") === "1";
  const want = new Set(String(url?.searchParams.get("channels") || "sms,push").split(",").map(x => x.trim()).filter(Boolean));
  const label = String(b?.label || "coach announcement").slice(0, 60);
  const origin = appOrigin(req);
  const tapUrl = String(b?.url || "/").trim();

  const { data: roster } = await sb.from("coach_roster").select("first_name, last_name, email, phone");
  const coaches = (roster || []).map(r => ({ name: `${r.first_name || ""} ${r.last_name || ""}`.trim(), first: (r.first_name || "").trim(), email: String(r.email || "").trim().toLowerCase(), phone: normalizePhone(r.phone) }))
    .filter(c => c.name && !isPlaceholder(c.name));
  if (dry) return res.status(200).json({ ok: true, dry: true, count: coaches.length, coaches: coaches.map(c => ({ name: c.name, phone: /^\+\d{10,15}$/.test(c.phone), email: !!c.email })) });

  const targets = test ? [{ name: DREW.name, first: "Drew", email: DREW.email, phone: DREW.phone }] : coaches;
  const results = [];
  for (const c of targets) {
    const channels = []; let smsError = null;
    const text = sms.replace(/\{first\}/g, c.first || "Coach");
    if (want.has("sms") && sms && /^\+\d{10,15}$/.test(c.phone) && twilioReady()) {
      try { await sendOneSms(sb, { to: c.phone, name: c.name, kind: "coach" }, text, { sent_by_label: label }); channels.push("sms"); } catch (e) { smsError = e.message; }
    }
    if (want.has("push") && pushTitle && c.email) {
      try {
        const r = await fetch(origin + "/api/send-push", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skipEmail: true, title: pushTitle, body: pushBody.replace(/\{first\}/g, c.first || "Coach"), url: tapUrl, audience: { type: "email", email: c.email } }) });
        const o = await r.json().catch(() => ({})); if (o.sent > 0) channels.push("push");
      } catch { /* best effort */ }
    }
    results.push({ name: c.name, channels, ...(smsError ? { sms_error: smsError } : {}) });
  }
  return res.status(200).json({ ok: true, test, sent_by: who, label, sent: results.filter(r => r.channels.length).length, of: results.length, results });
}
