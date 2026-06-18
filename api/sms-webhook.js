// Vercel serverless function: Twilio inbound + status webhook.
//
// Configure both URLs in the Twilio console for your DS Elite phone number:
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
  const body = params.Body || "";
  const sid  = params.MessageSid || params.SmsSid;
  if (!from || !body) return res.status(200).send("ok");

  // Find or create the thread.
  let { data: thread } = await supabase
    .from("sms_threads")
    .select("*")
    .eq("phone", from)
    .maybeSingle();
  if (!thread) {
    const ins = await supabase
      .from("sms_threads")
      .insert({ phone: from })
      .select()
      .single();
    if (ins.error) {
      console.error("Thread create failed:", ins.error);
      return res.status(500).send("DB error");
    }
    thread = ins.data;
  }

  // Insert message. Dedup on twilio_sid in case Twilio retries.
  const msgIns = await supabase.from("sms_messages").insert({
    thread_id: thread.id,
    direction: "inbound",
    body,
    twilio_sid: sid || null,
    status: "received",
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
