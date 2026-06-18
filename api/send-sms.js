// Vercel serverless function: send an outbound SMS via Twilio and record
// it in sms_messages.
//
// Env vars (set in Vercel -> Project Settings -> Environment Variables):
//   TWILIO_ACCOUNT_SID         - required.
//   TWILIO_AUTH_TOKEN          - required.
//   TWILIO_FROM_NUMBER         - required. E.164 (+15125550100).
//   SUPABASE_URL               - required (same as VITE_SUPABASE_URL).
//   SUPABASE_SERVICE_ROLE_KEY  - required (NOT the anon key — service role
//                                bypasses RLS so we can insert messages).
//
// Request body: { to: "+15551234567",
//                 body: "Hi! Reminder about ...",
//                 player_id?: 123,            // optional link to a player row
//                 sent_by_coach_id?: "uuid",  // optional, denormalized for inbox
//                 sent_by_label?: "Drew" }
// Response: { ok: true, message_id, twilio_sid, status, thread_id }
//        or { error: "<message>" } on failure.

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

  const { to, body, player_id, sent_by_coach_id, sent_by_label } = req.body || {};
  const phone = normalizePhone(to);
  const text = (body || "").trim();
  if (!phone || !/^\+\d{8,15}$/.test(phone)) return res.status(400).json({ error: "Invalid 'to' phone number." });
  if (!text) return res.status(400).json({ error: "Empty 'body'." });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Find or create the thread for this phone.
  let { data: thread, error: tErr } = await supabase
    .from("sms_threads")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();
  if (tErr) return res.status(500).json({ error: "Thread lookup failed: " + tErr.message });
  if (!thread) {
    const insert = { phone, player_id: player_id || null };
    const ins = await supabase.from("sms_threads").insert(insert).select().single();
    if (ins.error) return res.status(500).json({ error: "Thread create failed: " + ins.error.message });
    thread = ins.data;
  } else if (player_id && thread.player_id !== player_id) {
    // Lazy link an existing thread to this player when first associated.
    await supabase.from("sms_threads").update({ player_id }).eq("id", thread.id);
  }

  // Insert the message in 'queued' state so the UI can show it immediately
  // even if Twilio is slow to ack.
  const msgInsert = await supabase
    .from("sms_messages")
    .insert({
      thread_id: thread.id,
      direction: "outbound",
      body: text,
      status: "queued",
      sent_by_coach_id: sent_by_coach_id || null,
      sent_by_label: sent_by_label || null,
    })
    .select()
    .single();
  if (msgInsert.error) return res.status(500).json({ error: "Message insert failed: " + msgInsert.error.message });
  const message = msgInsert.data;

  // Send via Twilio.
  const tw = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      From: TWILIO_FROM_NUMBER,
      To: phone,
      Body: text,
    }),
  });
  const twData = await tw.json();
  if (!tw.ok) {
    await supabase.from("sms_messages").update({
      status: "failed",
      error_code: String(twData.code || tw.status),
      error_message: twData.message || "Twilio request failed",
    }).eq("id", message.id);
    return res.status(500).json({ error: twData.message || "Twilio request failed", code: twData.code });
  }

  const now = new Date().toISOString();
  await supabase.from("sms_messages").update({
    twilio_sid: twData.sid,
    status: twData.status || "sending",
    sent_at: now,
  }).eq("id", message.id);
  await supabase.from("sms_threads").update({
    last_message_at: now,
    last_message_preview: text.length > 140 ? text.slice(0, 137) + "…" : text,
    last_message_direction: "outbound",
    updated_at: now,
  }).eq("id", thread.id);

  return res.status(200).json({
    ok: true,
    message_id: message.id,
    twilio_sid: twData.sid,
    status: twData.status || "sending",
    thread_id: thread.id,
  });
}
