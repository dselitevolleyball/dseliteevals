// Product board <-> Slack (Drew, Oct 28 2026: "get slacked when someone has a
// request, not emailed", then "can I respond to Slack messages? - do it").
//
// Settings live in hq_kv "product_slack" (server-side only):
//   { url }                       an incoming webhook - posting only (fallback)
//   { bot_token, signing_secret, channel }   the Slack app's bot: posts with
//       buttons, keeps one thread per card (product_slack_threads), and lets
//       /api/product-slack act on button clicks and thread replies.
// Posts: a new staff request (Approve / Decline), an agent run ready for
// review (Ship it / preview), a failed run, a ship.

export const SLACK_HOOK = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/;
export const HQ_URL = "https://dseliteevals.vercel.app/?view=product";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const slackLink = (url, text) => `<${url}|${esc(text).replace(/\|/g, "-")}>`;
export const cardUrl = (id) => `${HQ_URL}&item=${id}`;
export const cardLink = (id, title) => slackLink(cardUrl(id), `HQ-${id}: ${title}`);
export const quote = (s, n = 600) => String(s || "").trim().slice(0, n).split("\n").map(l => "> " + esc(l)).join("\n");

export async function slackCfg(sb) {
  const { data } = await sb.from("hq_kv").select("value").eq("key", "product_slack").maybeSingle();
  return data?.value || {};
}
export async function saveSlackCfg(sb, patch, by) {
  const next = { ...(await slackCfg(sb)), ...patch };
  for (const k of Object.keys(next)) if (next[k] === "" || next[k] == null) delete next[k];
  await sb.from("hq_kv").upsert({ key: "product_slack", value: Object.keys(next).length ? next : null, secret: true, updated_at: new Date().toISOString(), updated_by: by }, { onConflict: "key" });
  return next;
}

// chat.* take JSON; Slack's read methods (users.lookupByEmail, users.info,
// conversations.info...) only take form fields and answer JSON with
// "invalid_arguments".
export async function slackApi(token, method, body) {
  const json = /^chat\./.test(method);
  const form = new URLSearchParams(Object.entries(body || {}).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]));
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": json ? "application/json; charset=utf-8" : "application/x-www-form-urlencoded" },
    body: json ? JSON.stringify(body || {}) : form.toString(),
  }).catch(e => ({ ok: false, json: async () => ({ ok: false, error: e.message }) }));
  const j = await r.json().catch(() => ({ ok: false, error: "bad reply" }));
  return j;
}

// Where the bot posts: the chosen channel, or a DM with the owner (found by email).
const OWNER_EMAILS = ["drew@drippingsportsclub.com", "drew@dselitevolleyball.com"];
export async function slackTarget(sb, cfg) {
  if (cfg.channel) return cfg.channel;
  for (const email of OWNER_EMAILS) {
    const u = await slackApi(cfg.bot_token, "users.lookupByEmail", { email });
    if (u.ok) {
      const im = await slackApi(cfg.bot_token, "conversations.open", { users: u.user.id });
      if (im.ok) { await saveSlackCfg(sb, { channel: im.channel.id, channel_name: "DM with " + (u.user.real_name || u.user.name) }, "slack"); return im.channel.id; }
    }
  }
  return null;
}

// ── message bodies ─────────────────────────────────────────────────────────
const btn = (text, action_id, value, style, extra = {}) => ({ type: "button", text: { type: "plain_text", text, emoji: true }, action_id, value: String(value), ...(style ? { style } : {}), ...extra });
const openBtn = (id) => ({ type: "button", text: { type: "plain_text", text: "Open in HQ", emoji: true }, url: cardUrl(id), action_id: "open" });
const section = (text) => ({ type: "section", text: { type: "mrkdwn", text: String(text).slice(0, 2900) } });
const context = (text) => ({ type: "context", elements: [{ type: "mrkdwn", text: String(text).slice(0, 2900) }] });

