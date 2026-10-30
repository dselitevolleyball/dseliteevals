// Email assistant (Drew, Oct 29 2026): "read my email - draft a reply in slack
// and then send for me when I approve it". Two Gmail accounts:
// drew@dselitevolleyball.com and drew@drippingsportsclub.com.
//
//   poll     every 5 minutes (api/mail-assistant.js cron): new inbox mail since
//            the account was connected. Newsletters, receipts, no-reply and
//            Gmail's Promotions / Social / Updates / Forums tabs are ignored
//            without asking Claude. The rest goes to Claude with the thread and
//            a few of Drew's own sent emails (for his voice); if it needs a
//            reply, the HQ Slack bot DMs Drew the email and the draft:
//            Send / Edit / Skip, and a reply in the thread rewrites the draft.
//   send     only on Drew's press: from that Gmail, in the same thread
//            (In-Reply-To / References), with their message quoted below.
//   answered if Drew replies in Gmail himself first, the Slack card says so.
//   tidy     Gmail labels under "Mail Assistant/": Needs reply while it waits;
//            after Send / Skip the conversation is marked read, archived and
//            labelled Replied / Skipped; mail that needs no reply is marked
//            read and labelled (left in the inbox). Spam is never read.
//
// Google: an "Internal" OAuth client per Google Workspace - an internal app
// needs no Google review and its access doesn't expire, but only works for its
// own Workspace. GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (drippingsportsclub.com)
// and, if DS Elite is a separate Workspace, GOOGLE_DSE_CLIENT_ID /
// GOOGLE_DSE_CLIENT_SECRET for @dselitevolleyball.com. Each has the
// Gmail API on; each account signs in once (HQ -> Product -> Settings -> Email
// assistant) and its refresh token is kept in mail_accounts (server only).
// Setup: MAIL_ASSISTANT_SETUP.md.

import { createHmac, timingSafeEqual } from "node:crypto";
import { claudeClient } from "./ai-client.js";
import { slackCfg, slackApi } from "./product-slack.js";
import { stripQuoted } from "./site-inbox.js";
import { OWNER_EMAILS } from "./projects.js";

const env = () => process.env;
export const ACCOUNTS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
export const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.modify"];
export const MODEL = "claude-opus-5-5";
const nrm = (s) => String(s || "").trim().toLowerCase();
const fail = (status, msg) => Object.assign(new Error(msg), { status });
// The OAuth client for a mailbox: DS Elite's own when it has one, else the main one.
export function clientFor(account) {
  const dse = /@dselitevolleyball\.com$/i.test(String(account || "")) && env().GOOGLE_DSE_CLIENT_ID && env().GOOGLE_DSE_CLIENT_SECRET;
  return dse ? { id: env().GOOGLE_DSE_CLIENT_ID, secret: env().GOOGLE_DSE_CLIENT_SECRET } : { id: env().GOOGLE_CLIENT_ID, secret: env().GOOGLE_CLIENT_SECRET };
}
export const googleReady = (account = ACCOUNTS[1]) => { const c = clientFor(account); return !!(c.id && c.secret); };
// On drippingsportsclub.com, not vercel.app: a published Google app may only
// send people back to its "authorized domains", and vercel.app can't be one.
export const redirectUri = () => (env().MAIL_PUBLIC_BASE || "https://www.drippingsportsclub.com/hq").replace(/\/+$/, "") + "/api/mail-connect";
export const gmailLink = (account, threadId) => `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(account)}#all/${threadId || ""}`;

