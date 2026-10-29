// Offline checks for the email assistant (api/_lib/mail-assistant.js): reading
// Gmail messages, what's ignored without asking Claude, the reply's MIME, the
// Slack card, and the whole loop - poll -> draft in Slack -> Send / Skip /
// rewrite -> answered in Gmail. Fake Google, Gmail, Slack and Claude.
//
//   node scripts/test-mail-assistant.mjs

import { fakeSupabase } from "./fake-supabase.mjs";
Object.assign(process.env, { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csec", CRON_SECRET: "cron" });
const M = await import("../api/_lib/mail-assistant.js");

let failed = 0;
const check = (ok, label) => { console.log((ok ? "PASS  " : "FAIL  ") + label); if (!ok) failed++; };
const b64 = (s) => Buffer.from(s).toString("base64url");
const msg = (id, { from = "Kelly Cannon <kelly@yahoo.com>", subject = "Tickets", text = "I actually RSVP'd for 4 tickets.", html = null, labels = ["INBOX", "UNREAD"], headers = {}, thread = "t" + id, at = Date.now() } = {}) => ({
  id, threadId: thread, labelIds: labels, internalDate: String(at),
  payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: from }, { name: "Subject", value: subject }, { name: "Message-ID", value: `<${id}@mail.yahoo.com>` }, ...Object.entries(headers).map(([name, value]) => ({ name, value }))],
    parts: [...(text != null ? [{ mimeType: "text/plain", body: { data: b64(text) } }] : []), ...(html ? [{ mimeType: "text/html", body: { data: b64(html) } }] : [])] },
});

// ── 1. reading mail ──────────────────────────────────────────────────────────
console.log("== 1. reading mail ==");
check(JSON.stringify(M.parseAddress('"Kelly Cannon" <Kelly@Yahoo.com>')) === '{"name":"Kelly Cannon","email":"kelly@yahoo.com"}' && M.parseAddress("bob@x.com").email === "bob@x.com", "names and addresses");
const p = M.parseMessage(msg("m1", { text: "Sounds good!\n\nOn Thu, Oct 29, 2026 at 12:32 PM DS Elite <invite@dselitevolleyball.com> wrote:\n> Hi Kelly", headers: { "Reply-To": "kc@work.com", References: "<a@x>" } }));
check(p.latest === "Sounds good!" && p.subject === "Tickets" && p.from_name === "Kelly Cannon" && p.reply_to === "kc@work.com" && p.message_id === "<m1@mail.yahoo.com>" && p.references_ids === "<a@x>", "the newest part only, reply-to, ids");
check(M.parseMessage(msg("m2", { text: null, html: "<p>Hi Drew,</p><p>Can we <b>book</b> a court?</p><style>p{}</style>" })).latest === "Hi Drew,\nCan we book a court?", "HTML-only email turned into text");
const ig = (o) => M.ignoreReason(M.parseMessage(msg("x", o)), "drew@dselitevolleyball.com");
check(ig({}) === null, "a parent's email goes to Claude");
check(ig({ labels: ["INBOX", "CATEGORY_PROMOTIONS"] }) === "Gmail promotions" && ig({ headers: { "List-Unsubscribe": "<mailto:u@x>" } }) === "mailing list" && ig({ headers: { Precedence: "bulk" } }) === "bulk mail", "promotions, newsletters and bulk mail are left alone");
check(ig({ from: "Playbook <no-reply@playbookapi.com>" }) === "no-reply sender" && ig({ from: "Stripe <receipts@stripe.com>" }) === "no-reply sender" && ig({ headers: { "Auto-Submitted": "auto-replied" } }) === "automatic reply", "no-reply senders, receipts, auto-replies");
check(ig({ from: "Drew <drew@drippingsportsclub.com>" }) === "from you", "Drew's own other mailbox");

