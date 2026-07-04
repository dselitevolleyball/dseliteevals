// Vercel Cron function: poll the DS Elite "house" mailbox for SportsYou posts.
//
// The house account (e.g. sportyou@dselitevolleyball.com) is a member of every
// SportsYou team, so every team post emails it. This job logs into that mailbox
// over IMAP, reads unseen emails from SportsYou, parses them (shared parser),
// stores them in sportsyou_posts, and marks them read. Runs on a schedule
// (see vercel.json "crons"); can also be pinged by an external cron.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; we also accept
// ?token=<CRON_SECRET>.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  - required.
//   CRON_SECRET                              - required; protects the endpoint.
//   GMAIL_USER                               - required; the house mailbox address.
//   GMAIL_APP_PASSWORD                       - required; a Google App Password (needs 2FA).
//   SPORTSYOU_IMAP_HOST                      - optional; default imap.gmail.com.
//   SPORTSYOU_FROM_MATCH                     - optional; sender substring to match, default "sportsyou".
//   SPORTSYOU_MAX_FETCH                      - optional; max emails per run, default 25.

import { createClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { parseSportsYouEmail } from "./_lib/sportsyou-parse.js";

const MAX_RAW = 100_000;

export default async function handler(req, res) {
  const {
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
    GMAIL_USER, GMAIL_APP_PASSWORD, SPORTSYOU_IMAP_HOST,
    SPORTSYOU_FROM_MATCH, SPORTSYOU_MAX_FETCH,
  } = process.env;

  // Auth.
  const urlToken = (() => { try { return new URL(req.url, "https://x").searchParams.get("token") || ""; } catch { return ""; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (bearer !== CRON_SECRET && urlToken !== CRON_SECRET)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return res.status(500).json({ error: "IMAP not configured (set GMAIL_USER and GMAIL_APP_PASSWORD)" });

  const host = SPORTSYOU_IMAP_HOST || "imap.gmail.com";
  const fromMatch = (SPORTSYOU_FROM_MATCH || "sportsyou").trim();
  const maxFetch = Math.min(200, Math.max(1, parseInt(SPORTSYOU_MAX_FETCH || "25", 10) || 25));

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let teamNames = [];
  try {
    const { data: teams } = await supabase.from("practice_teams").select("team_name");
    teamNames = (teams || []).map(t => t.team_name).filter(Boolean);
  } catch { /* team stays null, parsed_ok false */ }

  const client = new ImapFlow({
    host, port: 993, secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    logger: false,
  });

  const stats = { scanned: 0, inserted: 0, duplicates: 0, matched: 0, errors: [] };

  try {
    await client.connect();
  } catch (e) {
    // Surface the real reason so we can tell auth failure from a connection problem.
    const detail = e.authenticationFailed
      ? "authentication failed — check GMAIL_APP_PASSWORD (must be a Google App Password, no typos), that 2-Step Verification is ON, and that IMAP is enabled for the account"
      : (e.responseText || e.response || e.message || "unknown");
    console.error("IMAP connect failed:", e);
    return res.status(502).json({
      error: "IMAP connect failed",
      detail,
      authFailed: !!e.authenticationFailed,
      code: e.code || null,
      host,
      user: GMAIL_USER,
    });
  }

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Only unseen mail from SportsYou — never touches the account's other mail.
      let uids = await client.search({ seen: false, from: fromMatch }, { uid: true });
      if (!Array.isArray(uids)) uids = [];
      const take = uids.slice(-maxFetch); // newest N
      stats.scanned = take.length;

      for (const uid of take) {
        try {
          const msg = await client.fetchOne(uid, { source: true }, { uid: true });
          if (!msg || !msg.source) continue;
          const mail = await simpleParser(msg.source);

          const parsed = parseSportsYouEmail({
            from: mail.from?.text || "",
            subject: mail.subject || "",
            text: mail.text || "",
            html: mail.html || mail.textAsHtml || "",
            date: mail.date || null,
            messageId: mail.messageId || "",
          }, teamNames);

          // Team invitations / system notices aren't coach posts — skip, but
          // still mark read so we don't re-fetch them every run.
          if (parsed.isInvitation) {
            await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
            continue;
          }

          const raw = JSON.stringify({
            via: "imap", from: mail.from?.text || "", subject: mail.subject || "",
            date: mail.date || null, messageId: mail.messageId || "", text: mail.text || "",
          }).slice(0, MAX_RAW);

          const row = {
            source: "sportsyou",
            team_name: parsed.team,
            raw_team_label: parsed.subject || null,
            author: parsed.author,
            author_role: parsed.authorRole,
            subject: parsed.subject || null,
            body: parsed.body || null,
            from_email: parsed.fromEmail || null,
            posted_at: parsed.postedAt || (mail.date ? new Date(mail.date).toISOString() : new Date().toISOString()),
            message_id: parsed.messageId,
            raw_email: raw,
            parsed_ok: !!parsed.team,
          };

          const ins = await supabase.from("sportsyou_posts").insert(row).select("id").single();
          if (ins.error) {
            if (/duplicate key/i.test(ins.error.message || "")) {
              stats.duplicates++;               // already stored — safe to mark read
            } else {
              stats.errors.push(ins.error.message);
              continue;                         // real error — leave unread so we retry next run
            }
          } else {
            stats.inserted++;
            if (parsed.team) stats.matched++;
          }
          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
        } catch (e) {
          stats.errors.push(e.message);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }

  return res.status(200).json({
    ok: true,
    scanned: stats.scanned, inserted: stats.inserted,
    duplicates: stats.duplicates, matched: stats.matched,
    errors: stats.errors.slice(0, 5),
  });
}