// ── Google sign-in ──────────────────────────────────────────────────────────
const stateKey = () => env().CRON_SECRET || env().SUPABASE_SERVICE_ROLE_KEY || "";
export function signState(payload, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...payload, t: now })).toString("base64url");
  return body + "." + createHmac("sha256", stateKey()).update(body).digest("base64url").slice(0, 32);
}
export function readState(state, now = Date.now()) {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig || !stateKey()) return null;
  const want = createHmac("sha256", stateKey()).update(body).digest("base64url").slice(0, 32);
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try { const j = JSON.parse(Buffer.from(body, "base64url").toString()); return now - j.t < 30 * 60e3 ? j : null; } catch { return null; }
}
export function authUrl(account, by) {
  if (!googleReady(account)) throw fail(400, "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel first (MAIL_ASSISTANT_SETUP.md)");
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for (const [k, v] of Object.entries({ client_id: clientFor(account).id, redirect_uri: redirectUri(), response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", login_hint: account, state: signState({ a: account, by }) })) u.searchParams.set(k, v);
  return u.toString();
}
async function tokenCall(account, params, fetchImpl = fetch) {
  const c = clientFor(account);
  const r = await fetchImpl("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, ...params }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(r.status, j.error_description || j.error || "Google said no (" + r.status + ")");
  return j;
}
// The callback: swap the code, check which mailbox it is, keep the refresh token.
export async function finishConnect(sb, { code, state }, { fetchImpl = fetch } = {}) {
  const st = readState(state);
  if (!st) throw fail(400, "That sign-in link has run out - start again from HQ");
  const t = await tokenCall(st.a, { code, grant_type: "authorization_code", redirect_uri: redirectUri() }, fetchImpl);
  if (!t.refresh_token) throw fail(400, "Google didn't give HQ lasting access - remove DSSC HQ at myaccount.google.com/permissions and connect again");
  const prof = await gmail(t.access_token, "profile", {}, fetchImpl);
  const email = nrm(prof.emailAddress);
  if (!ACCOUNTS.includes(email)) throw fail(400, `${email} isn't one of the mailboxes the assistant reads (${ACCOUNTS.join(", ")})`);
  if (clientFor(email).id !== clientFor(st.a).id) throw fail(400, `You signed in as ${email} - connect it with its own Connect button`);
  const { error } = await sb.from("mail_accounts").upsert({ email, refresh_token: t.refresh_token, enabled: true, connected_at: new Date().toISOString(), connected_by: st.by || null, last_error: null, updated_at: new Date().toISOString() }, { onConflict: "email" });
  if (error) throw fail(500, error.message);
  return { email, asked: st.a };
}
const tokens = new Map();   // account -> { token, exp } for this warm function
export async function accessToken(sb, acct, { fetchImpl = fetch } = {}) {
  const c = tokens.get(acct.email);
  if (c && c.exp > Date.now() + 60e3) return c.token;
  try {
    const t = await tokenCall(acct.email, { refresh_token: acct.refresh_token, grant_type: "refresh_token" }, fetchImpl);
    tokens.set(acct.email, { token: t.access_token, exp: Date.now() + (t.expires_in || 3000) * 1000 });
    return t.access_token;
  } catch (e) {
    const msg = /invalid_grant|expired|revoked/i.test(e.message) ? "Google sign-in expired or was removed - connect this mailbox again" : e.message;
    await sb.from("mail_accounts").update({ last_error: msg, updated_at: new Date().toISOString() }).eq("email", acct.email);
    throw fail(401, msg);
  }
}

// ── Gmail ───────────────────────────────────────────────────────────────────
export async function gmail(token, path, { method = "GET", query = null, body = null } = {}, fetchImpl = fetch) {
  const u = new URL("https://gmail.googleapis.com/gmail/v1/users/me/" + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) [].concat(v).forEach(x => u.searchParams.append(k, x));
  const r = await fetchImpl(u.toString(), { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(r.status, "Gmail: " + (j.error?.message || r.status));
  return j;
}
const b64d = (s) => Buffer.from(String(s || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const htmlText = (h) => String(h || "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, " ").split("\n").map(l => l.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
export function parseAddress(v) {
  const s = String(v || "").trim();
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(s);
  if (m) return { name: m[1].trim(), email: nrm(m[2]) };
  const e = /[^\s<>,;"]+@[^\s<>,;"]+/.exec(s);
  return { name: "", email: nrm(e?.[0]) };
}
// A Gmail message (format=full) -> the fields the assistant uses.
export function parseMessage(m) {
  const h = {}; for (const x of m.payload?.headers || []) h[x.name.toLowerCase()] = x.value;
  let plain = "", html = "";
  const walk = (p) => { if (!p) return; if (p.mimeType === "text/plain" && p.body?.data && !plain) plain = b64d(p.body.data); else if (p.mimeType === "text/html" && p.body?.data && !html) html = b64d(p.body.data); (p.parts || []).forEach(walk); };
  walk(m.payload);
  const from = parseAddress(h.from), replyTo = h["reply-to"] ? parseAddress(h["reply-to"]) : null;
  const text = (plain || htmlText(html)).replace(/\r\n?/g, "\n").trim();
  return {
    gmail_id: m.id, thread_id: m.threadId, labels: m.labelIds || [], received_at: m.internalDate ? new Date(+m.internalDate).toISOString() : null,
    from_email: from.email, from_name: from.name, reply_to: replyTo?.email && replyTo.email !== from.email ? replyTo.email : null,
    subject: h.subject || "", message_id: h["message-id"] || null, references_ids: [h.references, h["in-reply-to"]].filter(Boolean).join(" ").trim() || null,
    text, latest: stripQuoted(text).trim(), headers: h,
  };
}
// Mail no one answers: decided without Claude. -> reason or null
const NOREPLY = /(^|[._+-])(no-?reply|do-?not-?reply|donotreply|notifications?|notify|mailer-daemon|postmaster|bounces?|alerts?|receipts?|billing|invoice|newsletter|news|marketing|updates?)([._+-]|@)/i;
export function ignoreReason(p, account) {
  if (!p.from_email) return "no sender";
  if (ACCOUNTS.includes(p.from_email) || p.from_email === account) return "from you";
  const cat = (p.labels || []).find(l => /^CATEGORY_(PROMOTIONS|SOCIAL|UPDATES|FORUMS)$/.test(l));
  if (cat) return "Gmail " + cat.replace("CATEGORY_", "").toLowerCase();
  if ((p.labels || []).includes("SPAM")) return "spam";
  const H = p.headers || {};
  if (H["list-unsubscribe"] || H["list-id"]) return "mailing list";
  if (/bulk|list|junk/i.test(H.precedence || "")) return "bulk mail";
  if (H["auto-submitted"] && !/^no$/i.test(H["auto-submitted"])) return "automatic reply";
  if (NOREPLY.test(p.from_email.split("@")[0] + "@")) return "no-reply sender";
  return null;
}

// ── Claude ──────────────────────────────────────────────────────────────────
const DRAFT_SCHEMA = { type: "object", additionalProperties: false, required: ["needs_reply", "reason", "draft", "note"],
  properties: { needs_reply: { type: "boolean" }, reason: { type: "string" }, draft: { type: "string" }, note: { type: "string" } } };
const SYSTEM = `You draft email replies for Drew Rose. Drew owns DS Elite Volleyball (a club volleyball program in Dripping Springs, Texas - drew@dselitevolleyball.com) and Dripping Springs Sports Club (DSSC, a youth sports facility with volleyball, basketball, Reach Performance training, camps, birthday parties and court rentals - drew@drippingsportsclub.com). Most email is from parents, coaches, players, vendors and partners.

Decide whether the newest email needs a reply from Drew. No reply is needed for: an FYI, a plain "thanks", a conversation that is finished, anything automated, a receipt, a newsletter, a sales pitch or spam. If no reply is needed, needs_reply = false, draft = "", and reason says why in a few words.

If it needs a reply, write it as Drew would:
- Warm, short and direct. Usually one to four sentences. Plain text, no headings, no bullet lists unless they asked several separate questions.
- Answer what they actually asked. Match the way Drew writes in his own emails below (greeting, tone, sign-off). If you can't tell, start with their first name and end with "-Drew" on its own line.
- Never invent a fact: no prices, dates, times, links, policies, availability, amounts or promises that aren't in the emails. When the reply needs something only Drew knows, put a short placeholder in [square brackets] in the draft and say what's needed in note.
- Don't agree to refunds, discounts, exceptions or commitments on Drew's behalf unless the emails show he already did.
note: one short line for Drew (what to check or fill in), or "".
reason: a few words on what they want.`;

export async function draftFor(p, { account, thread = [], voice = [], instructions = "", previous = "" } = {}, { client = null } = {}) {
  const fmt = (x) => `From: ${x.from_name ? x.from_name + " " : ""}<${x.from_email}>\nDate: ${x.received_at || ""}\nSubject: ${x.subject || ""}\n\n${String(x.latest || x.text || "").slice(0, 2500)}`;
  const ask = [
    `Drew is answering from: ${account}`,
    voice.length ? `A few emails Drew wrote recently (for his voice only - not facts about this email):\n\n${voice.map((v, i) => `--- ${i + 1}\n${String(v).slice(0, 700)}`).join("\n\n")}` : "",
    thread.length ? `Earlier in this thread, oldest first:\n\n${thread.map(fmt).join("\n\n---\n\n")}` : "",
    `The newest email (reply to this):\n\n${fmt(p)}`,
    previous ? `Your earlier draft:\n${previous}` : "",
    instructions ? `Drew wants the reply changed: ${instructions}\nWrite the new draft (needs_reply = true).` : "",
  ].filter(Boolean).join("\n\n=====\n\n");
  if (!client && !env().ANTHROPIC_API_KEY) throw fail(500, "ANTHROPIC_API_KEY isn't set");
  const c = client || claudeClient("mail-assistant", { timeout: 90000, maxRetries: 1 });
  const msg = await c.beta.messages.create({
    model: MODEL, max_tokens: 4000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: DRAFT_SCHEMA } },
    system: SYSTEM, messages: [{ role: "user", content: ask }],
  });
  const j = JSON.parse((msg.content || []).filter(b => b.type === "text").map(b => b.text).join("") || "{}");
  return { needs_reply: !!j.needs_reply, reason: String(j.reason || "").slice(0, 200), draft: String(j.draft || "").trim(), note: String(j.note || "").trim().slice(0, 300) };
}

// ── Slack ───────────────────────────────────────────────────────────────────
// The email assistant's own Slack app ("DSSC Mail", hq_kv "mail_slack":
// { bot_token, signing_secret, bot_user, team }) when it's set up - its own DM
// conversation, apart from the HQ bot's - else the HQ bot (Product -> Settings).
export async function mailSlackCfg(sb) {
  const { data } = await sb.from("hq_kv").select("value").eq("key", "mail_slack").maybeSingle();
  if (data?.value?.bot_token) return { ...data.value, app: "mail" };
  return { ...(await slackCfg(sb)), app: "hq" };
}
export async function saveMailSlack(sb, { bot_token, signing_secret }, by) {
  const cur = (await sb.from("hq_kv").select("value").eq("key", "mail_slack").maybeSingle()).data?.value || {};
  const next = { ...cur };
  if (bot_token !== undefined) {
    const t = String(bot_token || "").trim();
    if (t && !/^xoxb-/.test(t)) throw fail(400, "That's not a bot token - it starts with xoxb- (OAuth & Permissions -> Bot User OAuth Token)");
    if (t) { const a = await slackApi(t, "auth.test", {}); if (!a.ok) throw fail(400, "Slack didn't accept that token: " + a.error); next.bot_token = t; next.bot_user = a.user_id; next.team = a.team; }
    else { delete next.bot_token; delete next.bot_user; delete next.team; }
  }
  if (signing_secret !== undefined) {
    const s = String(signing_secret || "").trim();
    // The Signing Secret is a short hex string. An xapp- App-Level Token sits on
    // the same Slack page and got saved here once - every click then got a 401.
    if (s && !/^[0-9a-f]{20,64}$/i.test(s)) throw fail(400, `That's not the Signing Secret${/^x(app|ox[a-z])-/i.test(s) ? ` - it's a${/^xapp-/i.test(s) ? "n App-Level" : ""} token` : ""}. In api.slack.com/apps -> DSSC Mail -> Basic Information -> App Credentials, press Show next to Signing Secret and copy that (32 letters and numbers).`);
    if (s) next.signing_secret = s; else delete next.signing_secret;
  }
  await sb.from("hq_kv").upsert({ key: "mail_slack", value: Object.keys(next).length ? next : null, secret: true, updated_at: new Date().toISOString(), updated_by: by }, { onConflict: "key" });
  return { connected: !!next.bot_token, signing: !!next.signing_secret, team: next.team || null };
}
export async function testMailSlack(sb) {
  const cfg = await mailSlackCfg(sb);
  if (!cfg.bot_token) throw fail(400, "Save the bot token first");
  const channel = await ownerDm(cfg);
  if (!channel) throw fail(400, "Couldn't find you in Slack - is the app installed in your workspace?");
  const r = await slackApi(cfg.bot_token, "chat.postMessage", { channel, text: "✉️ DSSC Mail is connected. Drafted replies to your email will show up here with Send / Edit / Skip." });
  if (!r.ok) throw fail(400, "Slack: " + r.error);
  return { app: cfg.app };
}
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const quote = (s, n = 900) => { const t = String(s || "").trim(); return (t.length > n ? t.slice(0, n) + " …" : t).split("\n").map(l => "> " + esc(l)).join("\n"); };
const when = (iso) => iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
export function card(d, { done = null } = {}) {
  const who = d.from_name ? `*${esc(d.from_name)}* <${esc(d.from_email)}>` : `*${esc(d.from_email)}*`;
  const head = { type: "section", text: { type: "mrkdwn", text: `✉️ ${who} → ${esc(d.account)}\n*${esc(d.subject || "(no subject)")}* · ${when(d.received_at)} · <${gmailLink(d.account, d.thread_id)}|open in Gmail>` } };
  const theirs = { type: "section", text: { type: "mrkdwn", text: quote(d.body, 900) || "_(empty)_" } };
  const blocks = [head, theirs, { type: "divider" }];
  if (done) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: done } });
    if (d.status === "sent" && d.draft) blocks.push({ type: "section", text: { type: "mrkdwn", text: quote(d.draft, 1500) } });
    return { text: `${d.subject || "Email"} - ${done.replace(/[*_]/g, "")}`, blocks };
  }
  blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Your reply:*\n${quote(d.draft, 2500)}` } });
  if (d.reason && /^Needs:/.test(d.reason)) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "⚠️ " + esc(d.reason) }] });
  blocks.push({ type: "actions", elements: [
    { type: "button", text: { type: "plain_text", text: "Send" }, style: "primary", action_id: "mail_send", value: String(d.id), confirm: { title: { type: "plain_text", text: "Send this reply?" }, text: { type: "mrkdwn", text: `From ${esc(d.account)} to ${esc(d.reply_to || d.from_email)}.` }, confirm: { type: "plain_text", text: "Send" }, deny: { type: "plain_text", text: "Not yet" } } },
    { type: "button", text: { type: "plain_text", text: "Edit" }, action_id: "mail_edit", value: String(d.id) },
    { type: "button", text: { type: "plain_text", text: "Skip" }, action_id: "mail_skip", value: String(d.id) },
  ] });
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "Reply in this thread to change it - e.g. _shorter_, _say yes, Friday works_, or paste the exact reply after *reply:*" }] });
  return { text: `Reply to ${d.from_name || d.from_email}: ${d.subject || ""}`, blocks };
}
async function ownerDm(cfg) {
  for (const e of OWNER_EMAILS) {
    const u = await slackApi(cfg.bot_token, "users.lookupByEmail", { email: e });
    if (!u.ok) continue;
    const im = await slackApi(cfg.bot_token, "conversations.open", { users: u.user.id });
    if (im.ok) return im.channel.id;
  }
  return null;
}
async function postCard(sb, cfg, d) {
  const channel = d.slack_channel || await ownerDm(cfg);
  if (!channel) throw fail(500, "Couldn't DM Drew in Slack (is the HQ Slack bot set up in Product -> Settings?)");
  const r = await slackApi(cfg.bot_token, "chat.postMessage", { channel, ...card(d), unfurl_links: false, unfurl_media: false });
  if (!r.ok) throw fail(500, "Slack: " + r.error);
  await sb.from("mail_drafts").update({ slack_channel: r.channel, slack_ts: r.ts, updated_at: new Date().toISOString() }).eq("id", d.id);
  return r;
}
// The card is updated through whichever app posted it: DSSC Mail first, the
// HQ bot for cards from before DSSC Mail was set up.
export async function refreshCard(sb, d, opts = {}) {
  if (!d.slack_channel || !d.slack_ts) return;
  const body = { channel: d.slack_channel, ts: d.slack_ts, ...card(d, opts) };
  const mail = await mailSlackCfg(sb);
  const r = mail.bot_token ? await slackApi(mail.bot_token, "chat.update", body) : { ok: false };
  if (r.ok || mail.app === "hq") return;
  const hq = await slackCfg(sb);
  if (hq.bot_token) await slackApi(hq.bot_token, "chat.update", body);
}

// ── sending ─────────────────────────────────────────────────────────────────
const hdr = (v) => /[^\x20-\x7E]/.test(v) ? `=?UTF-8?B?${Buffer.from(v).toString("base64")}?=` : v;
export function buildMime(d, text) {
  const subject = /^\s*re:/i.test(d.subject || "") ? d.subject : `Re: ${d.subject || ""}`.trim();
  const to = d.reply_to || d.from_email;
  const quoted = d.body ? `\n\nOn ${when(d.received_at)}, ${d.from_name || d.from_email} wrote:\n${String(d.body).split("\n").map(l => "> " + l).join("\n")}` : "";
  const lines = [
    `From: Drew Rose <${d.account}>`, `To: ${d.from_name ? `${hdr(d.from_name)} <${to}>` : to}`, `Subject: ${hdr(subject)}`,
    ...(d.message_id ? [`In-Reply-To: ${d.message_id}`, `References: ${[d.references_ids, d.message_id].filter(Boolean).join(" ")}`] : []),
    "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "",
    Buffer.from(String(text).trim() + quoted + "\n").toString("base64").replace(/.{76}/g, "$&\r\n"),
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}
// ── tidying Gmail (Drew, Oct 29 2026: mark read + archive after Send / Skip,
// label everything it sorts, mark unimportant mail read) ──────────────────
// Labels sit under one "Mail Assistant" folder; they're made the first time
// they're needed. Tidying never stops a send or a poll - a failure is ignored.
export const LABELS = { needs: "Mail Assistant/Needs reply", replied: "Mail Assistant/Replied", skipped: "Mail Assistant/Skipped", noreply: "Mail Assistant/No reply needed", auto: "Mail Assistant/Newsletters & automated", look: "Mail Assistant/Needs a look" };
const labelMemo = new Map();
async function labelId(token, key, fetchImpl) {
  const name = LABELS[key];
  let m = labelMemo.get(token);
  if (!m) { const j = await gmail(token, "labels", {}, fetchImpl); m = new Map((j.labels || []).map(l => [l.name, l.id])); labelMemo.set(token, m); }
  if (!m.has(name)) {
    const c = await gmail(token, "labels", { method: "POST", body: { name, labelListVisibility: "labelShow", messageListVisibility: "show" } }, fetchImpl).catch(async () => {
      const j = await gmail(token, "labels", {}, fetchImpl); return (j.labels || []).find(l => l.name === name) || {};   // made by another run meanwhile
    });
    if (c.id) m.set(name, c.id);
  }
  return m.get(name);
}
// add / remove: label keys (LABELS) or Gmail's own (UNREAD, INBOX). thread: the whole conversation.
export async function tidy(token, { id, thread = false, add = [], remove = [] }, fetchImpl = fetch) {
  try {
    const ids = async (list) => (await Promise.all(list.map(k => LABELS[k] ? labelId(token, k, fetchImpl) : k))).filter(Boolean);
    const body = { addLabelIds: await ids(add), removeLabelIds: await ids(remove) };
    await gmail(token, `${thread ? "threads" : "messages"}/${id}/modify`, { method: "POST", body }, fetchImpl);
    return true;
  } catch { return false; }
}
// After Send or Skip: read, out of the inbox, labelled.
const settle = (token, d, key, fetchImpl) => d.thread_id ? tidy(token, { id: d.thread_id, thread: true, add: [key], remove: ["needs", "UNREAD", "INBOX"] }, fetchImpl) : null;
// Did Drew write in the conversation after this email came in? He answers from
// his phone and Gmail too, not only from Slack.
const threadMsgs = async (token, id, fetchImpl) => (await gmail(token, `threads/${id}`, { query: { format: "minimal" } }, fetchImpl)).messages || [];
export const sentAfter = (msgs, at) => { const t = Date.parse(at || 0) || 0; return msgs.some(m => (m.labelIds || []).includes("SENT") && +m.internalDate > t); };

const getDraft = async (sb, id) => { const { data } = await sb.from("mail_drafts").select("*").eq("id", Number(id)).maybeSingle(); if (!data) throw fail(404, "That email is gone"); return data; };
const getAccount = async (sb, email) => { const { data } = await sb.from("mail_accounts").select("*").eq("email", email).maybeSingle(); if (!data?.refresh_token) throw fail(400, `${email} isn't connected - connect it in HQ -> Product -> Settings`); return data; };

export async function sendDraft(sb, id, by, { text = null, fetchImpl = fetch } = {}) {
  const d = await getDraft(sb, id);
  if (d.status === "sent") return d;
  if (!["pending", "failed"].includes(d.status)) throw fail(400, `This one was ${d.status}`);
  const body = String(text ?? d.draft ?? "").trim();
  if (!body) throw fail(400, "The reply is empty");
  // Claim it so a double press can't send twice.
  const { data: claimed } = await sb.from("mail_drafts").update({ status: "sending", draft: body, updated_at: new Date().toISOString() }).eq("id", d.id).in("status", ["pending", "failed"]).select("id");
  if (!claimed?.length) return getDraft(sb, id);
  try {
    const token = await accessToken(sb, await getAccount(sb, d.account), { fetchImpl });
    const r = await gmail(token, "messages/send", { method: "POST", body: { raw: buildMime(d, body), threadId: d.thread_id } }, fetchImpl);
    const { data: out } = await sb.from("mail_drafts").update({ status: "sent", sent_gmail_id: r.id, decided_by: by, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", d.id).select().single();
    await settle(token, d, "replied", fetchImpl);
    await refreshCard(sb, out, { done: `✅ *Sent* by ${esc(by)} · ${when(new Date().toISOString())} · marked read and archived in Gmail` });
    return out;
  } catch (e) {
    const { data: out } = await sb.from("mail_drafts").update({ status: "failed", reason: String(e.message).slice(0, 300), updated_at: new Date().toISOString() }).eq("id", d.id).select().single();
    await refreshCard(sb, { ...out, status: "pending", reason: "Needs: sending failed - " + e.message });
    throw e;
  }
}
export async function skipDraft(sb, id, by, { fetchImpl = fetch } = {}) {
  const d = await getDraft(sb, id);
  if (!["pending", "failed"].includes(d.status)) return d;
  const { data: out } = await sb.from("mail_drafts").update({ status: "skipped", decided_by: by, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", d.id).select().single();
  const token = await accessToken(sb, await getAccount(sb, d.account), { fetchImpl }).catch(() => null);
  const ok = token ? await settle(token, d, "skipped", fetchImpl) : false;
  await refreshCard(sb, out, { done: `⏭ *Skipped* by ${esc(by)} - no reply sent${ok ? " · marked read and archived in Gmail" : ""}` });
  return out;
}
// A reply in the Slack thread: "reply: <exact text>" replaces the draft;
// anything else is an instruction for Claude to rewrite it.
export async function reviseDraft(sb, id, said, { client = null, fetchImpl = fetch } = {}) {
  const d = await getDraft(sb, id);
  if (!["pending", "failed"].includes(d.status)) throw fail(400, `This one was already ${d.status}`);
  const exact = /^\s*reply\s*:\s*/i.exec(said);
  let draft = exact ? said.slice(exact[0].length).trim() : null, note = "";
  if (!draft) {
    const ctx = await threadContext(sb, d, { fetchImpl }).catch(() => ({ thread: [], voice: [] }));
    const r = await draftFor({ ...d, latest: d.body }, { account: d.account, ...ctx, instructions: said, previous: d.draft }, { client });
    draft = r.draft; note = r.note;
  }
  const { data: out } = await sb.from("mail_drafts").update({ draft, status: "pending", reason: note ? "Needs: " + note : d.reason?.startsWith("Needs:") ? null : d.reason, updated_at: new Date().toISOString() }).eq("id", d.id).select().single();
  await refreshCard(sb, out);
  return out;
}

// ── polling ─────────────────────────────────────────────────────────────────
// The thread so far and a few of Drew's own sent emails, for Claude.
async function threadContext(sb, d, { fetchImpl = fetch, token = null } = {}) {
  token = token || await accessToken(sb, await getAccount(sb, d.account), { fetchImpl });
  const t = d.thread_id ? await gmail(token, `threads/${d.thread_id}`, { query: { format: "full" } }, fetchImpl).catch(() => ({ messages: [] })) : { messages: [] };
  const thread = (t.messages || []).filter(m => m.id !== d.gmail_id).slice(-5).map(parseMessage);
  return { thread, voice: await voiceSamples(token, fetchImpl) };
}
const voiceMemo = new Map();
async function voiceSamples(token, fetchImpl) {
  const k = token.slice(-12), c = voiceMemo.get(k);
  if (c && c.at > Date.now() - 30 * 60e3) return c.v;
  const l = await gmail(token, "messages", { query: { q: "in:sent newer_than:60d", maxResults: 6 } }, fetchImpl).catch(() => ({}));
  const v = [];
  for (const m of (l.messages || []).slice(0, 6)) { const full = await gmail(token, `messages/${m.id}`, { query: { format: "full" } }, fetchImpl).catch(() => null); const t = full && parseMessage(full).latest; if (t && t.length > 20) v.push(t); }
  voiceMemo.set(k, { at: Date.now(), v });
  return v;
}

// One pass over one mailbox. -> { looked, ignored, drafted, answered, errors }
export async function pollAccount(sb, acct, { fetchImpl = fetch, client = null, max = 8, cfg = null } = {}) {
  const out = { account: acct.email, looked: 0, ignored: 0, drafted: 0, no_reply: 0, answered: 0, errors: [] };
  const token = await accessToken(sb, acct, { fetchImpl });
  cfg = cfg || await mailSlackCfg(sb);
  const since = Math.max(Date.parse(acct.connected_at || 0) || 0, Date.now() - 2 * 864e5);
  const list = await gmail(token, "messages", { query: { q: `in:inbox -from:me after:${Math.floor(since / 1000)}`, maxResults: 25 } }, fetchImpl);
  const ids = (list.messages || []).map(m => m.id);
  const { data: seen } = ids.length ? await sb.from("mail_drafts").select("gmail_id").eq("account", acct.email).in("gmail_id", ids) : { data: [] };
  const known = new Set((seen || []).map(x => x.gmail_id));
  const todo = ids.filter(id => !known.has(id)).reverse().slice(0, max);   // oldest first
  for (const id of todo) {
    try {
      const p = parseMessage(await gmail(token, `messages/${id}`, { query: { format: "full" } }, fetchImpl));
      if (p.received_at && Date.parse(p.received_at) < since) continue;
      out.looked++;
      const base = { account: acct.email, gmail_id: p.gmail_id, thread_id: p.thread_id, message_id: p.message_id, references_ids: p.references_ids, from_email: p.from_email, from_name: p.from_name, reply_to: p.reply_to, subject: p.subject.slice(0, 300), received_at: p.received_at, body: p.latest.slice(0, 6000) };
      // Claim the message first, so two runs never draft it twice.
      const { data: claimed } = await sb.from("mail_drafts").upsert({ ...base, status: "drafting" }, { onConflict: "account,gmail_id", ignoreDuplicates: true }).select("*");
      if (!claimed?.length) continue;
      const row = claimed[0];
      const why = ignoreReason(p, acct.email);
      if (why) { out.ignored++; await sb.from("mail_drafts").update({ status: "ignored", reason: why }).eq("id", row.id); if (why !== "from you") await tidy(token, { id: p.gmail_id, add: ["auto"], remove: ["UNREAD"] }, fetchImpl); continue; }
      const ctx = await threadContext(sb, row, { fetchImpl, token });
      const r = await draftFor(p, { account: acct.email, ...ctx }, { client });
      if (!r.needs_reply || !r.draft) { out.no_reply++; await sb.from("mail_drafts").update({ status: "ignored", reason: "No reply needed: " + (r.reason || "") }).eq("id", row.id); await tidy(token, { id: p.gmail_id, add: ["noreply"], remove: ["UNREAD"] }, fetchImpl); continue; }
      const { data: d } = await sb.from("mail_drafts").update({ status: "pending", draft: r.draft, reason: r.note ? "Needs: " + r.note : r.reason, updated_at: new Date().toISOString() }).eq("id", row.id).select().single();
      if (cfg.bot_token) await postCard(sb, cfg, d); else out.errors.push("No Slack app - set up DSSC Mail (or the HQ bot) in Product -> Settings");
      await tidy(token, { id: p.gmail_id, add: ["needs"] }, fetchImpl);
      out.drafted++;
    } catch (e) {
      out.errors.push(`${id}: ${e.message}`);
      await sb.from("mail_drafts").update({ status: "failed", reason: String(e.message).slice(0, 300) }).eq("account", acct.email).eq("gmail_id", id).eq("status", "drafting");
    }
  }
  // Answered in Gmail before a decision: the thread has a newer message from Drew.
  const { data: open } = await sb.from("mail_drafts").select("*").eq("account", acct.email).eq("status", "pending").order("created_at").limit(20);
  for (const d of open || []) {
    const t = await gmail(token, `threads/${d.thread_id}`, { query: { format: "metadata", metadataHeaders: ["From"] } }, fetchImpl).catch(() => null);
    const mine = (t?.messages || []).some(m => +m.internalDate > Date.parse(d.received_at || 0) && (m.labelIds || []).includes("SENT"));
    if (!mine) continue;
    out.answered++;
    const { data: done } = await sb.from("mail_drafts").update({ status: "answered", decided_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", d.id).select().single();
    await tidy(token, { id: d.thread_id, thread: true, add: ["replied"], remove: ["needs"] }, fetchImpl);
    await refreshCard(sb, done, { done: "✓ *Answered in Gmail* - nothing sent from here" });
  }
  await tidyEarlier(sb, acct, token, fetchImpl).catch(() => {});
  await sb.from("mail_accounts").update({ last_poll_at: new Date().toISOString(), last_error: out.errors.length ? out.errors[0].slice(0, 300) : null, updated_at: new Date().toISOString() }).eq("email", acct.email);
  return out;
}
// Once per mailbox: tidy what was sorted before tidying existed (Oct 29 2026),
// the same way it's done now. Remembered in hq_kv "mail_tidied:<email>".
export const TIDY_FROM = "2026-10-29T21:45:00Z";   // when tidying went live; later mail was tidied as it came in
export async function tidyEarlier(sb, acct, token, fetchImpl = fetch) {
  const key = "mail_tidied:" + acct.email;
  const { data: done } = await sb.from("hq_kv").select("key").eq("key", key).maybeSingle();
  if (done) return 0;
  const { data: rows } = await sb.from("mail_drafts").select("gmail_id, thread_id, status, reason").eq("account", acct.email).in("status", ["ignored", "sent", "skipped", "answered"]).lt("created_at", TIDY_FROM).limit(200);
  let n = 0;
  for (const r of rows || []) {
    let ok = false;
    if (r.status === "sent") ok = await settle(token, r, "replied", fetchImpl);
    else if (r.status === "skipped") ok = await settle(token, r, "skipped", fetchImpl);
    else if (r.status === "answered") ok = await tidy(token, { id: r.thread_id, thread: true, add: ["replied"] }, fetchImpl);
    else if (r.reason !== "from you" && r.reason !== "no sender") ok = await tidy(token, { id: r.gmail_id, add: [/^No reply needed/.test(r.reason || "") ? "noreply" : "auto"], remove: ["UNREAD"] }, fetchImpl);
    if (ok) n++;
  }
  await sb.from("hq_kv").upsert({ key, value: { at: new Date().toISOString(), tidied: n }, secret: true, updated_at: new Date().toISOString(), updated_by: "mail-assistant" }, { onConflict: "key" });
  return n;
}

export async function pollAll(sb, opts = {}) {
  const { data: accts } = await sb.from("mail_accounts").select("*").eq("enabled", true).not("refresh_token", "is", null);
  const cfg = await mailSlackCfg(sb);
  const res = [];
  for (const a of accts || []) res.push(await pollAccount(sb, a, { ...opts, cfg }).catch(e => ({ account: a.email, errors: [e.message] })));
  return res;
}
export const isOwner = (email) => OWNER_EMAILS.includes(nrm(email));

// ── the roundup (Drew, Oct 29 2026: "summarize all of the thank yous, FYIs
// and what not into a line item I can review 2x a day") ─────────────────────
// At 8am and 5pm Central, a DM from the email Slack app: one line per email
// that needed no reply (Claude's one-line gist + Gmail link), newsletters and
// automated mail counted by sender, and drafts still waiting in Slack. Only
// sent when there's something in it. State in hq_kv "mail_digest".
export const DIGEST_HOURS = [8, 17];
const ct = (d) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(d).map(x => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour }; };
// The roundup slot now falls in ("2026-10-29@17"), or null before the first one.
export function digestSlot(now = new Date(), hours = DIGEST_HOURS) {
  const { date, hour } = ct(now);
  const h = [...hours].sort((a, b) => a - b).filter(x => x <= hour).pop();
  return h == null ? null : `${date}@${h}`;
}
const AUTO_NAME = (r) => (r.from_name || r.from_email.split("@")[1] || r.from_email).replace(/\s*\(.*\)$/, "").slice(0, 40);
const GIST_SCHEMA = { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "line"], properties: { id: { type: "integer" }, line: { type: "string" } } } } } };
async function gists(rows, client) {
  if (!rows.length) return new Map();
  if (!client && !env().ANTHROPIC_API_KEY) return new Map(rows.map(r => [r.id, r.subject || "(no subject)"]));
  const c = client || claudeClient("mail-digest", { timeout: 60000, maxRetries: 1 });
  const msg = await c.beta.messages.create({
    model: MODEL, max_tokens: 3000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: GIST_SCHEMA } },
    system: "Summarize each email for a busy club owner in one line of at most 14 words: what it says or asks, with any date, amount or name that matters. Plain words, no quotes, no 'This email'.",
    messages: [{ role: "user", content: rows.map(r => `id ${r.id}\nFrom: ${r.from_name || ""} <${r.from_email}>\nSubject: ${r.subject || ""}\n${String(r.body || "").slice(0, 700)}`).join("\n\n---\n\n") }],
  }).catch(() => null);
  let j = null; try { j = JSON.parse((msg?.content || []).filter(b => b.type === "text").map(b => b.text).join("")); } catch { /* fall back to subjects */ }
  const m = new Map((j?.items || []).map(x => [Number(x.id), String(x.line || "").trim()]));
  for (const r of rows) if (!m.get(r.id)) m.set(r.id, r.subject || "(no subject)");
  return m;
}
export function digestBlocks({ quiet, auto, waiting, since, gist }) {
  const esc2 = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const blocks = [{ type: "section", text: { type: "mrkdwn", text: `📬 *Email roundup* · since ${when(since)}` } }];
  const byAcct = (list) => [...new Set(list.map(r => r.account))];
  if (quiet.length) for (const a of byAcct(quiet)) {
    const lines = quiet.filter(r => r.account === a).map(r => `• *${esc2(r.from_name || r.from_email)}* - ${esc2(gist.get(r.id) || r.subject)} · <${gmailLink(r.account, r.thread_id)}|open>`);
    for (let i = 0; i < lines.length; i += 20) blocks.push({ type: "section", text: { type: "mrkdwn", text: (i ? "" : `*No reply needed · ${esc2(a)}* (${lines.length})\n`) + lines.slice(i, i + 20).join("\n") } });
  }
  if (auto.length) {
    const counts = {}; for (const r of auto) { const k = `${AUTO_NAME(r)}`; counts[k] = (counts[k] || 0) + 1; }
    const list = Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([k, n]) => esc2(k) + (n > 1 ? ` ×${n}` : "")).join(", ");
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `🗞 *Newsletters & automated* (${auto.length}, marked read): ${list}`.slice(0, 2900) }] });
  }
  if (waiting.length) blocks.push({ type: "section", text: { type: "mrkdwn", text: `⏳ *Still waiting on you* (${waiting.length}): ` + waiting.slice(0, 15).map(r => r.slack_channel && r.slack_ts ? `<https://slack.com/archives/${r.slack_channel}/p${String(r.slack_ts).replace(".", "")}|${esc2(r.from_name || r.from_email)}>` : esc2(r.from_name || r.from_email)).join(", ") } });
  return { text: `Email roundup: ${quiet.length} no reply needed, ${auto.length} automated, ${waiting.length} waiting`, blocks };
}
export async function sendDigest(sb, { force = false, now = new Date(), client = null } = {}) {
  const { data: kv } = await sb.from("hq_kv").select("value").eq("key", "mail_digest").maybeSingle();
  const state = kv?.value || {};
  const slot = digestSlot(now, state.hours || DIGEST_HOURS);
  if (!force && (!slot || state.last_slot === slot)) return { skipped: true, slot };
  const since = state.last_at || new Date(now.getTime() - 24 * 3600e3).toISOString();
  const { data: rows } = await sb.from("mail_drafts").select("id, account, thread_id, from_email, from_name, subject, body, status, reason, created_at, slack_channel, slack_ts").gt("created_at", since).eq("status", "ignored").order("created_at");
  const { data: waiting } = await sb.from("mail_drafts").select("id, from_email, from_name, slack_channel, slack_ts").eq("status", "pending").order("created_at");
  const quiet = (rows || []).filter(r => /^No reply needed/.test(r.reason || ""));
  const auto = (rows || []).filter(r => !/^No reply needed/.test(r.reason || "") && r.reason !== "from you" && r.reason !== "no sender");
  const save = (extra = {}) => sb.from("hq_kv").upsert({ key: "mail_digest", value: { ...state, last_slot: slot || state.last_slot, last_at: now.toISOString(), ...extra }, secret: true, updated_at: now.toISOString(), updated_by: "mail-digest" }, { onConflict: "key" });
  if (!quiet.length && !auto.length && !(waiting || []).length) { await save(); return { sent: false, empty: true, slot }; }
  const cfg = await mailSlackCfg(sb);
  if (!cfg.bot_token) return { sent: false, error: "No Slack app" };
  const channel = await ownerDm(cfg);
  if (!channel) return { sent: false, error: "Couldn't DM Drew in Slack" };
  const gist = await gists(quiet, client);
  const r = await slackApi(cfg.bot_token, "chat.postMessage", { channel, ...digestBlocks({ quiet, auto, waiting: waiting || [], since, gist }), unfurl_links: false, unfurl_media: false });
  if (!r.ok) return { sent: false, error: "Slack: " + r.error };
  await save();
  return { sent: true, slot, quiet: quiet.length, auto: auto.length, waiting: (waiting || []).length };
}