// ── 2. the reply ─────────────────────────────────────────────────────────────
console.log("== 2. the reply ==");
const d0 = { account: "drew@dselitevolleyball.com", from_email: "kelly@yahoo.com", from_name: "Kelly Cannon", reply_to: null, subject: "Tickets", message_id: "<m1@mail.yahoo.com>", references_ids: "<a@x>", body: "I actually RSVP'd for 4 tickets.", received_at: "2026-10-29T17:55:00Z" };
const raw = Buffer.from(M.buildMime(d0, "All good - you can adjust it when you click the link.\n\n-Drew"), "base64url").toString();
const [head, bodyB64] = raw.split("\r\n\r\n");
const body = Buffer.from(bodyB64.replace(/\r\n/g, ""), "base64").toString();
check(/^From: Drew Rose <drew@dselitevolleyball.com>$/m.test(head) && /^To: Kelly Cannon <kelly@yahoo.com>$/m.test(head) && /^Subject: Re: Tickets$/m.test(head), "from Drew's mailbox, to them, Re: subject");
check(/^In-Reply-To: <m1@mail.yahoo.com>$/m.test(head) && /^References: <a@x> <m1@mail.yahoo.com>$/m.test(head), "threads under their email");
check(body.startsWith("All good - you can adjust it") && /wrote:\n> I actually RSVP'd for 4 tickets\./.test(body), "the reply, then their message quoted");
const raw2 = Buffer.from(M.buildMime({ ...d0, subject: "RE: Tickets", reply_to: "kc@work.com", from_name: "Zoë" }, "hi"), "base64url").toString();
check(/^Subject: RE: Tickets$/m.test(raw2) && /^To: =\?UTF-8\?B\?.+\?= <kc@work.com>$/m.test(raw2), "keeps an existing Re:, answers the Reply-To, encodes accents");
const st = M.signState({ a: "drew@dselitevolleyball.com", by: "drew@x" });
check(M.readState(st)?.a === "drew@dselitevolleyball.com" && !M.readState(st + "x") && !M.readState(st, Date.now() + 31 * 60e3), "the sign-in state is signed and runs out");
check(/access_type=offline/.test(M.authUrl("drew@dselitevolleyball.com", "drew")) && /gmail\.modify/.test(decodeURIComponent(M.authUrl("drew@dselitevolleyball.com", "drew"))) && /login_hint=drew%40dselitevolleyball\.com/.test(M.authUrl("drew@dselitevolleyball.com", "drew")), "Google sign-in asks for lasting Gmail access to that mailbox");

// ── 3. the loop ──────────────────────────────────────────────────────────────
console.log("== 3. the loop ==");
const now = Date.now();
const inbox = new Map([
  ["k1", msg("k1", { at: now - 60e3 })],
  ["n1", msg("n1", { from: "DSSC News <news@mailchimp.com>", headers: { "List-Unsubscribe": "<x>" }, at: now - 50e3 })],
  ["t1", msg("t1", { from: "Pat <pat@gmail.com>", subject: "Thanks!", text: "Thanks so much!", at: now - 40e3 })],
  ["old", msg("old", { at: now - 5 * 864e5 })],
]);
const threads = new Map();
const sent = [], slack = [], claude = [];
const fakeFetch = async (url, o = {}) => {
  const u = String(url), J = (j, status = 200) => ({ ok: status < 400, status, json: async () => j });
  if (u.startsWith("https://oauth2.googleapis.com/token")) return J({ access_token: "at-" + new URLSearchParams(o.body).get("grant_type"), expires_in: 3600, refresh_token: "rt" });
  if (u.startsWith("https://slack.com/api/")) { const m = u.split("/").pop(); const b = JSON.parse(o.body.startsWith("{") ? o.body : "{}"); slack.push({ m, b, form: o.body }); return J(m === "users.lookupByEmail" ? { ok: true, user: { id: "UDREW" } } : m === "conversations.open" ? { ok: true, channel: { id: "DDREW" } } : { ok: true, channel: "DDREW", ts: "1.00" + slack.length }); }
  const g = /gmail\/v1\/users\/me\/(.+?)(\?|$)/.exec(u)?.[1];
  if (g === "profile") return J({ emailAddress: "Drew@DSEliteVolleyball.com" });
  if (g === "messages" && (o.method || "GET") === "GET") { const q = new URL(u).searchParams.get("q"); return J({ messages: /in:sent/.test(q) ? [] : [...inbox.keys()].reverse().map(id => ({ id })) }); }
  if (g === "messages/send") { const b = JSON.parse(o.body); sent.push(b); return J({ id: "sent" + sent.length, threadId: b.threadId }); }
  if (g?.startsWith("messages/")) return J(inbox.get(g.split("/")[1]));
  if (g?.startsWith("threads/")) { const id = g.split("/")[1]; return J({ messages: threads.get(id) || [inbox.get(id.slice(1))].filter(Boolean) }); }
  return J({ error: { message: "unknown " + u } }, 404);
};
globalThis.fetch = fakeFetch;
const client = { beta: { messages: { create: async (req) => { claude.push(req); const t = req.messages[0].content; const thanks = /Thanks so much/.test(t); const change = /wants the reply changed: (.*)/.exec(t)?.[1];
  return { content: [{ type: "text", text: JSON.stringify(thanks ? { needs_reply: false, reason: "just a thank-you", draft: "", note: "" } : { needs_reply: true, reason: "ticket count", draft: change ? `Hi Kelly! (${change})\n\n-Drew` : "Hi Kelly, no problem - you can change it to 4 on the payment page.\n\n-Drew", note: "" }) }] }; } } } };
const sb = fakeSupabase({ mail_accounts: [{ email: "drew@dselitevolleyball.com", refresh_token: "rt", enabled: true, connected_at: new Date(now - 864e5).toISOString() }], mail_drafts: [], hq_kv: [{ key: "product_slack", value: { bot_token: "xoxb", signing_secret: "s" } }] });
const r1 = await M.pollAccount(sb, sb.db.mail_accounts[0], { fetchImpl: fakeFetch, client });
const rows = Object.fromEntries(sb.db.mail_drafts.map(r => [r.gmail_id, r]));
check(r1.looked === 3 && r1.drafted === 1 && r1.ignored === 1 && r1.no_reply === 1, `3 new emails: 1 drafted, 1 newsletter, 1 thank-you; mail from before connecting skipped (${JSON.stringify(r1)})`);
check(rows.n1.status === "ignored" && rows.n1.reason === "mailing list" && claude.length === 2, "the newsletter never went to Claude");
check(rows.t1.status === "ignored" && /thank-you/.test(rows.t1.reason), "Claude: a thank-you needs no reply");
const posted = slack.find(s => s.m === "chat.postMessage");
check(rows.k1.status === "pending" && rows.k1.slack_channel === "DDREW" && posted && JSON.stringify(posted.b.blocks).includes("mail_send") && JSON.stringify(posted.b.blocks).includes("RSVP"), "the draft is in Drew's Slack DMs with Send / Edit / Skip and their email");
check(/drew@dselitevolleyball\.com/.test(claude[0].messages[0].content) && /I actually RSVP/.test(claude[0].messages[0].content), "Claude sees which mailbox and their email");
const r2 = await M.pollAccount(sb, sb.db.mail_accounts[0], { fetchImpl: fakeFetch, client });
check(r2.looked === 0 && sb.db.mail_drafts.length === 3 && claude.length === 2, "the next check doesn't look at them again");

// Rewrite from the thread, then exact text, then Send.
const id = rows.k1.id;
const rv = await M.reviseDraft(sb, id, "make it shorter", { client, fetchImpl: fakeFetch });
check(rv.draft === "Hi Kelly! (make it shorter)\n\n-Drew" && slack.some(s => s.m === "chat.update"), "a thread reply rewrites the draft and updates the card");
const rv2 = await M.reviseDraft(sb, id, "reply: All good - you can adjust when you click on the link.\n\n-Drew", { client, fetchImpl: fakeFetch });
check(rv2.draft === "All good - you can adjust when you click on the link.\n\n-Drew" && claude.length === 3, "\"reply: ...\" uses Drew's words exactly, no Claude");
const s1 = await M.sendDraft(sb, id, "Drew", { fetchImpl: fakeFetch });
check(s1.status === "sent" && sent.length === 1 && sent[0].threadId === "tk1" && Buffer.from(sent[0].raw, "base64url").toString().includes("In-Reply-To: <k1@mail.yahoo.com>"), "Send: from Gmail, in the thread");
const upd = slack.filter(s => s.m === "chat.update").pop();
check(/Sent/.test(JSON.stringify(upd.b.blocks)) && !JSON.stringify(upd.b.blocks).includes("mail_send"), "the card says Sent, buttons gone");
await M.sendDraft(sb, id, "Drew", { fetchImpl: fakeFetch });
check(sent.length === 1, "pressing Send twice sends once");
await M.skipDraft(sb, id, "Drew");
check(sb.db.mail_drafts.find(r => r.id === id).status === "sent", "Skip after Send changes nothing");

// Answered in Gmail first; Skip; a failed send can be retried.
inbox.set("k2", msg("k2", { subject: "Practice?", at: now - 30e3 }));
await M.pollAccount(sb, sb.db.mail_accounts[0], { fetchImpl: fakeFetch, client });
threads.set("tk2", [inbox.get("k2"), { id: "mine", labelIds: ["SENT"], internalDate: String(now) }]);
const r3 = await M.pollAccount(sb, sb.db.mail_accounts[0], { fetchImpl: fakeFetch, client });
check(r3.answered === 1 && sb.db.mail_drafts.find(r => r.gmail_id === "k2").status === "answered" && /Answered in Gmail/.test(JSON.stringify(slack.filter(s => s.m === "chat.update").pop().b.blocks)), "answered in Gmail first: the card says so, nothing sent");
inbox.set("k3", msg("k3", { subject: "Uniforms", at: now - 20e3 }));
await M.pollAccount(sb, sb.db.mail_accounts[0], { fetchImpl: fakeFetch, client });
const k3 = sb.db.mail_drafts.find(r => r.gmail_id === "k3");
await M.skipDraft(sb, k3.id, "Drew");
check(sb.db.mail_drafts.find(r => r.id === k3.id).status === "skipped" && sent.length === 1, "Skip: nothing sent");
inbox.set("k4", msg("k4", { subject: "Court", at: now - 10e3 }));
await M.pollAccount(sb, sb.db.mail_accounts[0], { fetchImpl: fakeFetch, client });
const k4 = sb.db.mail_drafts.find(r => r.gmail_id === "k4");
const realFetch = fakeFetch;
const failing = async (u, o) => /messages\/send/.test(String(u)) ? { ok: false, status: 500, json: async () => ({ error: { message: "backend error" } }) } : realFetch(u, o);
await M.sendDraft(sb, k4.id, "Drew", { fetchImpl: failing }).then(() => check(false, "send failure"), e => check(/backend error/.test(e.message) && sb.db.mail_drafts.find(r => r.id === k4.id).status === "failed", "a failed send is marked failed and says why"));
await M.sendDraft(sb, k4.id, "Drew", { fetchImpl: fakeFetch });
check(sb.db.mail_drafts.find(r => r.id === k4.id).status === "sent", "…and Send again works");

// Two Workspaces: DS Elite's mailbox uses its own client when it has one.
check(M.clientFor("drew@dselitevolleyball.com").id === "cid" && M.clientFor("drew@drippingsportsclub.com").id === "cid", "one client for both mailboxes until DS Elite has its own");
process.env.GOOGLE_DSE_CLIENT_ID = "dse-cid"; process.env.GOOGLE_DSE_CLIENT_SECRET = "dse-sec";
check(M.clientFor("drew@dselitevolleyball.com").id === "dse-cid" && M.clientFor("drew@drippingsportsclub.com").id === "cid" && /client_id=dse-cid/.test(M.authUrl("drew@dselitevolleyball.com", "drew")), "DS Elite's own client for its mailbox, the main one for DSSC's");
delete process.env.GOOGLE_DSE_CLIENT_ID; delete process.env.GOOGLE_DSE_CLIENT_SECRET;

// Connecting: the mailbox must be one of Drew's.
const sbc = fakeSupabase({ mail_accounts: [] });
const con = await M.finishConnect(sbc, { code: "c", state: M.signState({ a: "drew@dselitevolleyball.com", by: "drew" }) }, { fetchImpl: fakeFetch });
check(con.email === "drew@dselitevolleyball.com" && sbc.db.mail_accounts[0].refresh_token === "rt" && sbc.db.mail_accounts[0].connected_at, "connecting saves the mailbox's lasting token");
await M.finishConnect(sbc, { code: "c", state: "bad.sig" }, { fetchImpl: fakeFetch }).then(() => check(false, "bad state"), e => check(/run out/.test(e.message), "a forged or old sign-in link is refused"));

// ── 4. its own Slack app ("DSSC Mail") ───────────────────────────────────────
console.log("== 4. DSSC Mail app ==");
const calls = [];
globalThis.fetch = async (url, o = {}) => {
  const u = String(url);
  if (u.startsWith("https://slack.com/api/")) {
    const m = u.split("/").pop(), auth = o.headers?.Authorization || "";
    calls.push({ m, auth, body: o.body });
    if (m === "auth.test") return { ok: true, status: 200, json: async () => auth.includes("xoxb-good") ? { ok: true, user_id: "UMAIL", team: "DSSC" } : { ok: false, error: "invalid_auth" } };
    if (m === "chat.update") return { ok: true, status: 200, json: async () => auth.includes("xoxb-good") && JSON.parse(o.body).channel === "DOLD" ? { ok: false, error: "channel_not_found" } : { ok: true } };
    return { ok: true, status: 200, json: async () => m === "users.lookupByEmail" ? { ok: true, user: { id: "UDREW" } } : m === "conversations.open" ? { ok: true, channel: { id: auth.includes("xoxb-good") ? "DMAIL" : "DHQ" } } : { ok: true, channel: "DMAIL", ts: "9.1" } };
  }
  return fakeFetch(url, o);
};
const sbs = fakeSupabase({ hq_kv: [{ key: "product_slack", value: { bot_token: "xoxb-hq", signing_secret: "s1" } }] });
check((await M.mailSlackCfg(sbs)).app === "hq", "until DSSC Mail is set up, email goes through the HQ bot");
await M.saveMailSlack(sbs, { bot_token: "nope" }, "drew").then(() => check(false, "bad token"), e => check(/xoxb-/.test(e.message), "a token that isn't a bot token is refused"));
await M.saveMailSlack(sbs, { bot_token: "xoxb-bad" }, "drew").then(() => check(false, "slack refused"), e => check(/invalid_auth/.test(e.message), "a token Slack rejects is refused"));
const saved = await M.saveMailSlack(sbs, { bot_token: "xoxb-good", signing_secret: "mailsecret" }, "drew");
const mc = await M.mailSlackCfg(sbs);
check(saved.connected && saved.signing && mc.app === "mail" && mc.bot_user === "UMAIL" && mc.team === "DSSC", "saving DSSC Mail's token and secret switches email over to it");
check((await M.testMailSlack(sbs)).app === "mail" && calls.some(c => c.m === "chat.postMessage" && c.auth.includes("xoxb-good")), "the test DM comes from DSSC Mail");
calls.length = 0;
await M.refreshCard(sbs, { id: 1, account: "drew@dselitevolleyball.com", from_email: "a@b.com", subject: "x", slack_channel: "DOLD", slack_ts: "1.1", status: "sent", draft: "hi" }, { done: "Sent" });
check(calls.filter(c => c.m === "chat.update").map(c => c.auth.includes("good") ? "mail" : "hq").join() === "mail,hq", "an older card the HQ bot posted is still updated through the HQ bot");
await M.saveMailSlack(sbs, { bot_token: "", signing_secret: "" }, "drew");
check((await M.mailSlackCfg(sbs)).app === "hq", "Remove: back to the HQ bot");
const { signed } = await import("../api/mail-slack.js");
const crypto = await import("node:crypto");
const ts = String(Math.floor(Date.now() / 1000)), rawBody = "payload=%7B%7D";
const sig = "v0=" + crypto.createHmac("sha256", "mailsecret").update(`v0:${ts}:${rawBody}`).digest("hex");
check(signed({ "x-slack-request-timestamp": ts, "x-slack-signature": sig }, rawBody, "mailsecret") && !signed({ "x-slack-request-timestamp": ts, "x-slack-signature": sig }, rawBody, "s1") && !signed({ "x-slack-request-timestamp": String(+ts - 600), "x-slack-signature": sig }, rawBody, "mailsecret"), "DSSC Mail's requests must carry its own signature, and be fresh");

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