export function requestMessage(item, who, where, hasShot) {
  const kind = item.kind === "bug" ? "🐞 Bug report" : item.kind === "improvement" ? "✨ Improvement" : "💡 New idea";
  const text = `${kind} from *${esc(who)}*${where}\n*${cardLink(item.id, item.title)}*${item.body ? "\n" + quote(item.body) : ""}${hasShot ? "\n📷 has a screenshot" : ""}`;
  return { text: `${kind} from ${who}: ${item.title}`, blocks: [section(text), { type: "actions", elements: [btn("✓ Approve", "approve", item.id, "primary"), btn("Decline", "decline", item.id, "danger"), openBtn(item.id)] }, context("Reply in this thread to add a note, or type *approve* / *decline* and a reason.")] };
}
export function decidedMessage(item, approve, by, note) {
  const text = `${approve ? "✓ *Approved*" : "✗ *Declined*"} by ${esc(by)}: *${cardLink(item.id, item.title)}*${note ? `\n${quote(note, 300)}` : ""}`;
  const actions = approve ? [String(item.body || "").trim() ? btn("▶ Build it with the agent", "build", item.id, "primary") : null, openBtn(item.id)].filter(Boolean) : [openBtn(item.id)];
  return { text: `${approve ? "Approved" : "Declined"}: ${item.title}`, blocks: [section(text), { type: "actions", elements: actions }, ...(approve && !String(item.body || "").trim() ? [context("Add a description in HQ before building - the agent works from it.")] : [])] };
}
export function reviewMessage(item, run, cost) {
  const text = `🤖 *Ready to review:* ${cardLink(item.id, item.title)}${cost}${run.summary ? "\n" + quote(run.summary, 1200) : ""}`;
  return { text: `Ready to review: ${item.title}`, blocks: [section(text), { type: "actions", elements: [
    btn("🚀 Ship it", "ship", item.id, "primary", { confirm: { title: { type: "plain_text", text: "Ship it?" }, text: { type: "mrkdwn", text: `This merges *HQ-${item.id}* into the live app and Vercel deploys it.` }, confirm: { type: "plain_text", text: "Ship it" }, deny: { type: "plain_text", text: "Not yet" } } }),
    ...(run.preview_url ? [{ type: "button", text: { type: "plain_text", text: "Open preview", emoji: true }, url: run.preview_url, action_id: "preview" }] : []),
    openBtn(item.id),
  ] }, context("Reply in this thread with changes and the agent does another round. Start with *note:* to just leave a note.")] };
}
export const failedMessage = (item, err) => ({ text: `Agent run failed: ${item.title}`, blocks: [section(`⚠️ The agent run failed on *${cardLink(item.id, item.title)}*:\n${quote(err, 400)}`), { type: "actions", elements: [btn("↻ Try again", "retry", item.id), openBtn(item.id)] }] });
export const shippedMessage = (item, cost) => ({ text: `Shipped: ${item.title}`, blocks: [section(`🚀 *Shipped* ${cardLink(item.id, item.title)} - live once Vercel finishes deploying${cost}`)] });

// ── posting ────────────────────────────────────────────────────────────────
// With the bot: the card's first message starts its thread; later ones reply
// in it (broadcast = also show in the channel/DM). Without it: the webhook.
export async function postCard(sb, item, msg, { broadcast = false } = {}) {
  const cfg = await slackCfg(sb);
  if (cfg.bot_token) {
    const channel = await slackTarget(sb, cfg);
    if (channel) {
      const { data: th } = await sb.from("product_slack_threads").select("channel, ts").eq("item_id", item.id).maybeSingle();
      const inThread = th && th.channel === channel;
      const r = await slackApi(cfg.bot_token, "chat.postMessage", { channel, ...msg, unfurl_links: false, unfurl_media: false, ...(inThread ? { thread_ts: th.ts, ...(broadcast ? { reply_broadcast: true } : {}) } : {}) });
      if (r.ok && !inThread) await sb.from("product_slack_threads").upsert({ item_id: item.id, channel, ts: r.ts }, { onConflict: "item_id" });
      if (r.ok) return { ok: true, ts: r.ts, channel };
      if (!cfg.url) return { ok: false, error: r.error };
    }
  }
  if (!cfg.url) return { skipped: true };
  try {
    const r = await fetch(cfg.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...msg, unfurl_links: false, unfurl_media: false }) });
    return { ok: r.ok, status: r.status, error: r.ok ? undefined : (await r.text().catch(() => "")).slice(0, 200) };
  } catch (e) { return { ok: false, error: e.message }; }
}
export async function replyInThread(sb, channel, thread_ts, text) {
  const cfg = await slackCfg(sb);
  if (!cfg.bot_token) return;
  await slackApi(cfg.bot_token, "chat.postMessage", { channel, thread_ts, text, unfurl_links: false });
}

// A plain line (tests, simple notices).
export async function productSlack(sb, text) {
  const cfg = await slackCfg(sb);
  if (cfg.bot_token) {
    const channel = await slackTarget(sb, cfg);
    if (channel) { const r = await slackApi(cfg.bot_token, "chat.postMessage", { channel, text }); return r.ok ? { ok: true } : { ok: false, error: r.error }; }
  }
  if (!cfg.url) return { skipped: true };
  const r = await fetch(cfg.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }).catch(e => ({ ok: false, statusText: e.message }));
  return { ok: !!r.ok, status: r.status, error: r.ok ? undefined : r.statusText };
}
