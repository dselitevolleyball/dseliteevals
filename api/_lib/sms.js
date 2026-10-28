// One text from a club number, recorded in the SMS inbox.
//
// The one door every server-side text goes through, so a message sent by a
// cron (the monthly privates ask) lands in the same thread as one sent from
// the Messages screen, and a reply to either files under the same person.
// api/send-sms.js is the signed-in front door to this; crons call it direct.
//
// Two brands, two numbers. 'dse' is DS Elite Volleyball (TWILIO_FROM_NUMBER);
// 'dssc' is Dripping Springs Sports Club (DSSC_TWILIO_FROM_NUMBER, or a
// messaging service SID). Threads are per (phone, brand, lane), so a parent
// who deals with both has two separate conversations and each screen shows its
// own. Club threads also have a lane (shared/dssc-lanes.js): Volleyball,
// Basketball, Reach or the front desk, one conversation per lane.

import { splitSms, smsPlain } from "../../shared/sms-split.js";
import { isUsPhone } from "../../shared/phone.js";
import { isLane, laneOfText, laneOfPerson } from "../../shared/dssc-lanes.js";

// "" for a US number that can't exist (shared/phone.js), so callers' checks refuse it.
export const normalizePhone = (raw) => {
  if (!raw) return "";
  const digits = String(raw).replace(/[^\d+]/g, "");
  const out = digits.startsWith("+") ? digits : digits.length === 10 ? "+1" + digits : "+" + digits;
  return /^\+1\d{10}$/.test(out) && !isUsPhone(out) ? "" : out;
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

// The lane a club text goes in: the one asked for; else the program's sport
// (a Reach program is Reach's even when it's volleyball); else the sender's
// own lane; else the front desk. DS Elite has no lanes ("").
export async function laneFor(supabase, r, meta = {}) {
  if (brandOf(r.brand) !== "dssc") return "";
  if (isLane(r.lane)) return r.lane;
  const prog = String(r.dssc_program || "").trim();
  if (prog) {
    if (laneOfText(prog) === "reach") return "reach";
    const { data } = await supabase.from("dssc_clinics").select("sport").eq("name", prog).limit(1);
    if (isLane(data?.[0]?.sport)) return data[0].sport;
    if (laneOfText(prog)) return laneOfText(prog);
  }
  if (meta.sent_by_coach_id) {
    const { data: c } = await supabase.from("coaches").select("email, sports, staff_view").eq("id", meta.sent_by_coach_id).maybeSingle();
    if (laneOfPerson(c)) return laneOfPerson(c);
  }
  return "general";
}

// Find or create the thread for a phone + brand + lane, filling in who it
// belongs to when that is known and the thread doesn't say yet.
export async function threadFor(supabase, r, meta = {}) {
  const brand = brandOf(r.brand);
  const lane = await laneFor(supabase, { ...r, brand }, meta);
  let { data: thread, error } = await supabase.from("sms_threads").select("*").eq("phone", r.to).eq("brand", brand).eq("lane", lane).maybeSingle();
  if (error) throw new Error("Thread lookup failed: " + error.message);
  if (!thread) {
    const ins = await supabase.from("sms_threads").insert({
      phone: r.to, brand, lane, player_id: r.player_id || null, team_name: r.team_name || null, contact_kind: r.kind || null, contact_name: r.name || null,
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

// The thread a club reply belongs in: the lane of the last text we sent that
// number (Adrian's basketball text gets its answer in Basketball), else the
// thread they last wrote in, else a new front-desk thread (null).
export async function replyThreadFor(supabase, phone, brand) {
  const { data: threads } = await supabase.from("sms_threads").select("*").eq("phone", phone).eq("brand", brandOf(brand));
  if (!threads?.length) return null;
  if (threads.length === 1) return threads[0];
  const { data: last } = await supabase.from("sms_messages").select("thread_id").in("thread_id", threads.map(t => t.id)).eq("direction", "outbound").order("id", { ascending: false }).limit(1);
  return threads.find(t => t.id === last?.[0]?.thread_id)
    || [...threads].sort((a, b) => String(b.last_message_at || "").localeCompare(String(a.last_message_at || "")))[0];
}

// r: { to (E.164), brand?, lane?, name?, kind?, player_id?, team_name?, dssc_program?, dssc_player? }
// meta: { broadcast_id?, sent_by_coach_id?, sent_by_label?, media_urls? }
// Resolves { message_id, twilio_sid, status, thread_id }; throws with .code / .thread_id on a Twilio refusal.
// "{first}" in a text becomes the first name of the person THIS text goes to,
// so a greeting never names the other parent (Oct 2026: "Hi Fernanda and
// Antonio" went to each of them, and to the wrong families). "Coach Tara
// Fisher" -> "Tara"; no name on file -> "there".
export const personalizeSms = (text, r) => {
  const first = String(r?.name || "").trim().replace(/^coach\s+/i, "").split(/\s+/)[0] || "";
  return String(text || "").replace(/\{first\}/gi, first || "there");
};

export async function sendOneSms(supabase, r, text, meta = {}) {
  // Plain characters only and ~600 characters a text: emoji or smart quotes in
  // a long text got 53 of Coach Hunter's 124 Oct 11 texts dropped by carriers
  // (30019). Longer goes out as numbered parts, in order, photos riding on the
  // first one. Callers get the last part's result.
  text = smsPlain(personalizeSms(text, r));
  const parts = splitSms(text);
  if (parts.length > 1) {
    let res;
    for (let i = 0; i < parts.length; i++) res = await sendOneSms(supabase, r, parts[i], i === 0 ? meta : { ...meta, media_urls: [] });
    return { ...res, parts: parts.length };
  }
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  const brand = brandOf(r.brand);
  const sender = senderFor(brand);
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !sender) throw new Error(notReadyMessage(brand));
  // Unsubscribed numbers never get texts (Drew, Oct 11 2026): a STOP reply is
  // recorded by the webhook, and staff can unsubscribe someone from the inbox.
  // Brand-scoped: a STOP to DSSC doesn't stop DS Elite. If the lookup itself
  // fails the text still goes - Twilio still refuses true STOP numbers.
  const d10 = String(r.to || "").replace(/\D/g, "").slice(-10);
  if (d10.length === 10) {
    const { data: out, error: outErr } = await supabase.from("sms_optouts").select("phone").eq("brand", brand).like("phone", "%" + d10).limit(1);
    if (!outErr && out && out.length) { const err = new Error("Unsubscribed: this number replied STOP or was unsubscribed in the inbox, so it wasn't texted."); err.code = "opted_out"; throw err; }
  }
  const media = (Array.isArray(meta.media_urls) ? meta.media_urls : []).filter(u => /^https?:\/\//.test(String(u))).slice(0, 10);
  const thread = await threadFor(supabase, { ...r, brand }, meta);
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
