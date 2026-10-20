// Vercel Cron: read mail sent to info@drippingsportsclub.com into the shared
// inbox (every 15 min, vercel.json "crons"; pattern: api/sportsyou-poll.js).
//
// Logs into the mailbox that receives info@ over IMAP, takes the recent mail
// addressed to info@ that it hasn't handled yet, and lands each message on a
// thread in site_inquiries / site_inbox_messages:
//   (a) In-Reply-To / References name a message we sent or stored  -> that thread
//   (b) else the sender's newest thread that isn't done (90 days)   -> that thread
//   (c) else a new thread (site 'dssc', kind 'email')
// A family writing back re-opens a waiting/done thread (status -> 'new'), and
// the assigned director (or the routed ones) gets a short email with a link.
// Mail from our own addresses to info@ (a director CC'ing the inbox while
// answering from Gmail) is kept as that thread's 'out' message, so the
// history stays whole. Nothing else in the mailbox is touched.
//
// Handled mail is flagged with the IMAP keyword $DSSCInbox (and marked \Seen
// unless DSSC_INBOX_MARK_SEEN=0), so the poller works even when the mailbox
// is Drew's own and he has already read the message on his phone. Message-IDs
// are unique in the table, so a re-read never duplicates.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; ?token=<CRON_SECRET>
// also works. ?dry=1 reports what would happen without writing or flagging.
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET     required
//   DSSC_INBOX_IMAP_USER, DSSC_INBOX_IMAP_PASSWORD           required: the mailbox login
//                                                            (Google: an App Password, needs 2-Step Verification)
//   DSSC_INBOX_IMAP_HOST                                     optional, default imap.gmail.com
//   DSSC_INBOX_MATCH_TO                                      optional, default info@drippingsportsclub.com (comma list ok)
//   DSSC_INBOX_MAX_FETCH                                     optional, default 25 per run
//   DSSC_INBOX_SINCE_DAYS                                    optional, default 14 (how far back to look)
//   DSSC_INBOX_MARK_SEEN                                     optional, default 1
//   RESEND_API_KEY, DSSC_FROM_EMAIL (fallback DSE_FROM_EMAIL) for the director notification

import { createClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { nrm, isEmailish, isOurAddress, isDirectorEmail, canonicalDirectorEmail, directorName, inboxAddress, notifyDirectors, stripQuoted } from "./_lib/site-inbox.js";

export const config = { maxDuration: 60 };

const KEYWORD = "$DSSCInbox";
const MAX_TEXT = 60_000, MAX_HTML = 200_000;
const ADDR_RE = /[^\s<>,;"'()]+@[^\s<>,;"'()]+\.[a-z]{2,}/gi;

const addressesIn = (v) => {
  const out = [];
  const walk = (x) => {
    if (!x) return;
    if (Array.isArray(x)) return x.forEach(walk);
    if (typeof x === "string") { for (const m of x.match(ADDR_RE) || []) out.push(nrm(m)); return; }
    if (Array.isArray(x.value)) return x.value.forEach(a => { if (a.address) out.push(nrm(a.address)); if (Array.isArray(a.group)) walk(a.group); });
    if (x.address) out.push(nrm(x.address));
    if (x.text) walk(x.text);
  };
  walk(v);
  return out;
};
const msgIds = (v) => (Array.isArray(v) ? v : String(v || "").split(/\s+/)).map(s => String(s || "").trim()).filter(s => /^<.+>$/.test(s));
const localPart = (id) => String(id || "").replace(/^<|>$/g, "").split("@")[0];

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, DSSC_INBOX_IMAP_USER, DSSC_INBOX_IMAP_PASSWORD, DSSC_INBOX_IMAP_HOST } = process.env;
  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const urlToken = url?.searchParams.get("token") || "";
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (bearer !== CRON_SECRET && urlToken !== CRON_SECRET)) return res.status(403).json({ error: "Forbidden" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  if (!DSSC_INBOX_IMAP_USER || !DSSC_INBOX_IMAP_PASSWORD) return res.status(500).json({ error: "IMAP not configured (set DSSC_INBOX_IMAP_USER and DSSC_INBOX_IMAP_PASSWORD)" });

  const dry = /^(1|true|yes)$/i.test(url?.searchParams.get("dry") || "");
  const host = DSSC_INBOX_IMAP_HOST || "imap.gmail.com";
  const matchTo = [...new Set(String(process.env.DSSC_INBOX_MATCH_TO || inboxAddress()).split(/[,\s;]+/).map(nrm).filter(isEmailish))];
  if (!matchTo.length) matchTo.push(inboxAddress());
  const maxFetch = Math.min(100, Math.max(1, parseInt(process.env.DSSC_INBOX_MAX_FETCH || "25", 10) || 25));
  const sinceDays = Math.min(90, Math.max(1, parseInt(process.env.DSSC_INBOX_SINCE_DAYS || "14", 10) || 14));
  const markSeen = !/^(0|false|no)$/i.test(String(process.env.DSSC_INBOX_MARK_SEEN || "1"));

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const client = new ImapFlow({ host, port: 993, secure: true, auth: { user: DSSC_INBOX_IMAP_USER, pass: DSSC_INBOX_IMAP_PASSWORD }, logger: false });
  const stats = { scanned: 0, stored: 0, newThreads: 0, replies: 0, outbound: 0, duplicates: 0, skipped: 0, notified: 0, errors: [], items: [] };

  try { await client.connect(); }
  catch (e) {
    const detail = e.authenticationFailed
      ? "authentication failed — check DSSC_INBOX_IMAP_PASSWORD (a Google App Password, 2-Step Verification on, IMAP enabled for the account)"
      : (e.responseText || e.response || e.message || "unknown");
    console.error("site-inbox-poll connect", e);
    return res.status(502).json({ error: "IMAP connect failed", detail, authFailed: !!e.authenticationFailed, host, user: DSSC_INBOX_IMAP_USER });
  }

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const canKeyword = !!(client.mailbox && client.mailbox.permanentFlags && client.mailbox.permanentFlags.has("\\*"));
      const since = new Date(Date.now() - sinceDays * 86400000);
      const or = matchTo.flatMap(a => [{ to: a }, { cc: a }, { header: { "delivered-to": a } }]);
      const criteria = { since, or, ...(canKeyword ? { unKeyword: KEYWORD } : { seen: false }) };
      let uids = await client.search(criteria, { uid: true });
      if (!Array.isArray(uids)) uids = [];
      const take = uids.slice(-maxFetch);
      stats.scanned = take.length;
      stats.mode = canKeyword ? "keyword" : "unseen";

      const flagDone = async (uid, seen) => {
        if (dry) return;
        const flags = [...(canKeyword ? [KEYWORD] : []), ...(seen && markSeen ? ["\\Seen"] : [])];
        if (!flags.length) return;
        try { await client.messageFlagsAdd(uid, flags, { uid: true }); }
        catch (e) { if (canKeyword && seen && markSeen) await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true }).catch(() => {}); else throw e; }
      };

      for (const uid of take) {
        try {
          const fetched = await client.fetchOne(uid, { source: true }, { uid: true });
          if (!fetched || !fetched.source) continue;
          const mail = await simpleParser(fetched.source);
          const messageId = String(mail.messageId || "").trim() || null;
          const fromAddr = nrm(mail.from?.value?.[0]?.address);
          const fromName = String(mail.from?.value?.[0]?.name || "").trim();
          const recipients = [...new Set([...addressesIn(mail.to), ...addressesIn(mail.cc), ...addressesIn(mail.bcc), ...["delivered-to", "x-original-to", "envelope-to", "x-forwarded-to", "x-forwarded-for"].flatMap(h => addressesIn(mail.headers.get(h)))])];
          const hit = recipients.find(a => matchTo.includes(a));
          const subject = String(mail.subject || "").trim().slice(0, 300);
          const auto = /^(auto-(replied|generated|notified))$/i.test(String(mail.headers.get("auto-submitted") || "")) || /^(bulk|auto_reply|junk)$/i.test(String(mail.headers.get("precedence") || "")) || /^(auto|automatic)/i.test(String(mail.headers.get("x-autoreply") || ""));
          const item = { uid, from: fromAddr, subject, hit: hit || null };

          // Not for info@, or a machine talking: not ours to track.
          if (!hit || !fromAddr || auto || /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/i.test(fromAddr)) {
            stats.skipped++; item.action = !hit ? "skip:not-to-inbox" : auto ? "skip:auto" : "skip:system"; stats.items.push(item);
            await flagDone(uid, false);
            continue;
          }
          if (messageId) {
            const { data: dup } = await sb.from("site_inbox_messages").select("id, inquiry_id").eq("message_id", messageId).limit(1);
            if (dup && dup.length) { stats.duplicates++; item.action = "duplicate"; item.inquiry_id = dup[0].inquiry_id; stats.items.push(item); await flagDone(uid, true); continue; }
          }

          const inReplyTo = msgIds(mail.inReplyTo)[0] || null;
          const refs = [...new Set([...msgIds(mail.references), ...(inReplyTo ? [inReplyTo] : [])])];
          const text = String(mail.text || "").replace(/\r\n?/g, "\n").trim().slice(0, MAX_TEXT);
          const html = mail.html && String(mail.html).length <= MAX_HTML ? String(mail.html) : null;
          const when = mail.date instanceof Date && !isNaN(mail.date) ? mail.date : new Date();

          // (a) a reply to something in a thread we know.
          let inq = null;
          if (refs.length) {
            const { data: byId } = await sb.from("site_inbox_messages").select("inquiry_id, created_at").in("message_id", refs).order("created_at", { ascending: false }).limit(1);
            let hitRow = byId && byId[0];
            if (!hitRow) {
              const locals = refs.map(localPart).filter(Boolean);
              const { data: byProv } = locals.length ? await sb.from("site_inbox_messages").select("inquiry_id, created_at").in("provider_id", locals).order("created_at", { ascending: false }).limit(1) : { data: null };
              hitRow = byProv && byProv[0];
            }
            if (hitRow) { const { data } = await sb.from("site_inquiries").select("*").eq("id", hitRow.inquiry_id).maybeSingle(); inq = data || null; }
          }
          const ours = isOurAddress(fromAddr);

          if (ours) {
            // A director answered from their own mail and copied info@: keep it
            // on the thread as the reply it is. Without a thread (or when it's
            // the club mailing itself) there is nothing to track.
            if (!inq) {
              const family = recipients.find(a => !matchTo.includes(a) && !isOurAddress(a));
              if (family) { const { data } = await sb.from("site_inquiries").select("*").ilike("email", family).neq("status", "done").eq("is_test", false).order("last_message_at", { ascending: false }).limit(1); inq = data && data[0] || null; }
            }
            if (!inq || !isDirectorEmail(fromAddr)) { stats.skipped++; item.action = "skip:own-mail"; stats.items.push(item); await flagDone(uid, false); continue; }
            item.action = "outbound"; item.inquiry_id = inq.id; stats.items.push(item);
            if (dry) continue;
            const { error } = await sb.from("site_inbox_messages").insert({ inquiry_id: inq.id, direction: "out", from_name: fromName || directorName(fromAddr), from_email: fromAddr, to_email: recipients.find(a => a === nrm(inq.email)) || inq.email, subject, body_text: text, body_html: html, message_id: messageId, in_reply_to: inReplyTo, references_ids: refs.length ? refs : null, sent_by: fromAddr, created_at: when.toISOString() });
            if (error) { if (/duplicate key/i.test(error.message)) { stats.duplicates++; await flagDone(uid, true); } else stats.errors.push(error.message); continue; }
            const patch = { last_message_at: new Date().toISOString() };
            if (inq.status === "new" || inq.status === "open") patch.status = "waiting";
            if (!inq.assigned_to) { patch.assigned_to = canonicalDirectorEmail(fromAddr); patch.assigned_at = new Date().toISOString(); }
            await sb.from("site_inquiries").update(patch).eq("id", inq.id);
            stats.stored++; stats.outbound++;
            await flagDone(uid, true);
            continue;
          }

          // (b) the sender's newest open thread.
          if (!inq) {
            const { data } = await sb.from("site_inquiries").select("*").ilike("email", fromAddr).neq("status", "done").eq("is_test", false).gte("created_at", new Date(Date.now() - 90 * 86400000).toISOString()).order("last_message_at", { ascending: false }).limit(1);
            inq = data && data[0] || null;
          }
          // (c) a new thread.
          let created = false;
          if (!inq) {
            if (dry) { item.action = "new-thread"; stats.items.push(item); continue; }
            const name = (fromName || fromAddr.split("@")[0].replace(/[._-]+/g, " ")).slice(0, 120);
            const { data, error } = await sb.from("site_inquiries").insert({
              site: "dssc", kind: "email", topic: "email", sport: null, details: subject ? { subject } : {}, name, email: fromAddr, message: stripQuoted(text).slice(0, 5000),
              status: "new", is_test: false, last_message_at: new Date().toISOString(),
            }).select("*").single();
            if (error) { stats.errors.push(error.message); continue; }
            inq = data; created = true;
          }
          item.action = created ? "new-thread" : "reply"; item.inquiry_id = inq.id; stats.items.push(item);
          if (dry) continue;

          const { data: row, error: mErr } = await sb.from("site_inbox_messages").insert({
            inquiry_id: inq.id, direction: "in", from_name: fromName || null, from_email: fromAddr, to_email: hit, subject,
            body_text: text, body_html: html, message_id: messageId, in_reply_to: inReplyTo, references_ids: refs.length ? refs : null, created_at: when.toISOString(),
          }).select("*").single();
          if (mErr) { if (/duplicate key/i.test(mErr.message)) { stats.duplicates++; await flagDone(uid, true); } else stats.errors.push(mErr.message); continue; }

          // A family writing back re-opens the thread.
          const patch = { last_message_at: new Date().toISOString() };
          if (!created && (inq.status === "waiting" || inq.status === "done")) { patch.status = "new"; }
          await sb.from("site_inquiries").update(patch).eq("id", inq.id);
          stats.stored++; if (created) stats.newThreads++; else stats.replies++;
          await flagDone(uid, true);

          const fresh = { ...inq, ...patch };
          if (await notifyDirectors(fresh, row, { reason: created ? "new" : "reply" })) { stats.notified++; if (created) await sb.from("site_inquiries").update({ emailed_at: new Date().toISOString() }).eq("id", inq.id); }
        } catch (e) {
          stats.errors.push(`uid ${uid}: ${e.message}`);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }

  return res.status(200).json({ ok: true, dry, matchTo, ...stats, errors: stats.errors.slice(0, 8), items: stats.items.slice(0, 50) });
}
