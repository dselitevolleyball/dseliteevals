// Slack -> the email assistant, for its own app "DSSC Mail" (Drew, Oct 29
// 2026: one Slack app for email, one for everything else). The app's
// Interactivity and Event Subscriptions both point here; its manifest is in
// MAIL_ASSISTANT_SETUP.md.
//   Buttons   Send / Edit / Skip on a drafted reply (api/_lib/mail-slack.js)
//   Edit box  submitted -> sent
//   Replies   in a card's thread: rewrite it, "reply: ...", "send", "skip"
// Every request is checked against the app's Signing Secret (saved in HQ ->
// Product -> Settings -> Email assistant); Slack's one-time URL check is
// answered before that's saved, since it carries nothing but a challenge.

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";
import { mailSlackCfg } from "./_lib/mail-assistant.js";
import { isMailAction, onMailButton, onMailEditSubmit, onMailReply } from "./_lib/mail-slack.js";

export const config = { maxDuration: 120 };
const later = (p) => { try { waitUntil(p); } catch { /* local */ } return p; };

async function rawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString("utf8");
}
export function signed(headers, raw, secret, now = Date.now()) {
  const ts = String(headers["x-slack-request-timestamp"] || ""), sig = String(headers["x-slack-signature"] || "");
  if (!secret || !ts || !sig || Math.abs(now / 1000 - Number(ts)) > 300) return false;
  const want = "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex");
  return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("POST only");
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const raw = await rawBody(req);
  // Slack checks the address when the app is created - before HQ has its secret.
  if (!/^payload=/.test(raw)) { try { const b = JSON.parse(raw || "{}"); if (b.type === "url_verification") return res.status(200).json({ challenge: b.challenge }); } catch { /* not JSON */ } }
  const cfg = await mailSlackCfg(sb);
  if (cfg.app !== "mail" || !signed(req.headers, raw, cfg.signing_secret)) return res.status(401).send("Bad Slack signature - save DSSC Mail's Signing Secret in HQ -> Product -> Settings -> Email assistant");

  if (/^payload=/.test(raw)) {
    const p = JSON.parse(new URLSearchParams(raw).get("payload") || "{}");
    if (p.type === "block_actions" && isMailAction(p.actions?.[0]?.action_id)) later(onMailButton(sb, cfg, p, p.actions[0]).catch(e => console.error("mail button", e)));
    if (p.type === "view_submission" && p.view?.callback_id === "mail_edit") {
      if (!String(p.view?.state?.values?.reply?.text?.value || "").trim()) return res.status(200).json({ response_action: "errors", errors: { reply: "Write the reply first" } });
      later(onMailEditSubmit(sb, cfg, p).catch(e => console.error("mail edit", e)));
    }
    return res.status(200).send("");
  }
  const body = JSON.parse(raw || "{}");
  if (body.type === "event_callback" && !req.headers["x-slack-retry-num"]) {
    const ev = body.event || {};
    if (ev.type === "message" && !ev.subtype && !ev.bot_id && ev.thread_ts && ev.thread_ts !== ev.ts && ev.user !== cfg.bot_user) {
      later((async () => {
        const { data: d } = await sb.from("mail_drafts").select("id").eq("slack_channel", ev.channel).eq("slack_ts", ev.thread_ts).maybeSingle();
        if (d) await onMailReply(sb, cfg, ev, d);
      })().catch(e => console.error("mail reply", e)));
    }
  }
  return res.status(200).send("");
}
