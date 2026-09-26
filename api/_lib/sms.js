// One text from a club number, recorded in the SMS inbox.
//
// The one door every server-side text goes through, so a message sent by a
// cron (the monthly privates ask) lands in the same thread as one sent from
// the Messages screen, and a reply to either files under the same person.
// api/send-sms.js is the signed-in front door to this; crons call it direct.
//
// Two brands, two numbers. 'dse' is DS Elite Volleyball (TWILIO_FROM_NUMBER);
// 'dssc' is Dripping Springs Sports Club (DSSC_TWILIO_FROM_NUMBER, or a
// messaging service SID). Threads are per (phone, brand), so a parent who
// deals with both has two separate conversations and each screen shows its
// own.

export const normalizePhone = (raw) => {
  if (!raw) return "";
  const digits = String(raw).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return digits.startsWith("+") ? digits : "+" + digits;
};
const preview = (text) => (text.length > 140 ? text.slice(0, 137) + "…" : text);
export const BRANDS = ["dse", "dssc"];
export const brandOf = (b) => (b === "dssc" ? "dssc" : "dse");

// The From side for a brand: a messaging service if one is set, else the number.
export function senderFor(brand) {
  const e = process.env;
  if (brandOf(brand) === "dssc") {
    if (e.DSSC_TWILIO_MESSAGING_SERVICE_SID) return { MessagingServiceSid: e.DSSC_TWILIO_MESSAGING_SERVICE_SID };
    if (e.DSSC_TWILIO_FROM_NUMBER) return { From: e.DSSC_TWILIO_FROM_NUMBER };
    return null;
  }
  if (e.TWILIO_MESSAGING_SERVICE_SID) return { MessagingServiceSid: e.TWILIO_MESSAGING_SERVICE_SID };
  if (e.TWILIO_FROM_NUMBER) return { From: e.TWILIO_FROM_NUMBER };
  return null;
}
export function twilioReady(brand = "dse") {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && senderFor(brand));
}
export const notReadyMessage = (brand) => brandOf(brand) === "dssc"
  ? "DSSC texting isn't switched on yet: set DSSC_TWILIO_FROM_NUMBER (the club's Twilio number) in Vercel once the campaign is approved."
  : "Twilio not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.";

// Find or create the thread for a phone + brand, filling in who it belongs to
// when that is known and the thread doesn't say yet.
export async function threadFor(supabase, r) {
  const brand = brandOf(r.brand);
  let { data: thread, error } = await supabase.from("sms_threads").select("*").eq("phone", r.to).eq("brand", brand).maybeSingle();
  if (error) throw new Error("Thread lookup failed: " + error.message);
  if (!thread) {
    const ins = await supabase.from("sms_threads").insert({
      phone: r.to, brand, player_id: r.player_id || null, team_name: r.team_name || null, contact_kind: r.kind || null, contact_name: r.name || null,
      dssc_program: r.dssc_program || null, dssc_player: r.dssc_player || null,
    }).select().single();
    if (ins.error) throw new Error("Thread create failed: " + ins.error.message);
    return ins.data;
  }
  const patch = {};
  if (r.player_id && thread.player_id !== r.player_id) patch.player_id = r.player_id;
  if (r.team_name && thread.team_name !== r.team_name) patch.team_name = r.team_name;
  if (r.kind && !thread.contact_kind) patch.contact_kind = r.kind;
  if (r.name && !thread.contact_name) patch.contact_name = r.name;
  if (r.dssc_program && thread.dssc_program !== r.dssc_program) patch.dssc_program = r.dssc_program;
  if (r.dssc_player && !thread.dssc_player) patch.dssc_player = r.dssc_player;
  if (Object.keys(patch).length) await supabase.from("sms_threads").update(patch).eq("id", thread.id);
  return thread;
}

// r: { to (E.164), brand?, name?, kind?, player_id?, team_name?, dssc_program?, dssc_player? }
// meta: { broadcast_id?, sent_by_coach_id?, sent_by_label?, media_urls? }
// Resolves { message_id, twilio_sid, status, thread_id }; throws with .code / .thread_id on a Twilio refusal.
export async function sendOneSms(supabase, r, text, meta = {}) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  const brand = brandOf(r.brand);
  const sender = senderFor(brand);
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !sender) throw new Error(notReadyMessage(brand));
  const media = (Array.isArray(meta.media_urls) ? meta.media_urls : []).filter(u => /^https?:\/\//.test(String(u))).slice(0, 10);
  const thread = await threadFor(supabase, { ...r, brand });
  // Insert the message in 'queued' state so the UI can show it immediately
  // even if Twilio is slow to ack.
  const msgInsert = await supabase.from("sms_messages").insert({
    thread_id: thread.id, direction: "outbound", body: text, status: "queued", media_urls: media,
    broadcast_id: meta.broadcast_id || null, sent_by_coach_id: meta.sent_by_coach_id || null, sent_by_label: meta.sent_by_label || null,
  }).select().single();
  if (msgInsert.error) throw new Error("Message insert failed: " + msgInsert.error.message);
  const message = msgInsert.data;

  const form = new URLSearchParams({
    ...sender, To: r.to, Body: text,
    // Ask Twilio to report what happened after it accepted the message.
    // Without this every text sat at "queued" forever: the June texts were
    // accepted and then blocked by the carriers, and the app never heard.
    StatusCallback: process.env.PUBLIC_WEBHOOK_URL || "https://dseliteevals.vercel.app/api/sms-webhook",
  });
  for (const u of media) form.append("MediaUrl", u);   // MMS: pictures from a class, etc.
  const tw = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const twData = await tw.json().catch(() => ({}));
  if (!tw.ok) {
    await supabase.from("sms_messages").update({ status: "failed", error_code: String(twData.code || tw.status), error_message: twData.message || "Twilio request failed" }).eq("id", message.id);
    const err = new Error(twData.message || "Twilio request failed"); err.code = twData.code; err.thread_id = thread.id; throw err;
  }
  const now = new Date().toISOString();
  await supabase.from("sms_messages").update({ twilio_sid: twData.sid, status: twData.status || "sending", sent_at: now }).eq("id", message.id);
  await supabase.from("sms_threads").update({ last_message_at: now, last_message_preview: preview(text || (media.length ? "📷 photo" : "")), last_message_direction: "outbound", updated_at: now }).eq("id", thread.id);
  return { message_id: message.id, twilio_sid: twData.sid, status: twData.status || "sending", thread_id: thread.id };
}
