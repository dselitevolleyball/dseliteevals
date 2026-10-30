// The email assistant in Slack (api/_lib/mail-assistant.js): Send / Edit / Skip
// on a drafted reply DMed to Drew, the Edit box, and replies in the card's
// thread. Used by the email assistant's own Slack app ("DSSC Mail",
// api/mail-slack.js) and, for cards posted before that app was set up, by the
// HQ bot (api/product-slack.js). cfg is whichever app the click came through.
// Only Drew (an owner) - it's his mail.

import { slackApi } from "./product-slack.js";
import { OWNER_EMAILS } from "./projects.js";

const lib = () => import("./mail-assistant.js");
const respond = (url, body) => url ? fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {}) : null;
const oops = (url, text) => respond(url, { response_type: "ephemeral", replace_original: false, text });
const firstName = (me) => String(me.name || me.email).split(/[\s@]/)[0];
export const isMailAction = (id) => /^mail_(send|edit|skip|draft_now)$/.test(String(id || ""));

// Drew, by his Slack profile email.
export async function mailOwner(cfg, slackUserId) {
  const u = await slackApi(cfg.bot_token, "users.info", { user: slackUserId });
  const email = String(u.user?.profile?.email || "").trim().toLowerCase();
  return OWNER_EMAILS.includes(email) ? { email, name: u.user.real_name || "Drew" } : null;
}

export async function onMailButton(sb, cfg, p, a) {
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
  const me = await mailOwner(cfg, p.user?.id);
  if (!me) return oops(p.response_url, "Only Drew can answer his email from here.");
  try {
    // From the inbox cleanup's list: draft it now, as a card like new mail.
    if (a.action_id === "mail_draft_now") {
      const { draftListed } = await lib();
      const d = await draftListed(sb, a.value);
      return oops(p.response_url, d?.status === "answered" ? "✓ You already answered this one in Gmail - moved it to Replied." : "✏️ Drafted - the card is in this conversation.");
    }
    const { sendDraft, skipDraft } = await lib();
    if (a.action_id === "mail_send") await sendDraft(sb, a.value, firstName(me));
    if (a.action_id === "mail_skip") await skipDraft(sb, a.value, firstName(me));
  } catch (e) { return oops(p.response_url, `Couldn't do that: ${e.message}`); }
}

export async function onMailEditSubmit(sb, cfg, p) {
  const me = await mailOwner(cfg, p.user?.id);
  if (!me) return;
  const text = p.view?.state?.values?.reply?.text?.value || "";
  const { sendDraft } = await lib();
  await sendDraft(sb, p.view.private_metadata, firstName(me), { text }).catch(async (e) => {
    const { data: d } = await sb.from("mail_drafts").select("slack_channel, slack_ts").eq("id", Number(p.view.private_metadata)).maybeSingle();
    if (d?.slack_channel) await slackApi(cfg.bot_token, "chat.postMessage", { channel: d.slack_channel, thread_ts: d.slack_ts, text: `Couldn't send: ${e.message}` });
  });
}

// A reply in a card's thread: "send" / "skip", "reply: <exact words>", or how to change it.
export async function onMailReply(sb, cfg, ev, d) {
  const say = (text) => slackApi(cfg.bot_token, "chat.postMessage", { channel: ev.channel, thread_ts: ev.thread_ts, text });
  const me = await mailOwner(cfg, ev.user);
  if (!me) return say("Only Drew can change his replies.");
  const text = String(ev.text || "").trim();
  if (!text) return;
  try {
    const { sendDraft, skipDraft, reviseDraft } = await lib();
    if (/^(send|send it|yes|approve)[.!]*$/i.test(text)) { await sendDraft(sb, d.id, firstName(me)); return say("✅ Sent."); }
    if (/^(skip|no|don'?t send)[.!]*$/i.test(text)) { await skipDraft(sb, d.id, firstName(me)); return say("⏭ Skipped."); }
    await say("✏️ Rewriting…");
    await reviseDraft(sb, d.id, text);
    return say("Updated the draft above ↑ - press Send when it's right.");
  } catch (e) { return say(`Couldn't do that: ${e.message}`); }
}