// ── the one-time inbox cleanup (Drew, Oct 29 2026: "go through my entire
// mailbox and organize it correctly") ───────────────────────────────────────
// Everything in the inbox from before the mailbox was connected (newer mail is
// handled as it arrives), a few hundred per 5-minute run until it's empty:
//   automated (the same rules as new mail)   labelled, read, archived - no Claude
//   real people                              Claude sorts them in batches:
//     needs a reply    labelled Needs reply, left unread; listed in one Slack
//                      message with a "Draft a reply" button each
//     no reply needed  labelled, marked read; older than 30 days also archived
//     Claude couldn't  labelled Needs a look
// Nothing is sent and nothing is deleted. Progress: hq_kv "mail_cleanup:<email>"
// { requested, done, counts, started_at, finished_at }. The query skips what's
// been labelled, archived or sent by Drew, so each run picks up where the last
// stopped.
const RECENT_DAYS = 30;
const CLEAN_Q = (before) => `in:inbox -from:me before:${before} -label:mail-assistant-needs-reply -label:mail-assistant-no-reply-needed -label:mail-assistant-needs-a-look -label:mail-assistant-replied -label:mail-assistant-skipped`;
const SORT_SCHEMA = { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "needs_reply", "gist"], properties: { id: { type: "integer" }, needs_reply: { type: "boolean" }, gist: { type: "string" } } } } } };
export async function sortBatch(rows, account, client = null) {
  const c = client || claudeClient("mail-cleanup", { timeout: 90000, maxRetries: 1 });
  const msg = await c.beta.messages.create({
    model: MODEL, max_tokens: 4000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SORT_SCHEMA } },
    system: `You sort old email in ${account}, the inbox of Drew Rose (owner of DS Elite Volleyball and Dripping Springs Sports Club). For each email: needs_reply = true only if a real person is asking Drew something or waiting on him and it plausibly still matters; false for thank-yous, FYIs, finished conversations, confirmations, announcements, sales pitches and anything automated. gist = one line, at most 14 words, of what it says or asks.`,
    messages: [{ role: "user", content: rows.map((r, i) => `id ${i}\nDate: ${r.received_at || ""}\nFrom: ${r.from_name || ""} <${r.from_email}>\nSubject: ${r.subject || ""}\n${String(r.snippet || "").slice(0, 400)}`).join("\n\n---\n\n") }],
  });
  const j = JSON.parse((msg.content || []).filter(b => b.type === "text").map(b => b.text).join("") || "{}");
  return new Map((j.items || []).map(x => [Number(x.id), { needs: !!x.needs_reply, gist: String(x.gist || "").trim() }]));
}
async function batchModify(token, ids, add, remove, fetchImpl) {
  if (!ids.length) return 0;
  const toIds = async (list) => (await Promise.all(list.map(k => LABELS[k] ? labelId(token, k, fetchImpl) : k))).filter(Boolean);
  const body = { addLabelIds: await toIds(add), removeLabelIds: await toIds(remove) };
  for (let i = 0; i < ids.length; i += 1000) await gmail(token, "messages/batchModify", { method: "POST", body: { ids: ids.slice(i, i + 1000), ...body } }, fetchImpl);
  return ids.length;
}
export async function cleanupAccount(sb, acct, { deadline = Date.now() + 200e3, fetchImpl = fetch, client = null, now = Date.now() } = {}) {
  const key = "mail_cleanup:" + acct.email;
  const { data: kv } = await sb.from("hq_kv").select("value").eq("key", key).maybeSingle();
  const st = kv?.value;
  if (!st?.requested || st.done) return null;
  const c = { automated: 0, archived_old: 0, no_reply: 0, needs_recent: 0, needs_old: 0, look: 0, ...(st.counts || {}) };
  const save = (extra = {}) => sb.from("hq_kv").upsert({ key, value: { ...st, started_at: st.started_at || new Date(now).toISOString(), counts: c, ...extra }, secret: true, updated_at: new Date().toISOString(), updated_by: "mail-cleanup" }, { onConflict: "key" });
  const token = await accessToken(sb, acct, { fetchImpl });
  const before = Math.floor(Date.parse(acct.connected_at || new Date(now).toISOString()) / 1000);
  const recentFrom = now - RECENT_DAYS * 864e5;
  let emptied = false;
  const seen = new Set();
  while (Date.now() < deadline) {
    const list = await gmail(token, "messages", { query: { q: CLEAN_Q(before), maxResults: 200 } }, fetchImpl);
    const all = (list.messages || []).map(m => m.id);
    if (!all.length) { emptied = true; break; }
    // Gmail's search can lag a moment behind a label change: never handle one twice in a run.
    const ids = all.filter(id => !seen.has(id));
    if (!ids.length) break;
    ids.forEach(id => seen.add(id));
    const metas = [];
    for (let i = 0; i < ids.length; i += 10) metas.push(...await Promise.all(ids.slice(i, i + 10).map(id => gmail(token, `messages/${id}`, { query: { format: "metadata", metadataHeaders: ["From", "Subject", "Reply-To", "Message-ID", "References", "In-Reply-To", "List-Unsubscribe", "List-Id", "Precedence", "Auto-Submitted"] } }, fetchImpl).catch(() => null))));
    const autoIds = [], people = [];
    for (const m of metas.filter(Boolean)) {
      const p = { ...parseMessage(m), snippet: (m.snippet || "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&") };
      const why = ignoreReason(p, acct.email);
      if (why) autoIds.push(p.gmail_id); else people.push(p);
    }
    c.automated += await batchModify(token, autoIds, ["auto"], ["UNREAD", "INBOX"], fetchImpl);
    const look = [], noRecent = [], noOld = [];
    let needs = [];
    for (let i = 0; i < people.length; i += 12) {
      if (Date.now() > deadline - 20e3) break;
      const batch = people.slice(i, i + 12);
      const sorted = await sortBatch(batch, acct.email, client).catch(() => new Map());
      batch.forEach((p, k) => {
        const r = sorted.get(k);
        if (!r) look.push(p.gmail_id);
        else if (r.needs) needs.push({ ...p, gist: r.gist });
        else (Date.parse(p.received_at || 0) >= recentFrom ? noRecent : noOld).push(p.gmail_id);
      });
    }
    c.look += await batchModify(token, look, ["look"], [], fetchImpl);
    c.no_reply += await batchModify(token, noRecent, ["noreply"], ["UNREAD"], fetchImpl);
    c.archived_old += await batchModify(token, noOld, ["noreply"], ["UNREAD", "INBOX"], fetchImpl);
    // Answered later in the same conversation: done, not waiting on him.
    const answered = new Set();
    for (let i = 0; i < needs.length; i += 5) await Promise.all(needs.slice(i, i + 5).map(async p => { if (p.thread_id && sentAfter(await threadMsgs(token, p.thread_id, fetchImpl).catch(() => []), p.received_at)) answered.add(p.gmail_id); }));
    if (answered.size) { c.answered = (c.answered || 0) + await batchModify(token, [...answered], ["replied"], ["UNREAD", "INBOX"], fetchImpl); needs = needs.filter(p => !answered.has(p.gmail_id)); }
    if (needs.length) {
      await batchModify(token, needs.map(p => p.gmail_id), ["needs"], [], fetchImpl);
      const rows = needs.map(p => ({ account: acct.email, gmail_id: p.gmail_id, thread_id: p.thread_id, message_id: p.message_id, references_ids: p.references_ids, from_email: p.from_email, from_name: p.from_name, reply_to: p.reply_to, subject: String(p.subject || "").slice(0, 300), received_at: p.received_at, body: p.snippet, status: "listed", reason: p.gist }));
      await sb.from("mail_drafts").upsert(rows, { onConflict: "account,gmail_id", ignoreDuplicates: true });
      for (const p of needs) Date.parse(p.received_at || 0) >= recentFrom ? c.needs_recent++ : c.needs_old++;
    }
    await save();
  }
  if (!emptied) return { account: acct.email, counts: c, done: false };
  await save({ done: true, finished_at: new Date().toISOString() });
  await cleanupSummary(sb, acct.email, c, recentFrom).catch(() => {});
  return { account: acct.email, counts: c, done: true };
}
const labelLink = (account, key) => `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(account)}#label/${encodeURIComponent(LABELS[key]).replace(/%20/g, "+")}`;
const esc2 = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function cleanupBlocks(account, c, recent, older) {
  const blocks = [{ type: "section", text: { type: "mrkdwn", text: `🧹 *Inbox cleanup done · ${esc2(account)}*\n• ${c.automated} newsletters & automated - marked read and archived (<${labelLink(account, "auto")}|see them>)\n• ${c.no_reply + c.archived_old} needed no reply - marked read${c.archived_old ? `, ${c.archived_old} older than ${RECENT_DAYS} days archived` : ""} (<${labelLink(account, "noreply")}|see them>)${c.answered ? `\n• ${c.answered} you'd already answered - moved to Replied, read and archived (<${labelLink(account, "replied")}|see them>)` : ""}\n• *${c.needs_recent + c.needs_old} may need a reply* - labelled Needs reply, still unread (<${labelLink(account, "needs")}|see them>)${c.look ? `\n• ${c.look} couldn't be sorted - labelled Needs a look (<${labelLink(account, "look")}|see them>)` : ""}` } }];
  return { text: `Inbox cleanup done: ${account}`, blocks: [...blocks, ...listBlocks(account, recent, older)].slice(0, 49) };
}
// The ones that may still need a reply: recent with Draft a reply, older linked.
function listBlocks(account, recent, older) {
  const blocks = [];
  if (recent.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*From the last ${RECENT_DAYS} days* - press Draft a reply and a draft card comes here like new mail:` } });
    for (const r of recent.slice(0, 40)) blocks.push({ type: "section", text: { type: "mrkdwn", text: `*${esc2(r.from_name || r.from_email)}* · ${new Date(r.received_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })} - ${esc2(r.reason || r.subject)} · <${gmailLink(account, r.thread_id)}|open>` }, accessory: { type: "button", text: { type: "plain_text", text: "Draft a reply" }, action_id: "mail_draft_now", value: String(r.id) } });
    if (recent.length > 40) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `…and ${recent.length - 40} more under Needs reply in Gmail.` }] });
  }
  if (older.length) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `Older than ${RECENT_DAYS} days and maybe still open (${older.length}): ` + older.slice(0, 12).map(r => `<${gmailLink(account, r.thread_id)}|${esc2(r.from_name || r.from_email)}>`).join(", ") + (older.length > 12 ? "…" : "") }] });
  return blocks;
}
async function listedNow(sb, account, recentFrom) {
  const { data: listed } = await sb.from("mail_drafts").select("id, from_email, from_name, subject, received_at, thread_id, reason").eq("account", account).eq("status", "listed").order("received_at", { ascending: false }).limit(300);
  return { recent: (listed || []).filter(r => Date.parse(r.received_at || 0) >= recentFrom), older: (listed || []).filter(r => Date.parse(r.received_at || 0) < recentFrom) };
}
async function dmOwner(sb, msg) {
  const cfg = await mailSlackCfg(sb);
  if (!cfg.bot_token) return;
  const channel = await ownerDm(cfg);
  if (channel) await slackApi(cfg.bot_token, "chat.postMessage", { channel, ...msg, unfurl_links: false, unfurl_media: false });
}
async function cleanupSummary(sb, account, c, recentFrom) {
  const { recent, older } = await listedNow(sb, account, recentFrom);
  await dmOwner(sb, cleanupBlocks(account, c, recent, older));
}

// The first cleanup (Oct 29-30 2026) judged each email on its own, so ones Drew
// had already answered later in the conversation were listed as needing a reply
// (Drew, Oct 30: "a bunch of emails are showing up not me responding to them,
// but I actually have"). One pass over each mailbox's list: answered -> Replied,
// read and archived; earlier emails in a conversation that's still open fold
// into its latest one; then a corrected list in Slack. A few hundred
// conversations per run; hq_kv "mail_recheck:<email>".
export async function recheckListed(sb, acct, { deadline = Date.now() + 150e3, fetchImpl = fetch, now = Date.now() } = {}) {
  const key = "mail_recheck:" + acct.email;
  const { data: kv } = await sb.from("hq_kv").select("value").eq("key", key).maybeSingle();
  const st = { ...(kv?.value || {}) };
  if (st.done) return null;
  const c = { answered: 0, folded: 0, gone: 0, ...(st.counts || {}) };
  const save = (extra = {}) => sb.from("hq_kv").upsert({ key, value: { ...st, counts: c, ...extra }, secret: true, updated_at: new Date().toISOString(), updated_by: "mail-recheck" }, { onConflict: "key" });
  const token = await accessToken(sb, acct, { fetchImpl });
  const stamp = () => new Date().toISOString();
  const doThread = async (tid) => {
    const { data: rows } = await sb.from("mail_drafts").select("id, received_at").eq("account", acct.email).eq("thread_id", tid).eq("status", "listed").order("received_at");
    if (!rows?.length) return;
    let msgs;
    try { msgs = await threadMsgs(token, tid, fetchImpl); }
    catch (e) {
      if (e.status !== 404) throw e;   // rate limits and outages: this page again next run
      c.gone += rows.length;
      await sb.from("mail_drafts").update({ status: "ignored", reason: "Gone from Gmail", updated_at: stamp() }).in("id", rows.map(r => r.id));
      return;
    }
    const last = rows[rows.length - 1];
    if (sentAfter(msgs, last.received_at)) {
      c.answered += rows.length;
      await sb.from("mail_drafts").update({ status: "answered", reason: "Answered in Gmail", decided_at: stamp(), updated_at: stamp() }).in("id", rows.map(r => r.id));
      await tidy(token, { id: tid, thread: true, add: ["replied"], remove: ["needs", "UNREAD", "INBOX"] }, fetchImpl);
    } else if (rows.length > 1) {
      c.folded += rows.length - 1;
      await sb.from("mail_drafts").update({ status: "ignored", reason: "Earlier email in the same conversation", updated_at: stamp() }).in("id", rows.slice(0, -1).map(r => r.id));
    }
  };
  while (Date.now() < deadline) {
    const { data: page } = await sb.from("mail_drafts").select("id, thread_id").eq("account", acct.email).eq("status", "listed").gt("id", st.after_id || 0).order("id").limit(100);
    if (!page?.length) {
      await save({ done: true, finished_at: stamp() });
      const { recent, older } = await listedNow(sb, acct.email, now - RECENT_DAYS * 864e5);
      const total = c.answered + c.folded + c.gone + recent.length + older.length;
      if (st.after_id) await dmOwner(sb, recheckBlocks(acct.email, total, c, recent, older)).catch(() => {});   // nothing was listed: nothing to say
      return { account: acct.email, counts: c, done: true };
    }
    const tids = [...new Set(page.map(r => r.thread_id).filter(Boolean))];
    try { for (let i = 0; i < tids.length; i += 5) await Promise.all(tids.slice(i, i + 5).map(doThread)); }
    catch (e) { await save(); throw e; }   // what's done stays done; the rest of this page next run
    st.after_id = page[page.length - 1].id;
    await save();
  }
  return { account: acct.email, counts: c, done: false };
}
export function recheckBlocks(account, total, c, recent, older) {
  const left = recent.length + older.length;
  const head = { type: "section", text: { type: "mrkdwn", text: `🔁 *Rechecked the Needs reply list · ${esc2(account)}*\nThe cleanup listed ${total} emails without checking whether you'd answered later in the conversation. Now:\n• *${c.answered} you'd already answered* - moved to Replied, read and archived (<${labelLink(account, "replied")}|see them>)${c.folded ? `\n• ${c.folded} were earlier emails in a conversation - each conversation is listed once now` : ""}${c.gone ? `\n• ${c.gone} are no longer in Gmail` : ""}\n• *${left} may still need a reply* (<${labelLink(account, "needs")}|see them>)` } };
  return { text: `Rechecked Needs reply: ${account}`, blocks: [head, ...listBlocks(account, recent, older)].slice(0, 49) };
}
// "Draft a reply" on a cleaned-up email: the full email, Claude's draft, a card - like new mail.
export async function draftListed(sb, id, { fetchImpl = fetch, client = null } = {}) {
  const { data: row } = await sb.from("mail_drafts").select("*").eq("id", Number(id)).maybeSingle();
  if (!row) throw fail(404, "That email is gone");
  if (row.status !== "listed") return row;
  const { data: claimed } = await sb.from("mail_drafts").update({ status: "drafting" }).eq("id", row.id).eq("status", "listed").select("id");
  if (!claimed?.length) return row;
  try {
    const acct = await getAccount(sb, row.account);
    const token = await accessToken(sb, acct, { fetchImpl });
    if (row.thread_id && sentAfter(await threadMsgs(token, row.thread_id, fetchImpl).catch(() => []), row.received_at)) {
      const { data: d } = await sb.from("mail_drafts").update({ status: "answered", reason: "Answered in Gmail", decided_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id).select().single();
      await settle(token, row, "replied", fetchImpl);
      return d;
    }
    const p = parseMessage(await gmail(token, `messages/${row.gmail_id}`, { query: { format: "full" } }, fetchImpl));
    const ctx = await threadContext(sb, { ...row, gmail_id: p.gmail_id }, { fetchImpl, token });
    const r = await draftFor(p, { account: row.account, ...ctx }, { client });
    const { data: d } = await sb.from("mail_drafts").update({ status: "pending", body: p.latest.slice(0, 6000), message_id: p.message_id, references_ids: p.references_ids, reply_to: p.reply_to, draft: r.draft || "", reason: r.note ? "Needs: " + r.note : r.reason, updated_at: new Date().toISOString() }).eq("id", row.id).select().single();
    const cfg = await mailSlackCfg(sb);
    if (cfg.bot_token) await postCard(sb, cfg, d);
    return d;
  } catch (e) {
    await sb.from("mail_drafts").update({ status: "listed" }).eq("id", row.id);
    throw e;
  }
}
export async function cleanupAll(sb, opts = {}) {
  const { data: accts } = await sb.from("mail_accounts").select("*").eq("enabled", true).not("refresh_token", "is", null);
  const out = [];
  for (const a of accts || []) {
    const r = await cleanupAccount(sb, a, opts).catch(e => ({ account: a.email, error: e.message }));
    if (r) out.push(r);
    if (!r || r.done) { const k = await recheckListed(sb, a, opts).catch(e => ({ account: a.email, error: e.message })); if (k) out.push({ recheck: k }); }
  }
  return out;
}
