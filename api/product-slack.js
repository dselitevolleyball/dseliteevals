// Slack -> Product board (Drew, Oct 28 2026: "can I respond to Slack
// messages? - do it"). The Slack app's Interactivity and Event Subscriptions
// both point here.
//   Buttons   Approve / Decline on a request, Build it, Ship it, Try again;
//             DS Elite Social's Approve & post / Skip (dse_social_*);
//             the email assistant's Send / Edit / Skip (mail_*, Drew only),
//             Edit opening a box to change the reply and send it.
//   Replies   in a card's thread (product_slack_threads):
//             - on a card the agent has built: the reply is the next round of
//               changes for the agent ("note: ..." is just a note)
//             - on a request: "approve" / "decline <why>" decide it; anything
//               else is a note on the card
//             - otherwise a note ("build" starts the agent on an approved card)
// Only Drew and HQ admins count: the Slack user's email (users.info) must be an
// owner or an approved HQ admin. Every request is checked against the app's
// Signing Secret; Slack gets its answer within 3 seconds and the work carries
// on under waitUntil.

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";
import { act } from "./product.js";
import { OWNER_EMAILS } from "./_lib/projects.js";
import { slackCfg, slackApi, replyInThread, decidedMessage, cardLink } from "./_lib/product-slack.js";

export const config = { maxDuration: 120 };
const nrm = (v) => String(v || "").trim().toLowerCase();
const later = (p) => { try { waitUntil(p); } catch { /* local */ } return p; };

