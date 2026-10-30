// The email assistant's API (api/_lib/mail-assistant.js).
//
//   GET  (Vercel Cron every 5 minutes, Bearer CRON_SECRET; also ?token=)   check both mailboxes
//   POST { action, ... } with Drew's Supabase token (owners only - it's his mail):
//     status                       Google ready?, each mailbox, the last 30 emails looked at
//     connect_url { email }        Google's sign-in page for that mailbox
//     toggle { email, enabled }    pause / resume a mailbox
//     disconnect { email }         forget its token
//     poll                         check now
//     save_slack { bot_token?, signing_secret? }   the "DSSC Mail" Slack app (blank = remove)
//     test_slack                   a DM from whichever Slack app email uses
//     digest_now                   send the email roundup now (it also goes at 8am and 5pm CT)

import { createClient } from "@supabase/supabase-js";
import { pollAll, authUrl, googleReady, redirectUri, ACCOUNTS, isOwner, mailSlackCfg, saveMailSlack, testMailSlack, sendDigest, DIGEST_HOURS, cleanupAll } from "./_lib/mail-assistant.js";

export const config = { maxDuration: 300 };
const fail = (status, msg) => Object.assign(new Error(msg), { status });

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET } = process.env;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    if (req.method === "GET") {
      const url = new URL(req.url, "http://x");
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") || url.searchParams.get("token") || "";
      if (!CRON_SECRET || token !== CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });
      // The one-time inbox cleanup and its recheck run on their own (?job=cleanup,
      // two minutes after the mail run): drafting new mail can take most of a run.
      if (url.searchParams.get("job") === "cleanup") {
        const cleanup = await cleanupAll(sb, { deadline: Date.now() + 240e3 }).catch(e => ({ error: e.message }));
        return res.status(200).json({ ok: true, cleanup });
      }
      const accounts = await pollAll(sb);
      // The twice-a-day roundup rides on the same 5-minute run.
      const digest = await sendDigest(sb).catch(e => ({ error: e.message }));
      return res.status(200).json({ ok: true, accounts, digest });
    }
    if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ error: "GET or POST" }); }
    const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const { data: { user } = {} } = bearer ? await sb.auth.getUser(bearer).catch(() => ({ data: {} })) : { data: {} };
    if (!user?.email) return res.status(401).json({ error: "Sign in first" });
    if (!isOwner(user.email)) return res.status(403).json({ error: "The email assistant is Drew's" });
    let b = req.body;
    if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
    return res.status(200).json({ ok: true, ...(await run(sb, user.email, b || {})) });
  } catch (e) {
    console.error("mail-assistant", e);
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

const okAccount = (e) => { const x = String(e || "").trim().toLowerCase(); if (!ACCOUNTS.includes(x)) throw fail(400, "Not one of the assistant's mailboxes"); return x; };

export async function run(sb, me, b) {
  switch (b.action) {
    case "status": {
      const { data: accts, error } = await sb.from("mail_accounts").select("email, enabled, connected_at, connected_by, last_poll_at, last_error, refresh_token");
      if (error) throw fail(500, /mail_accounts|schema cache/.test(error.message) ? "Run migrations/20261112_mail_assistant.sql first" : error.message);
      const { data: recent } = await sb.from("mail_drafts").select("id, account, from_email, from_name, subject, received_at, status, reason, decided_by, decided_at, created_at").order("created_at", { ascending: false }).limit(30);
      const sl = await mailSlackCfg(sb);
      const dg = (await sb.from("hq_kv").select("value").eq("key", "mail_digest").maybeSingle()).data?.value || {};
      const { data: cl } = await sb.from("hq_kv").select("key, value").like("key", "mail_cleanup:%");
      return {
        cleanup: Object.fromEntries((cl || []).map(r => [r.key.replace("mail_cleanup:", ""), r.value])),
        digest: { hours: dg.hours || DIGEST_HOURS, last_at: dg.last_at || null },
        slack: { app: sl.app, connected: !!sl.bot_token, signing: !!sl.signing_secret, team: sl.team || null, url: "https://dseliteevals.vercel.app/api/mail-slack" },
        google_ready: ACCOUNTS.some(e => googleReady(e)), redirect_uri: redirectUri(),
        accounts: ACCOUNTS.map(e => { const a = (accts || []).find(x => x.email === e); return { email: e, google_ready: googleReady(e), connected: !!a?.refresh_token, enabled: a ? a.enabled : false, connected_at: a?.connected_at || null, last_poll_at: a?.last_poll_at || null, last_error: a?.last_error || null }; }),
        recent: recent || [],
      };
    }
    case "connect_url": return { url: authUrl(okAccount(b.email), me) };
    case "toggle": { await sb.from("mail_accounts").update({ enabled: !!b.enabled, updated_at: new Date().toISOString() }).eq("email", okAccount(b.email)); return {}; }
    case "disconnect": { await sb.from("mail_accounts").update({ refresh_token: null, enabled: false, updated_at: new Date().toISOString() }).eq("email", okAccount(b.email)); return {}; }
    case "poll": return { accounts: await pollAll(sb) };
    case "save_slack": return { slack: await saveMailSlack(sb, { bot_token: b.bot_token, signing_secret: b.signing_secret }, me) };
    case "test_slack": return await testMailSlack(sb);
    case "digest_now": return { digest: await sendDigest(sb, { force: true }) };
    case "cleanup": {   // start (or restart) the one-time inbox cleanup for both mailboxes
      for (const e of ACCOUNTS) await sb.from("hq_kv").upsert({ key: "mail_cleanup:" + e, value: { requested: true, by: me }, secret: true, updated_at: new Date().toISOString(), updated_by: me }, { onConflict: "key" });
      return {};
    }
    default: throw fail(400, "Unknown action");
  }
}
