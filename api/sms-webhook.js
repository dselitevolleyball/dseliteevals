// Vercel serverless function: Twilio inbound + status webhook.
//
// Configure both URLs in the Twilio console for BOTH numbers (DS Elite and
// DSSC) — the brand is worked out from the number the text arrived on:
//   - "A Message Comes In":    https://<your-domain>/api/sms-webhook
//   - "Status callback URL":   https://<your-domain>/api/sms-webhook
//
// Twilio sends application/x-www-form-urlencoded bodies. We auto-detect
// inbound (has a 'Body') vs status callback (has 'MessageStatus' / 'SmsStatus').
//
// Env vars:
//   TWILIO_AUTH_TOKEN          - required, used to verify the X-Twilio-Signature.
//   SUPABASE_URL               - required.
//   SUPABASE_SERVICE_ROLE_KEY  - required.
//   PUBLIC_WEBHOOK_URL         - optional explicit URL Twilio is hitting; if
//                                unset we reconstruct from the request.

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Parse application/x-www-form-urlencoded body. Vercel's default body parser
// already handles this — req.body is an object.
const parseBody = (req) => {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    const out = {};
    for (const [k, v] of new URLSearchParams(req.body)) out[k] = v;
    return out;
  }
  return req.body;
};

// Twilio's signature: HMAC-SHA1 of the URL + sorted form params, base64.
// See https://www.twilio.com/docs/usage/webhooks/webhooks-security
const validateSignature = (authToken, signature, url, params) => {
  if (!authToken || !signature) return false;
  const sorted = Object.keys(params).sort().map(k => k + params[k]).join("");
  const expected = crypto
    .createHmac("sha1", authToken)
    .update(url + sorted)
    .digest("base64");
  // Constant-time compare
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const reconstructUrl = (req) => {
  if (process.env.PUBLIC_WEBHOOK_URL) return process.env.PUBLIC_WEBHOOK_URL;
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return proto + "://" + host + req.url;
};

const normalizePhone = (raw) => {
  if (!raw) return "";
  const digits = String(raw).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return digits.startsWith("+") ? digits : "+" + digits;
};

// Which business a text belongs to: the number it arrived on.
const brandForTo = (to) => {
  const d = String(to || "").replace(/\D/g, "").slice(-10);
  const dssc = String(process.env.DSSC_TWILIO_FROM_NUMBER || "").replace(/\D/g, "").slice(-10);
  return dssc && d === dssc ? "dssc" : "dse";
};
// DSSC: who a number belongs to, from the class rosters and the opt-in form.
async function whoIsDssc(supabase, phone) {
  const d = String(phone).replace(/\D/g, "").slice(-10);
  const { data: c } = await supabase.from("sms_consents").select("name, player_name").eq("brand", "dssc").eq("phone", phone).maybeSingle();
  const { data: rs } = await supabase.from("dssc_pod_roster").select("player_name, parent_name, parent_phone, clinic_id, dssc_clinics(name)").not("parent_phone", "is", null).order("created_at", { ascending: false }).limit(2000);
  const hit = (rs || []).find(r => String(r.parent_phone || "").replace(/\D/g, "").slice(-10) === d);
  if (hit) return { contact_kind: "parent", contact_name: c?.name || hit.parent_name || (hit.player_name + "'s parent"), dssc_player: hit.player_name, dssc_program: hit.dssc_clinics?.name || null };
  if (c) return { contact_kind: "parent", contact_name: c.name || null, dssc_player: c.player_name || null };
  const { data: cs } = await supabase.from("coach_roster").select("first_name, last_name, phone");
  for (const k of cs || []) if (String(k.phone || "").replace(/\D/g, "").slice(-10) === d) return { contact_kind: "coach", contact_name: ((k.first_name || "") + " " + (k.last_name || "")).trim() };
  return {};
}

// Who a phone number belongs to, from the player roster (parents and players)
// or the coach roster. Numbers are compared on their last ten digits because
// the roster stores them however a parent typed them.
async function whoIs(supabase, phone) {
  const last10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
  const d = last10(phone);
  if (d.length !== 10) return {};
  const { data: ps } = await supabase.from("players")
    .select("id, first_name, last_name, team_assignment, offer_status, parent_name, parent2_name, parent_phone, parent2_phone, player_phone");
  const live = (ps || []).filter(p => !["declined", "not_invited", "opted_out"].includes(p.offer_status || ""));
  for (const p of [...live, ...(ps || []).filter(p => !live.includes(p))]) {
    const team = p.team_assignment || null;
    if (last10(p.parent_phone) === d)  return { player_id: p.id, team_name: team, contact_kind: "parent", contact_name: p.parent_name || (p.first_name + "'s parent") };
    if (last10(p.parent2_phone) === d) return { player_id: p.id, team_name: team, contact_kind: "parent", contact_name: p.parent2_name || (p.first_name + "'s parent") };
    if (last10(p.player_phone) === d)  return { player_id: p.id, team_name: team, contact_kind: "player", contact_name: p.first_name + " " + p.last_name };
  }
  const { data: cs } = await supabase.from("coach_roster").select("first_name, last_name, phone");
  for (const c of cs || []) {
    if (last10(c.phone) === d) return { contact_kind: "coach", contact_name: ((c.first_name || "") + " " + (c.last_name || "")).trim() };
  }
  return {};
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).send("Method not allowed");
  }
  const {
    TWILIO_AUTH_TOKEN,
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  } = process.env;
  if (!TWILIO_AUTH_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).send("Server not configured");
  }

  const params = parseBody(req);
  const url = reconstructUrl(req);
  const signature = req.headers["x-twilio-signature"];
  if (!validateSignature(TWILIO_AUTH_TOKEN, signature, url, params)) {
    console.error("Invalid Twilio signature", { url, signaturePresent: !!signature });
    return res.status(403).send("Invalid signature");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Status callback (delivery / read / failed update for an outbound message).
  const isStatus = !!(params.MessageStatus || params.SmsStatus) && !params.Body;
  if (isStatus) {
    const sid = params.MessageSid || params.SmsSid;
    const status = params.MessageStatus || params.SmsStatus;
    const errorCode = params.ErrorCode || null;
    if (!sid) return res.status(200).send("ok");
    const patch = { status };
    if (status === "delivered") patch.delivered_at = new Date().toISOString();
    if (errorCode) patch.error_code = errorCode;
    await supabase.from("sms_messages").update(patch).eq("twilio_sid", sid);
    return res.status(200).send("ok");
  }

  // Inbound message.
  const from = normalizePhone(params.From);
  const brand = brandForTo(params.To);
  // An MMS can arrive with no text at all; keep the picture links in the body.
  const nMedia = Number(params.NumMedia || 0) || 0;
  const mediaIn = []; for (let i = 0; i < nMedia; i++) if (params["MediaUrl" + i]) mediaIn.push(params["MediaUrl" + i]);
  const body = (params.Body || "") || (mediaIn.length ? "📷 (photo)" : "");
  const sid  = params.MessageSid || params.SmsSid;
  if (!from || !body) return res.status(200).send("ok");

  // Find or create the thread. A number we've never texted is still very
  // likely a parent, player or coach we know — match it against the roster so
  // the inbox files the reply under her team instead of "Other".
  let { data: thread } = await supabase
    .from("sms_threads")
    .select("*")
    .eq("phone", from)
    .eq("brand", brand)
    .maybeSingle();
  if (!thread || (!thread.contact_kind && !thread.player_id)) {
    const who = brand === "dssc" ? await whoIsDssc(supabase, from) : await whoIs(supabase, from);
    if (!thread) {
      const ins = await supabase
        .from("sms_threads")
        .insert({ phone: from, brand, ...who })
        .select()
        .single();
      if (ins.error) {
        console.error("Thread create failed:", ins.error);
        return res.status(500).send("DB error");
      }
      thread = ins.data;
    } else if (Object.keys(who).length) {
      await supabase.from("sms_threads").update(who).eq("id", thread.id);
    }
  }

  // Insert message. Dedup on twilio_sid in case Twilio retries.
  const msgIns = await supabase.from("sms_messages").insert({
    thread_id: thread.id,
    direction: "inbound",
    body,
    twilio_sid: sid || null,
    status: "received",
    media_urls: mediaIn,
    sent_at: new Date().toISOString(),
  });
  if (msgIns.error && !/duplicate key/.test(msgIns.error.message || "")) {
    console.error("Message insert failed:", msgIns.error);
    return res.status(500).send("DB error");
  }

  // Bump thread metadata. Coalesce unread_count via raw RPC since we can't
  // do "field = field + 1" via .update(). Easiest: read current value, +1.
  const preview = body.length > 140 ? body.slice(0, 137) + "…" : body;
  const newUnread = (thread.unread_count || 0) + 1;
  const now = new Date().toISOString();
  await supabase.from("sms_threads").update({
    last_message_at: now,
    last_message_preview: preview,
    last_message_direction: "inbound",
    unread_count: newUnread,
    updated_at: now,
  }).eq("id", thread.id);

  // Empty 200 ack — no TwiML auto-reply for now.
  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send("<Response/>");
}