async function rawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString("utf8");
}
function signed(req, raw, secret) {
  const ts = String(req.headers["x-slack-request-timestamp"] || ""), sig = String(req.headers["x-slack-signature"] || "");
  if (!secret || !ts || !sig || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const want = "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex");
  return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

// The HQ person behind a Slack user, if they may run the board.
async function approverFor(sb, cfg, slackUserId) {
  const u = await slackApi(cfg.bot_token, "users.info", { user: slackUserId });
  const email = nrm(u.user?.profile?.email);
  if (!email) return null;
  if (OWNER_EMAILS.includes(email)) return { email, name: u.user.real_name || "Drew Rose", approver: true };
  const { data: c } = await sb.from("coaches").select("display_name, is_admin, is_approved").ilike("email", email).maybeSingle();
  return c?.is_approved && c?.is_admin ? { email, name: c.display_name || u.user.real_name || email, approver: true } : null;
}

const respond = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
const oops = (url, text) => respond(url, { response_type: "ephemeral", replace_original: false, text });
const card = async (sb, id) => (await sb.from("product_items").select("*").eq("id", Number(id)).single()).data;

// DS Elite Social approvals (api/_lib/dse-social.js): Approve & post / Skip
// on a draft DMed to an approver. The DM itself is updated by the engine.
async function onSocialButton(sb, cfg, p, a) {
  const me = await approverFor(sb, cfg, p.user?.id);
  if (!me) return oops(p.response_url, "Only Drew and HQ admins can approve DS Elite posts.");
  const by = String(me.name || me.email).split(/[\s@]/)[0];
  try {
    // Loaded only here, so the Product board's buttons never depend on it.
    const { approvePost, skipPost, publishPost } = await import("./_lib/dse-social.js");
    if (a.action_id === "dse_social_skip") return void await skipPost(sb, a.value, by);
    const r = await approvePost(sb, a.value, by, { now: a.action_id === "dse_social_now" });
    if (r.due) { const out = await publishPost(sb, a.value); if (out.errors?.length) return oops(p.response_url, "Approved, but posting failed: " + out.errors.join(" · ")); }
  } catch (e) { return oops(p.response_url, `Couldn't do that: ${e.message}`); }
}

// Email assistant (api/_lib/mail-assistant.js): Send / Edit / Skip on a
// drafted reply DMed to Drew, the Edit box, and replies in the card's thread.
// Only Drew (an owner) - it's his mail.
const mailLib = () => import("./_lib/mail-assistant.js");
async function mailOwner(sb, cfg, slackUserId) {
  const me = await approverFor(sb, cfg, slackUserId);
  return me && OWNER_EMAILS.includes(me.email) ? me : null;
}
async function onMailButton(sb, cfg, p, a) {
  if (a.action_id === "mail_edit") {
    // The box has to open within 3 seconds of the click, so it opens first;
    // who pressed Send in it is checked on submit.
    const { data: d } = await sb.from("mail_drafts").select("id, draft, from_name, from_email, subject").eq("id", Number(a.value)).maybeSingle();
    if (!d) return oops(p.response_url, "That email is gone.");
    const r = await slackApi(cfg.bot_token, "views.open", { trigger_id: p.trigger_id, view: {
      type: "modal", callback_id: "mail_edit", private_metadata: String(d.id),
      title: { type: "plain_text", text: "Edit reply" }, submit: { type: "plain_text", text: "Send" }, close: { type: "plain_text", text: "Cancel" },
      blocks: [
        { type: "context", elements: [{ type: "mrkdwn", text: `To ${(d.from_name || d.from_email).replace(/[<>&]/g, "")} · ${String(d.subject || "").replace(/[<>&]/g, "").slice(0, 120)}` }] },
        { type: "input", block_id: "reply", label: { type: "plain_text", text: "Your reply" }, element: { type: "plain_text_input", action_id: "text", multiline: true, initial_value: String(d.draft || "").slice(0, 2900) } },
      ] } });
    if (!r.ok) return oops(p.response_url, "Couldn't open the editor: " + r.error);
    return;
  }
  const me = await mailOwner(sb, cfg, p.user?.id);
  if (!me) return oops(p.response_url, "Only Drew can answer his email from here.");
  const by = String(me.name || me.email).split(/[\s@]/)[0];
  try {
    const { sendDraft, skipDraft } = await mailLib();
    if (a.action_id === "mail_send") await sendDraft(sb, a.value, by);
    if (a.action_id === "mail_skip") await skipDraft(sb, a.value, by);
  } catch (e) { return oops(p.response_url, `Couldn't do that: ${e.message}`); }
}
async function onMailEditSubmit(sb, cfg, p) {
  const me = await mailOwner(sb, cfg, p.user?.id);
  if (!me) return;
  const text = p.view?.state?.values?.reply?.text?.value || "";
  const { sendDraft } = await mailLib();
  await sendDraft(sb, p.view.private_metadata, String(me.name || me.email).split(/[\s@]/)[0], { text }).catch(async (e) => {
    const { data: d } = await sb.from("mail_drafts").select("slack_channel, slack_ts").eq("id", Number(p.view.private_metadata)).maybeSingle();
    if (d?.slack_channel) await replyInThread(sb, d.slack_channel, d.slack_ts, `Couldn't send: ${e.message}`);
  });
}
async function onMailReply(sb, cfg, ev, d) {
  const say = (text) => slackApi(cfg.bot_token, "chat.postMessage", { channel: ev.channel, thread_ts: ev.thread_ts, text });
  const me = await mailOwner(sb, cfg, ev.user);
  if (!me) return say("Only Drew can change his replies.");
  const text = String(ev.text || "").trim();
  if (!text) return;
  const by = String(me.name || me.email).split(/[\s@]/)[0];
  try {
    const { sendDraft, skipDraft, reviseDraft } = await mailLib();
    if (/^(send|send it|yes|approve)[.!]*$/i.test(text)) { await sendDraft(sb, d.id, by); return say("✅ Sent."); }
    if (/^(skip|no|don'?t send)[.!]*$/i.test(text)) { await skipDraft(sb, d.id, by); return say("⏭ Skipped."); }
    await say("✏️ Rewriting…");
    await reviseDraft(sb, d.id, text);
    return say("Updated the draft above ↑ - press Send when it's right.");
  } catch (e) { return say(`Couldn't do that: ${e.message}`); }
}

async function onButton(sb, cfg, p) {
  const a0 = p.actions?.[0];
  if (a0 && /^dse_social_(approve|skip|now)$/.test(a0.action_id)) return onSocialButton(sb, cfg, p, a0);
  if (a0 && /^mail_(send|edit|skip)$/.test(a0.action_id)) return onMailButton(sb, cfg, p, a0);
  const a = a0; if (!a || !["approve", "decline", "build", "ship", "retry"].includes(a.action_id)) return;
  const me = await approverFor(sb, cfg, p.user?.id);
  if (!me) return oops(p.response_url, "Only Drew and HQ admins can do that from Slack.");
  const id = Number(a.value);
  try {
    if (a.action_id === "approve" || a.action_id === "decline") {
      const { item } = await act(sb, me, { action: "decide", id, approve: a.action_id === "approve" });
      return respond(p.response_url, { replace_original: true, ...decidedMessage(item, a.action_id === "approve", me.name) });
    }
    const item = await card(sb, id);
    if (a.action_id === "build") {
      const r = await act(sb, me, { action: "build", id });
      return respond(p.response_url, { replace_original: true, text: "Building", blocks: [{ type: "section", text: { type: "mrkdwn", text: `▶ *${me.name}* handed ${cardLink(id, item.title)} to the agent (${item.model}, ${item.effort} effort).${r.dispatch_error ? `\n⚠️ ${r.dispatch_error}` : " It posts here when it's ready."}` } }] });
    }
    if (a.action_id === "retry") {
      const { data: last } = await sb.from("product_runs").select("kind").eq("item_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      await act(sb, me, !item.branch ? { action: "build", id } : { action: "revise", id, instructions: last?.kind === "ship"
        ? "Shipping failed because main changed since you built this. The latest main is now merged into the branch - resolve any conflicts so main's newer work stays and this item's change still works, then rebuild. Don't change anything else."
        : "The last run failed before finishing. Look at what's on the branch, then finish the item." });
      return respond(p.response_url, { replace_original: true, text: "Trying again", blocks: [{ type: "section", text: { type: "mrkdwn", text: `↻ *${me.name}* asked the agent to try again on ${cardLink(id, item.title)}.` } }] });
    }
    if (a.action_id === "ship") {
      await act(sb, me, { action: "ship", id });
      return respond(p.response_url, { replace_original: true, text: "Shipping", blocks: [{ type: "section", text: { type: "mrkdwn", text: `🚀 *${me.name}* is shipping ${cardLink(id, item.title)} - merging to main now.` } }] });
    }
  } catch (e) { return oops(p.response_url, `Couldn't do that: ${e.message}`); }
}

async function onReply(sb, cfg, ev) {
  const { data: mail } = await sb.from("mail_drafts").select("id").eq("slack_channel", ev.channel).eq("slack_ts", ev.thread_ts).maybeSingle().then(r => r, () => ({ data: null }));
  if (mail) return onMailReply(sb, cfg, ev, mail);
  const { data: th } = await sb.from("product_slack_threads").select("item_id").eq("channel", ev.channel).eq("ts", ev.thread_ts).maybeSingle();
  if (!th) return;
  const say = (text) => replyInThread(sb, ev.channel, ev.thread_ts, text);
  const me = await approverFor(sb, cfg, ev.user);
  if (!me) return say("Only Drew and HQ admins can change cards from Slack - this wasn't recorded.");
  const item = await card(sb, th.item_id);
  const text = String(ev.text || "").trim();
  if (!text) return;
  const m = /^note\s*[:\-]?\s*/i.exec(text);
  try {
    if (m) { await act(sb, me, { action: "comment", id: item.id, body: text.slice(m[0].length) || text }); return say("📝 Added as a note on the card."); }
    if (item.status === "inbox") {
      const d = /^(approve|approved|yes|ok)\b[\s:,\-]*/i.exec(text), n = /^(decline|declined|no|reject)\b[\s:,\-]*/i.exec(text);
      if (d || n) { await act(sb, me, { action: "decide", id: item.id, approve: !!d, note: text.slice((d || n)[0].length) || null }); return say(d ? "✓ Approved - it's in the Backlog." : "✗ Declined - they've been told in Slack."); }
      await act(sb, me, { action: "comment", id: item.id, body: text }); return say("📝 Added as a note. Reply *approve* or *decline* to decide it.");
    }
    if (item.branch && ["review", "building"].includes(item.status)) {
      const r = await act(sb, me, { action: "revise", id: item.id, instructions: text });
      return say(r.dispatch_error ? `Queued for the agent, but GitHub didn't start: ${r.dispatch_error}` : `↻ Sent to the agent (${item.model}, ${item.effort} effort). I'll post here when the next round is ready.`);
    }
    if (/^build\b/i.test(text) && ["backlog", "planned"].includes(item.status)) {
      const r = await act(sb, me, { action: "build", id: item.id });
      return say(r.dispatch_error ? `Queued, but GitHub didn't start: ${r.dispatch_error}` : "▶ Handed to the agent. I'll post here when it's ready.");
    }
    await act(sb, me, { action: "comment", id: item.id, body: text });
    return say("📝 Added as a note on the card.");
  } catch (e) { return say(`Couldn't do that: ${e.message}`); }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("POST only");
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const raw = await rawBody(req);
  const cfg = await slackCfg(sb);
  if (!signed(req, raw, cfg.signing_secret)) return res.status(401).send("Bad Slack signature - save the app's Signing Secret in HQ -> Product -> Settings");

  // Interactivity: payload=<json>
  if (/^payload=/.test(raw)) {
    const p = JSON.parse(new URLSearchParams(raw).get("payload") || "{}");
    if (p.type === "block_actions") later(onButton(sb, cfg, p).catch(e => console.error("slack button", e)));
    if (p.type === "view_submission" && p.view?.callback_id === "mail_edit") {
      if (!String(p.view?.state?.values?.reply?.text?.value || "").trim()) return res.status(200).json({ response_action: "errors", errors: { reply: "Write the reply first" } });
      later(onMailEditSubmit(sb, cfg, p).catch(e => console.error("mail edit", e)));
    }
    return res.status(200).send("");
  }
  const body = JSON.parse(raw || "{}");
  if (body.type === "url_verification") return res.status(200).json({ challenge: body.challenge });
  if (body.type === "event_callback" && !req.headers["x-slack-retry-num"]) {
    const ev = body.event || {};
    if (ev.type === "message" && !ev.subtype && !ev.bot_id && ev.thread_ts && ev.thread_ts !== ev.ts && ev.user !== cfg.bot_user) later(onReply(sb, cfg, ev).catch(e => console.error("slack reply", e)));
  }
  return res.status(200).send("");
}
