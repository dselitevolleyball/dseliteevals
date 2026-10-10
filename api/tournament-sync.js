// Tournament Hub sync — every 5 minutes (Vercel Cron). Finds which AES / OTTO
// event each DS Elite team's games are on, keeps tournament_feeds and
// tournament_team_feed (one normalized snapshot per team) current, and pushes
// "next match / result / pool finish" alerts to the parents and coaches
// following the team. All the logic is runSync() in
// api/_lib/tournament-sync-core.js; this is the HTTP wrapper.
//
// Most runs do almost nothing: no tournament in the window (start - 10 days
// .. end + 1) means one query. Pre-week, a tournament is searched every 6 h
// (hourly in the last 3 days) and its feeds checked hourly; on event days
// every published feed is checked every run, and a team is re-fetched only
// when AES's timestamp / its own standings row says something moved.
//
//   GET                         the cron run
//   ?dry=1                      no writes, no alerts — returns what it would do
//   ?tournament=<id>            only that tournament (ignores the window and
//                               the poll cadence; discovery still on its own clock)
//   ?discover=1                 search the platforms now, whatever the clock says
//   ?alerts=0                   write snapshots but send no alerts
//   ?window=<days>              look further ahead than 10 days (operator testing)
//   ?test=aes:<key>:<clubId>    fetch + normalize another club's event and return
//   ?test=otto:<eswId>:<ids>    its snapshots — no database at all; proves this
//   [&tz=America/Phoenix]       deployment can reach both platforms
//
// Auth: Vercel Cron `Authorization: Bearer <CRON_SECRET>` (or ?token=), the
// service-role key as bearer (operator scripts), or a signed-in owner /
// approved admin (Supabase session bearer).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (opt).
// vercel.json: cron "*/5 * * * *", functions maxDuration 120 (also set below).

import { createClient } from "@supabase/supabase-js";
import { runSync, testFeed, authCaller } from "./_lib/tournament-sync-core.js";

export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const q = (k) => url?.searchParams.get(k) ?? null;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  res.setHeader("Cache-Control", "no-store");

  const auth = await authCaller(sb, req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  if (q("test")) {
    try { return res.status(200).json(await testFeed(q("test"), { tz: q("tz") || null })); }
    catch (e) { return res.status(e.status || 502).json({ ok: false, error: e.message }); }
  }

  const tid = q("tournament");
  if (tid != null && !/^\d+$/.test(tid)) return res.status(400).json({ error: "tournament must be a number" });
  const win = q("window");
  const opts = {
    dry: q("dry") === "1",
    tournamentId: tid != null ? Number(tid) : null,
    discover: q("discover") === "1",
    alerts: q("alerts") !== "0",
    windowDays: win != null && /^\d+$/.test(win) ? Math.min(120, Number(win)) : undefined,
  };
  try {
    const out = await runSync(sb, opts);
    out.by = auth.who;
    return res.status(200).json(out);
  } catch (e) {
    console.error("tournament-sync:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
