// Vercel serverless function: send outbound SMS via Twilio and record it in
// sms_messages — one number, or a whole team / the coaching staff at once.
//
// A group send is NOT a group text. Each recipient gets her own message from
// the club number and her own thread; replies come back one-to-one and nobody
// sees anyone else. The send as a whole is remembered in sms_broadcasts so the
// inbox can show "this went to 14 Emerald parents".
//
// Env vars (set in Vercel -> Project Settings -> Environment Variables):
//   TWILIO_ACCOUNT_SID         - required.
//   TWILIO_AUTH_TOKEN          - required.
//   TWILIO_FROM_NUMBER         - required. E.164 (+15125550100).
//   SUPABASE_URL               - required (same as VITE_SUPABASE_URL).
//   SUPABASE_SERVICE_ROLE_KEY  - required (NOT the anon key — service role
//                                bypasses RLS so we can insert messages).
//
// Request body, one of:
//   { to: "+15551234567", body, player_id?, team_name?, contact_kind?, contact_name?, sent_by_coach_id?, sent_by_label? }
//   { recipients: [{ to, name?, player_id?, team_name?, kind? }, ...], body, audience?, sent_by_coach_id?, sent_by_label? }
// Response (single):  { ok, message_id, twilio_sid, status, thread_id }
// Response (batch):   { ok, broadcast_id, sent, failed: [{ to, name, error }], thread_ids }
//                 or  { error } on a request-level failure.

import { createClient } from "@supabase/supabase-js";

const normalizePhone = (raw) => {
  if (!raw) return "";
  const digits = String(raw).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  // US default — prepend +1 for 10-digit numbers; pass-through for 11+ with leading 1
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return digits.startsWith("+") ? digits : "+" + digits;
};
const preview = (text) => (text.length > 140 ? text.slice(0, 137) + "…" : text);
const LANES = 4;   // concurrent Twilio requests; Twilio queues per number anyway

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER,
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    return res.status(500).json({ error: "Twilio not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER." });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Supabase service role not configured." });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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
  const sentBy = { sent_by_coach_id: b.sent_by_coach_id || null, sent_by_label: b.sent_by_label || null };

  // Normalise the two request shapes into one list.
  const list = Array.isArray(b.recipients)
    ? b.recipients.map(r => ({ to: normalizePhone(r?.to), name: r?.name || null, player_id: r?.player_id || null, team_name: r?.team_name || null, kind: r?.kind || null }))
    : [{ to: normalizePhone(b.to), name: b.contact_name || null, player_id: b.player_id || null, team_name: b.team_name || null, kind: b.contact_kind || null }];
  const batch = Array.isArray(b.recipients);
  const valid = list.filter(r => /^\+\d{8,15}$/.test(r.to));
  if (!valid.length) return res.status(400).json({ error: batch ? "No valid phone numbers in 'recipients'." : "Invalid 'to' phone number." });
  // One text per number, even if a parent is listed under two players.
  const seen = new Set();
  const recipients = valid.filter(r => (seen.has(r.to) ? false : seen.add(r.to)));

  // A batch is remembered as one broadcast before anything goes out, so a
  // send that dies half-way still shows what it was meant to be.
  let broadcastId = null;
  if (batch) {
    const ins = await supabase.from("sms_broadcasts").insert({
      body: text, audience: b.audience || null, recipient_count: recipients.length, ...sentBy,
    }).select("id").single();
    if (ins.error) return res.status(500).json({ error: "Broadcast record failed: " + ins.error.message });
    broadcastId = ins.data.id;
  }

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const twilioAuth = "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  const statusCallback = process.env.PUBLIC_WEBHOOK_URL || "https://dseliteevals.vercel.app/api/sms-webhook";

  // Find or create the thread for a phone, filling in who it belongs to when
  // that is known and the thread doesn't say yet.
  const threadFor = async (r) => {
    let { data: thread, error } = await supabase.from("sms_threads").select("*").eq("phone", r.to).maybeSingle();
    if (error) throw new Error("Thread lookup failed: " + error.message);
    if (!thread) {
      const ins = await supabase.from("sms_threads").insert({
        phone: r.to, player_id: r.player_id, team_name: r.team_name, contact_kind: r.kind, contact_name: r.name,
      }).select().single();
      if (ins.error) throw new Error("Thread create failed: " + ins.error.message);
      return ins.data;
    }
    const patch = {};
    if (r.player_id && thread.player_id !== r.player_id) patch.player_id = r.player_id;
    if (r.team_name && thread.team_name !== r.team_name) patch.team_name = r.team_name;
    if (r.kind && !thread.contact_kind) patch.contact_kind = r.kind;
    if (r.name && !thread.contact_name) patch.contact_name = r.name;
    if (Object.keys(patch).length) await supabase.from("sms_threads").update(patch).eq("id", thread.id);
    return thread;
  };

  const sendOne = async (r) => {
    const thread = await threadFor(r);
    // Insert the message in 'queued' state so the UI can show it immediately
    // even if Twilio is slow to ack.
    const msgInsert = await supabase.from("sms_messages").insert({
      thread_id: thread.id, direction: "outbound", body: text, status: "queued", broadcast_id: broadcastId, ...sentBy,
    }).select().single();
    if (msgInsert.error) throw new Error("Message insert failed: " + msgInsert.error.message);
    const message = msgInsert.data;

    const tw = await fetch(twilioUrl, {
      method: "POST",
      headers: { Authorization: twilioAuth, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        From: TWILIO_FROM_NUMBER, To: r.to, Body: text,
        // Ask Twilio to report what happened after it accepted the message.
        // Without this every text sat at "queued" forever: the June texts were
        // accepted and then blocked by the carriers, and the app never heard.
        // A number's console settings don't cover API sends — it has to be here.
        StatusCallback: statusCallback,
      }),
    });
    const twData = await tw.json().catch(() => ({}));
    if (!tw.ok) {
      await supabase.from("sms_messages").update({
        status: "failed", error_code: String(twData.code || tw.status), error_message: twData.message || "Twilio request failed",
      }).eq("id", message.id);
      const err = new Error(twData.message || "Twilio request failed"); err.code = twData.code; err.thread_id = thread.id; throw err;
    }
    const now = new Date().toISOString();
    await supabase.from("sms_messages").update({ twilio_sid: twData.sid, status: twData.status || "sending", sent_at: now }).eq("id", message.id);
    await supabase.from("sms_threads").update({
      last_message_at: now, last_message_preview: preview(text), last_message_direction: "outbound", updated_at: now,
    }).eq("id", thread.id);
    return { message_id: message.id, twilio_sid: twData.sid, status: twData.status || "sending", thread_id: thread.id };
  };

  if (!batch) {
    try {
      const out = await sendOne(recipients[0]);
      return res.status(200).json({ ok: true, ...out });
    } catch (e) {
      return res.status(500).json({ error: e.message, code: e.code });
    }
  }

  const results = [], failed = [];
  let i = 0;
  const worker = async () => {
    while (i < recipients.length) {
      const r = recipients[i++];
      try { results.push({ ...(await sendOne(r)), to: r.to }); }
      catch (e) { failed.push({ to: r.to, name: r.name, error: e.message }); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(LANES, recipients.length) }, worker));
  await supabase.from("sms_broadcasts").update({ sent_count: results.length, failed_count: failed.length }).eq("id", broadcastId);
  return res.status(200).json({ ok: true, broadcast_id: broadcastId, sent: results.length, failed, thread_ids: results.map(x => x.thread_id) });
}
