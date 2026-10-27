// Vercel Cron: a director's own Gmail replies land on the shared inbox's threads
// (Drew, Oct 26 2026: "when Jonathan responds in his Gmail it shows up as
// responded in the HQ Inbox, shows his response and reclassifies it").
//
// api/site-inbox-poll.js only sees mail that reaches info@, so a director who
// answers a family straight from Gmail (or hits Reply on HQ's alert email,
// whose Reply-To is the family) left the thread looking unanswered. This reads
// each opted-in director's Sent folder over IMAP, READ-ONLY, and for every
// message sent to a family with an open thread (or replying to a message on
// one) it:
//   - stores it on the thread as the director's reply ('out' message),
//   - sets the thread to Waiting (on the family) if it was New or Open,
//   - assigns the thread to that director if nobody had it.
// Everything else in the Sent folder is left alone: only the envelope (who it
// went to, Message-ID, In-Reply-To) is read to decide, and only matching
// messages are fetched in full. Nothing is flagged or moved, so the director's
// mailbox is never changed; Message-IDs are unique in the table, so a message
// already filed (sent from HQ, or CC'd to info@) is never stored twice.
//
// Auth: Vercel Cron `Authorization: Bearer <CRON_SECRET>`, or ?token=<CRON_SECRET>.
// ?dry=1 reports what would be filed without writing.
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET   required
//   DSSC_INBOX_PASS_<NAME>     one per director: the Google App Password for their
//                              own account, e.g. DSSC_INBOX_PASS_JONATHAN reads
//                              jonathan@drippingsportsclub.com (Drew, Oct 27 2026:
//                              a separate token each, so one can be changed alone)
//   DSSC_INBOX_USER_<NAME>     optional, the address when it isn't <name>@drippingsportsclub.com
//   DSSC_INBOX_SENT_ACCOUNTS   older form, still read: a JSON list
//                              [{"user":"jonathan@drippingsportsclub.com","pass":"abcd efgh ijkl mnop"}]
//   DSSC_INBOX_IMAP_HOST       optional, default imap.gmail.com
//   DSSC_INBOX_SENT_SINCE_DAYS optional, default 3 (how far back to look each run)

import { createClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { nrm, isEmailish, canonicalDirectorEmail, directorName } from "./_lib/site-inbox.js";

export const config = { maxDuration: 60 };

const MAX_TEXT = 60_000, MAX_HTML = 200_000, MAX_PER_ACCOUNT = 200;
const msgIds = (v) => (Array.isArray(v) ? v : String(v || "").split(/\s+/)).map(s => String(s || "").trim()).filter(s => /^<.+>$/.test(s));
const envAddrs = (list) => (list || []).map(a => nrm(a?.address)).filter(Boolean);

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET } = process.env;
  const urlToken = (() => { try { return new URL(req.url, "https://x").searchParams.get("token") || ""; } catch { return ""; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (bearer !== CRON_SECRET && urlToken !== CRON_SECRET)) return res.status(403).json({ error: "Forbidden" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  let accounts;
  try { accounts = sentAccounts(process.env); } catch (e) { return res.status(500).json({ error: e.message }); }
  if (!accounts.length) return res.status(200).json({ ok: true, skipped: "No DSSC_INBOX_PASS_<NAME> (or DSSC_INBOX_SENT_ACCOUNTS) set" });

  const dry = new URL(req.url, "https://x").searchParams.get("dry") === "1";
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const sinceDays = Math.max(1, Math.min(30, Number(process.env.DSSC_INBOX_SENT_SINCE_DAYS) || 3));
  const since = new Date(Date.now() - sinceDays * 86400000);

  // Families with a thread still open (last 120 days): who a director's mail has to go to, to count.
  const { data: open, error: oErr } = await sb.from("site_inquiries").select("id, email, status, assigned_to, last_message_at")
    .not("status", "in", "(done,spam)").eq("is_test", false).gte("created_at", new Date(Date.now() - 120 * 86400000).toISOString());
  if (oErr) return res.status(500).json({ error: oErr.message });
  const byEmail = new Map();
  for (const q of open || []) { const e = nrm(q.email); if (!isEmailish(e)) continue; const cur = byEmail.get(e); if (!cur || String(q.last_message_at) > String(cur.last_message_at)) byEmail.set(e, q); }

  const out = { ok: true, dry, accounts: [] };
  for (const acct of accounts) {
    const user = nrm(acct.user), stats = { user, scanned: 0, filed: 0, duplicates: 0, items: [], error: null };
    out.accounts.push(stats);
    const client = new ImapFlow({ host: process.env.DSSC_INBOX_IMAP_HOST || "imap.gmail.com", port: 993, secure: true, auth: { user, pass: String(acct.pass).replace(/\s+/g, "") }, logger: false });
    try { await client.connect(); }
    catch (e) { stats.error = "IMAP login failed" + (e.authenticationFailed ? " (check the App Password)" : ""); continue; }
    try {
      const boxes = await client.list();
      const sent = boxes.find(b => b.specialUse === "\\Sent") || boxes.find(b => /sent/i.test(b.path));
      if (!sent) { stats.error = "No Sent folder"; continue; }
      const lock = await client.getMailboxLock(sent.path, { readOnly: true });
      try { await fileSent(sb, client, user, byEmail, { since, dry, stats }); }
      finally { lock.release(); }
    } catch (e) { stats.error = e.message || String(e); }
    finally { await client.logout().catch(() => {}); }
  }
  // One line per account in the runtime logs, and the last run in site_inbox_sent_status,
  // so a cron run can be checked without the secret.
  const now = new Date().toISOString();
  for (const a of out.accounts) {
    console.log(`sent-poll ${a.user}: scanned ${a.scanned}, filed ${a.filed}, duplicates ${a.duplicates}${dry ? " (dry)" : ""}${a.error ? ", error: " + a.error : ""}`);
    if (dry) continue;
    const row = { account: a.user, last_run_at: now, scanned: a.scanned, filed: a.filed, duplicates: a.duplicates, error: a.error };
    if (!a.error) row.last_ok_at = now;
    if (a.filed) row.last_filed_at = now;
    await sb.from("site_inbox_sent_status").upsert(row, { onConflict: "account" }).then(() => {}, () => {});
  }
  return res.status(200).json(out);
}

// The directors to read: one DSSC_INBOX_PASS_<NAME> each, plus any in the older
// DSSC_INBOX_SENT_ACCOUNTS list. A separate token wins over the list for the same address.
export function sentAccounts(env) {
  const byUser = new Map();
  if (env.DSSC_INBOX_SENT_ACCOUNTS) {
    let list;
    try { list = JSON.parse(env.DSSC_INBOX_SENT_ACCOUNTS); } catch { throw new Error("DSSC_INBOX_SENT_ACCOUNTS isn't valid JSON"); }
    for (const a of Array.isArray(list) ? list : []) if (isEmailish(a?.user) && a?.pass) byUser.set(nrm(a.user), { user: nrm(a.user), pass: a.pass });
  }
  for (const [k, pass] of Object.entries(env)) {
    const m = /^DSSC_INBOX_PASS_([A-Z0-9_]+)$/.exec(k);
    if (!m || !String(pass || "").trim()) continue;
    const user = nrm(env["DSSC_INBOX_USER_" + m[1]] || m[1].toLowerCase() + "@drippingsportsclub.com");
    if (isEmailish(user)) byUser.set(user, { user, pass });
  }
  return [...byUser.values()];
}

// One director's Sent folder (already open, read-only): file what went to families with open threads.
export async function fileSent(sb, client, user, byEmail, { since, dry, stats }) {
  let uids = await client.search({ since }, { uid: true });
  if (!Array.isArray(uids)) uids = [];
  uids = uids.slice(-MAX_PER_ACCOUNT);
  stats.scanned = uids.length;
  if (!uids.length) return;
  // Envelopes only: who each message went to, and what it answers.
  const cands = [];
  for await (const m of client.fetch(uids, { envelope: true }, { uid: true })) {
    const env = m.envelope || {};
    const to = [...envAddrs(env.to), ...envAddrs(env.cc), ...envAddrs(env.bcc)];
    const family = to.find(a => byEmail.has(a));
    const inReplyTo = msgIds(env.inReplyTo)[0] || null;
    if (family || inReplyTo) cands.push({ uid: m.uid, family, inReplyTo, messageId: String(env.messageId || "").trim() || null, to });
  }
  // Replies to a message we know, even when sent to an address the thread doesn't list.
  const replyIds = [...new Set(cands.map(c => c.inReplyTo).filter(Boolean))];
  const known = new Map();
  if (replyIds.length) { const { data } = await sb.from("site_inbox_messages").select("message_id, inquiry_id").in("message_id", replyIds); for (const r of data || []) known.set(r.message_id, r.inquiry_id); }
  for (const c of cands) {
    const inqId = (c.inReplyTo && known.get(c.inReplyTo)) || (c.family && byEmail.get(c.family)?.id) || null;
    if (!inqId) continue;
    if (c.messageId) {
      const { data: dup } = await sb.from("site_inbox_messages").select("id").eq("message_id", c.messageId).limit(1);
      if (dup && dup.length) { stats.duplicates++; continue; }
    }
    const fetched = await client.fetchOne(c.uid, { source: true }, { uid: true });
    if (!fetched?.source) continue;
    const mail = await simpleParser(fetched.source);
    const subject = String(mail.subject || "").trim().slice(0, 300);
    const when = mail.date instanceof Date && !isNaN(mail.date) ? mail.date : new Date();
    const refs = [...new Set([...msgIds(mail.references), ...(c.inReplyTo ? [c.inReplyTo] : [])])];
    const item = { inquiry_id: inqId, to: c.family || c.to[0], subject, at: when.toISOString() };
    stats.items.push(item);
    if (dry) continue;
    const { error } = await sb.from("site_inbox_messages").insert({
      inquiry_id: inqId, direction: "out", from_name: String(mail.from?.value?.[0]?.name || "").trim() || directorName(user), from_email: user,
      to_email: c.family || c.to[0] || null, subject, body_text: String(mail.text || "").replace(/\r\n?/g, "\n").trim().slice(0, MAX_TEXT),
      body_html: mail.html && String(mail.html).length <= MAX_HTML ? String(mail.html) : null,
      message_id: c.messageId, in_reply_to: c.inReplyTo, references_ids: refs.length ? refs : null, sent_by: user, created_at: when.toISOString(),
    });
    if (error) { if (/duplicate/i.test(error.message)) stats.duplicates++; else item.error = error.message; continue; }
    stats.filed++;
    // Reclassify: answered, so it's waiting on the family; and it's his now if nobody had it.
    const { data: inq } = await sb.from("site_inquiries").select("status, assigned_to, last_message_at").eq("id", inqId).maybeSingle();
    if (!inq) continue;
    const patch = {};
    if (inq.status === "new" || inq.status === "open") patch.status = "waiting";
    if (!inq.assigned_to) { patch.assigned_to = canonicalDirectorEmail(user); patch.assigned_at = new Date().toISOString(); }
    if (!inq.last_message_at || when.toISOString() > inq.last_message_at) patch.last_message_at = when.toISOString();
    if (Object.keys(patch).length) await sb.from("site_inquiries").update(patch).eq("id", inqId);
  }
}
