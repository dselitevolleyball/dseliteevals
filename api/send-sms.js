// Vercel serverless function: send outbound SMS via Twilio and record it in
// sms_messages — one number, or a whole team / the coaching staff at once.
//
// A group send is NOT a group text. Each recipient gets her own message from
// the club number and her own thread; replies come back one-to-one and nobody
// sees anyone else. The send as a whole is remembered in sms_broadcasts so the
// inbox can show "this went to 14 Emerald parents".
//
// The actual Twilio call and thread bookkeeping live in api/_lib/sms.js, which
// the crons use too; this is the signed-in front door.
//
// Env vars (set in Vercel -> Project Settings -> Environment Variables):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER (E.164)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (service role, NOT the anon key)
//
// Request body, one of:
//   { to: "+15551234567", body, player_id?, team_name?, contact_kind?, contact_name?, sent_by_coach_id?, sent_by_label? }
//   { recipients: [{ to, name?, player_id?, team_name?, kind? }, ...], body, audience?, sent_by_coach_id?, sent_by_label? }
// Response (single):  { ok, message_id, twilio_sid, status, thread_id }
// Response (batch):   { ok, broadcast_id, sent, failed: [{ to, name, error }], thread_ids }
//                 or  { error } on a request-level failure.

import { createClient } from "@supabase/supabase-js";
import { sendOneSms, normalizePhone, twilioReady } from "./_lib/sms.js";

const LANES = 4;   // concurrent Twilio requests; Twilio queues per number anyway

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!twilioReady()) return res.status(500).json({ error: "Twilio not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER." });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Supabase service role not configured." });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // Signed-in admins only. Until 13 September this endpoint checked nothing:
  // with the Twilio credentials live in production, anyone who found the URL
  // could text anyone from the club's number on the club's account. Same check
  // as api/sportsyou-outbox.js — an owner email, or an approved admin coach.
  {
    const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!bearer) return res.status(401).json({ error: "Not signed in" });
    const { data: { user } = {} } = await supabase.auth.getUser(bearer).catch(() => ({ data: {} }));
    const email = (user?.email || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ error: "Not signed in" });
    let ok = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"].includes(email);
    if (!ok) {
      const { data: c } = await supabase.from("coaches").select("is_admin, is_approved").ilike("email", email).maybeSingle();
      ok = !!(c && c.is_approved && c.is_admin);
    }
    if (!ok) return res.status(403).json({ error: "Admins only" });
  }

  const b = req.body || {};
  const text = String(b.body || "").trim();
  if (!text) return res.status(400).json({ error: "Empty 'body'." });
  const meta = { sent_by_coach_id: b.sent_by_coach_id || null, sent_by_label: b.sent_by_label || null };

  // Normalise the two request shapes into one list.
  const batch = Array.isArray(b.recipients);
  const list = batch
    ? b.recipients.map(r => ({ to: normalizePhone(r?.to), name: r?.name || null, player_id: r?.player_id || null, team_name: r?.team_name || null, kind: r?.kind || null }))
    : [{ to: normalizePhone(b.to), name: b.contact_name || null, player_id: b.player_id || null, team_name: b.team_name || null, kind: b.contact_kind || null }];
  const valid = list.filter(r => /^\+\d{8,15}$/.test(r.to));
  if (!valid.length) return res.status(400).json({ error: batch ? "No valid phone numbers in 'recipients'." : "Invalid 'to' phone number." });
  // One text per number, even if a parent is listed under two players.
  const seen = new Set();
  const recipients = valid.filter(r => (seen.has(r.to) ? false : seen.add(r.to)));

  if (!batch) {
    try { return res.status(200).json({ ok: true, ...(await sendOneSms(supabase, recipients[0], text, meta)) }); }
    catch (e) { return res.status(500).json({ error: e.message, code: e.code }); }
  }

  // A batch is remembered as one broadcast before anything goes out, so a
  // send that dies half-way still shows what it was meant to be.
  const ins = await supabase.from("sms_broadcasts").insert({ body: text, audience: b.audience || null, recipient_count: recipients.length, ...meta }).select("id").single();
  if (ins.error) return res.status(500).json({ error: "Broadcast record failed: " + ins.error.message });
  const broadcastId = ins.data.id;

  const results = [], failed = [];
  let i = 0;
  const worker = async () => {
    while (i < recipients.length) {
      const r = recipients[i++];
      try { results.push({ ...(await sendOneSms(supabase, r, text, { ...meta, broadcast_id: broadcastId })), to: r.to }); }
      catch (e) { failed.push({ to: r.to, name: r.name, error: e.message }); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(LANES, recipients.length) }, worker));
  await supabase.from("sms_broadcasts").update({ sent_count: results.length, failed_count: failed.length }).eq("id", broadcastId);
  return res.status(200).json({ ok: true, broadcast_id: broadcastId, sent: results.length, failed, thread_ids: results.map(x => x.thread_id) });
}
