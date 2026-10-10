// Tournament Hub — fix where a tournament's games come from, by hand (the
// HQ "Tournament Hub" view's link box, Sync now and unlink buttons).
//
// Discovery (api/tournament-sync.js) finds most events on its own, but some
// can't be found automatically — a director who posts under a name nobody
// would match, an event on the "wrong" platform, a Rise team AES knows by a
// different name — so an admin can paste the link.
//
//   POST { action:'link', tournament_id, url, teams?:[team names] }
//        url: an AES results link (results.advancedeventsystems.com/event/{key}/...),
//        an AES event page (advancedeventsystems.com/{eventId} or /events/{eventId}),
//        an OTTO link (events.ottoevent.ai/event/{id}, eventslegacy.ottoevent.ai/#/events/{eswId}),
//        or a bare id ("aes:46756" / "otto:27123" when a number could be either).
//        The feed is saved linked_by 'manual'; the teams going that it lists
//        (or exactly `teams`) move onto it and discovery never moves them off.
//        Then this tournament is synced. → { feed, mapped, not_found, not_going, sync, feeds, rows }
//   POST { action:'unlink', tournament_id, feed_id }  → its teams lose the mapping
//        and snapshot and the feed row is deleted. → { removed, feeds, rows }
//   POST { action:'sync', tournament_id }              → search + poll that
//        tournament now (alerts on, same rules as the cron). → { sync, feeds, rows }
//
// Auth: a signed-in owner (drew@dselitevolleyball.com, drew@drippingsportsclub.com)
// or approved admin — Supabase session bearer; the service-role key as bearer
// also works (operator scripts).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (alerts).
// vercel.json: functions maxDuration 120 (also set below) — a link runs a sync.

import { createClient } from "@supabase/supabase-js";
import { authCaller, linkFeed, unlinkFeed, syncTournament } from "./_lib/tournament-sync-core.js";

export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).json({ error: "POST only" }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  res.setHeader("Cache-Control", "no-store");

  const auth = await authCaller(sb, req, { cron: false });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  let body = req.body;
  try { body = typeof body === "string" ? JSON.parse(body || "{}") : (body || {}); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  const tid = Number(body.tournament_id);
  if (!Number.isInteger(tid) || tid <= 0) return res.status(400).json({ error: "tournament_id is required" });

  try {
    if (body.action === "link") {
      if (!body.url) return res.status(400).json({ error: "Paste the AES or OTTO link." });
      const teams = Array.isArray(body.teams) ? body.teams.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim()) : null;
      return res.status(200).json(await linkFeed(sb, { tournamentId: tid, url: String(body.url), teams }));
    }
    if (body.action === "unlink") {
      if (!Number.isInteger(Number(body.feed_id))) return res.status(400).json({ error: "feed_id is required" });
      return res.status(200).json(await unlinkFeed(sb, { tournamentId: tid, feedId: Number(body.feed_id) }));
    }
    if (body.action === "sync") return res.status(200).json(await syncTournament(sb, { tournamentId: tid }));
    return res.status(400).json({ error: "action must be link, unlink or sync" });
  } catch (e) {
    if (!e.status || e.status >= 500) console.error("tournament-feed:", body.action, e);
    return res.status(e.status || 502).json({ error: e.message });
  }
}
