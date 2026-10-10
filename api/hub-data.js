// Tournament Hub — the data behind the public /hub page (JSON, no login).
//
//   GET /api/hub-data                       club home: every team, this weekend's
//                                           tournaments, each playing team's NEXT
//   GET /api/hub-data?team=14-diamond       one team: full snapshots for its
//                                           tournaments this weekend + its season list
//   GET /api/hub-data?demo=aes:<key>:<clubId>[&team=<slug>][&tz=<IANA>]
//   GET /api/hub-data?demo=otto:<eswId>:<teamId,teamId>[&team=<slug>]
//                                           another club's live event, fetched from the
//                                           platform right now and normalized the same
//                                           way — no database at all. This is how Drew
//                                           sees the hub with real data before DS Elite's
//                                           first published event (~Dec 5 2026).
//
// Drew, 10 Oct 2026: "an easy way for parents, coaches and directors to see who
// they are playing and when, in real time during the week leading up and during
// the tournament ... a great way to introduce the app to parents." So this is
// public: anyone with the link sees team names, opponents (other clubs' team
// names, already public on AES/OTTO), courts, times and scores. Never rosters,
// players' names, coaches, notes, costs or anything else on the tournament row —
// every select below names its columns for that reason.
//
// Shape (one fetch per page refresh; api/hub.js also embeds it in the HTML so
// the first paint needs no fetch at all):
//   { ok, mode: 'home'|'team'|'demo', generated_at, now_central,
//     demo: null | { platform, param, club, event_name },
//     team: null | { name, slug, level, group },          // ?team=
//     not_found: null | slug,                              // ?team= that isn't a public team (404)
//     teams: [{ name, slug, level, group }],               // group: National | Regional | Rise (demo: division)
//     tournaments: [{ id, name, start, end, location, venue, tz, now_local, today,
//                     status, status_text, live_today, teams: [names], posts_hint,
//                     weekend: 'this'|'next'|'later',     // by the coming Sunday (Central); demo: absent
//                     feeds: [{ platform, event_name, published, url }] }],   // the next 10 days (team: its own)
//     snapshots: { [team]: [{ tournament_id, platform, synced_at, checked_at, feed_url, snapshot }] },
//     upcoming: { [team]: [{ id, name, start, end, location, venue, tentative, posts_hint }] },
//     next_up: null | { start, tournaments: [...] } }      // home, when nothing is on this weekend
// snapshot is a TeamSnapshot (shared/tournament-feed.js) with `next` recomputed
// at the venue's wall clock (withNext). On the home page it is "lite": no
// match/work lists, just next, record, pool, last_pool, finish and the last result — the
// My teams cards need nothing more and the payload stays small with 20 teams.
//
// Which tournaments: not cancelled, with at least one counted assignment
// (status not dropped / need_to_drop), and start − 10 days ≤ today ≤ end + 1
// (Central date) — the same window api/tournament-sync.js polls. Event teams
// (14 Crystal, shared/event-teams.js) never appear here.
//
// Cache: public, s-maxage=30, stale-while-revalidate=60 (demo: s-maxage=60) —
// a gym full of parents refreshing hits Vercel's CDN, not Supabase or AES.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (not needed for ?demo=).

import { createClient } from "@supabase/supabase-js";
import { isEventTeam } from "../shared/event-teams.js";
import {
  tzForTournament, localNow, withNext, aesTeamSnapshot, ottoTeamSnapshot, aesPoolPlayId, aesDecodeKey,
} from "../shared/tournament-feed.js";
import {
  aesEvent, aesLanding, aesTimestamp, aesStandings, aesNext, aesTeamHeader, aesTeamSchedule, aesPoolsheet,
  aesEventUrl, aesTeamUrl, ottoEventEsw, ottoFavoriteTeams, ottoDivisionPools, ottoEventUrl, ottoTeamUrl,
} from "./_lib/tournament-sources.js";

// "14 Diamond" → "14-diamond" (the contract's slug: lowercased, spaces → '-').
// Anything else non-alphanumeric is dropped so a demo club's "Aspire 17 Iron
// Man/Thor" still makes a clean URL.
export const slugOf = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]+/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");

// practice_teams.level → the home page's groups. Developmental is what the
// club calls Rise (11/12/13 Rise 1).
const groupOf = (level, name) => (/rise/i.test(name || "") || /develop/i.test(level || "") ? "Rise" : /national/i.test(level || "") ? "National" : "Regional");
const GROUP_ORDER = { National: 0, Regional: 1, Rise: 2 };
const byName = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

const ymd = (d) => String(d || "").slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(ymd(d) + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const centralToday = () => localNow("America/Chicago").slice(0, 10);
const NOT_COUNTED = new Set(["dropped", "need_to_drop"]);
const ENTERED = new Set(["registered", "accepted", "rostered"]);

// When a schedule is likely to show up: directors post the week of the event
// (the Orlando OTTO event said "8 PM Tuesday" before a Saturday; KY JV on AES
// was up 11 days early), so parents are told "~Monday of that week".
export function postsHint(start) {
  const s = ymd(start);
  if (!s) return null;
  const d = new Date(Date.parse(s + "T12:00:00Z") - 86400000);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86400000).toISOString().slice(0, 10);
}

const httpError = (status, message) => Object.assign(new Error(message), { status });

// The home page's version of a snapshot: what a My teams card shows.
function lite(s) {
  if (!s) return null;
  const finals = (s.matches || []).filter((m) => m.final);
  return {
    v: s.v, platform: s.platform, lite: true, event_name: s.event_name, event_url: s.event_url, team_url: s.team_url,
    division: s.division, record: s.record, pool: s.pool, last_pool: s.last_pool || null, finish: s.finish, next: s.next,
    last: finals.length ? finals[finals.length - 1] : null,
    n_matches: (s.matches || []).length, days: s.days, done: s.done, stamp: s.stamp,
  };
}

// A tournament's state for the "This weekend" card, judged at the venue's date.
//   not_posted  no team has a schedule yet           "Schedule not posted yet"
//   posted      schedule up, event not started        "Schedule posted"
//   today       event day, nothing posted (or found)  "Today"
//   live        event day with a schedule             "Live"
//   final       after the last day, or every team done "Final"
// OTTO's done is a guess that is also true between rounds (pool play over,
// crossovers not seeded yet), so an OTTO team counts as done early only with a
// finish place; otherwise the date rule decides and event days stay "live".
const finishedEarly = (s) => !!(s && (s.finish || (s.done && s.platform !== "otto")));
function tnStatus({ start, end, today, snaps, published, expected = snaps.length }) {
  const posted = published || snaps.some((s) => s && (s.matches?.length || s.n_matches || s.next?.play));
  const days = new Set(snaps.flatMap((s) => (s && Array.isArray(s.days) ? s.days : [])));
  const onDay = (today >= start && today <= end) || days.has(today);
  let status;
  // "Final" early only when every team going has a snapshot and is done.
  if (posted && snaps.length && snaps.length >= expected && snaps.every(finishedEarly)) status = "final";
  else if (today > end && !days.has(today) && ![...days].some((d) => d > today)) status = posted ? "final" : "over";
  else if (onDay) status = posted ? "live" : "today";
  else status = posted ? "posted" : "not_posted";
  const text = { not_posted: "Schedule not posted yet", posted: "Schedule posted", today: "Today", live: "Live", final: "Final", over: "Over" }[status];
  return { status, status_text: text, live_today: status === "live" };
}

const feedUrl = (f) => (!f || !f.event_key ? null : f.platform === "aes" ? aesEventUrl(f.event_key) : ottoEventUrl(f.event_key));
const maxIso = (...xs) => xs.filter(Boolean).sort().pop() || null;

// ---------------------------------------------------------------- club data (DB)

async function buildFromDb(sb, { team: teamSlug }) {
  const today = centralToday();
  const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data || []; };

  const [ptRes, tnRes] = await Promise.all([
    sb.from("practice_teams").select("team_name, level, practices_per_week"),
    // Three weeks back covers any event still running; the season list needs the rest.
    sb.from("tournaments").select("id, name, start_date, end_date, location, venue, time_zone, cancelled").gte("start_date", addDays(today, -21)).order("start_date"),
  ]);
  const teams = must(ptRes, "practice_teams").filter((t) => t.team_name && !isEventTeam(t))
    .map((t) => ({ name: t.team_name, slug: slugOf(t.team_name), level: t.level || null, group: groupOf(t.level, t.team_name) }))
    .sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || byName(a.name, b.name));
  const publicNames = new Set(teams.map((t) => t.name));

  const one = teamSlug ? teams.find((t) => t.slug === slugOf(teamSlug)) || null : null;
  const base = { ok: true, mode: teamSlug ? "team" : "home", generated_at: new Date().toISOString(), now_central: localNow("America/Chicago"), demo: null, team: one ? { ...one } : null, not_found: teamSlug && !one ? String(teamSlug).slice(0, 60) : null, teams };
  if (teamSlug && !one) return { ...base, tournaments: [], snapshots: {}, upcoming: {}, next_up: null };

  const tns = must(tnRes, "tournaments").filter((t) => !t.cancelled && t.start_date)
    .map((t) => ({ ...t, start: ymd(t.start_date), end: ymd(t.end_date || t.start_date) }))
    .filter((t) => t.end >= addDays(today, -1));
  const inWindow = (t) => t.start <= addDays(today, 10) && t.end >= addDays(today, -1);
  const winIds = tns.filter(inWindow).map((t) => t.id);
  // The window reaches into next week (it's the sync's window, and gives the
  // week-ahead "not posted yet" cards), so each tournament says which weekend
  // it belongs to: starts by the coming Sunday (today, on a Sunday) → "this".
  const sunday = addDays(today, (7 - new Date(Date.parse(today + "T12:00:00Z")).getUTCDay()) % 7);
  const weekendOf = (t) => (t.start <= sunday ? "this" : t.start <= addDays(sunday, 7) ? "next" : "later");

  const [asgRes, feedRes, rowRes] = await Promise.all([
    tns.length ? sb.from("tournament_assignments").select("tournament_id, team_id, status").in("tournament_id", tns.map((t) => t.id)) : { data: [] },
    // last_error is only read here (a failed check doesn't make data fresher), never sent.
    winIds.length ? sb.from("tournament_feeds").select("id, tournament_id, platform, event_key, event_name, published, last_checked_at, last_error").in("tournament_id", winIds) : { data: [] },
    winIds.length
      ? (one ? sb.from("tournament_team_feed").select("tournament_id, team_name, feed_id, snapshot, synced_at").in("tournament_id", winIds).eq("team_name", one.name)
             : sb.from("tournament_team_feed").select("tournament_id, team_name, feed_id, snapshot, synced_at").in("tournament_id", winIds))
      : { data: [] },
  ]);
  // tournament id → counted public team names (+ whether entered or still tentative)
  const counted = new Map();
  for (const a of must(asgRes, "tournament_assignments")) {
    if (NOT_COUNTED.has(a.status) || !publicNames.has(a.team_id)) continue;
    if (!counted.has(a.tournament_id)) counted.set(a.tournament_id, new Map());
    counted.get(a.tournament_id).set(a.team_id, a.status);
  }
  const feeds = must(feedRes, "tournament_feeds");
  const rows = must(rowRes, "tournament_team_feed").filter((r) => publicNames.has(r.team_name));

  const snapshots = {};
  const tournaments = [];
  for (const t of tns.filter((x) => inWindow(x) && counted.has(x.id))) {
    const names = [...counted.get(t.id).keys()].sort(byName);
    if (one && !names.includes(one.name)) continue;
    const tz = tzForTournament(t);
    const now = localNow(tz);
    const tFeeds = feeds.filter((f) => f.tournament_id === t.id);
    const tRows = rows.filter((r) => r.tournament_id === t.id && names.includes(r.team_name));
    const snaps = [];
    for (const r of tRows) {
      const f = tFeeds.find((x) => x.id === r.feed_id) || null;
      const snap = r.snapshot && r.snapshot.v ? withNext(r.snapshot, now) : null;
      if (snap) snaps.push(snap);
      (snapshots[r.team_name] ||= []).push({
        tournament_id: t.id, platform: snap?.platform || f?.platform || null,
        // The sync leaves synced_at alone while AES hasn't changed, so the feed's
        // last clean check counts too; one that hit an error doesn't (as HQ).
        synced_at: r.synced_at || null, checked_at: maxIso(r.synced_at, f && !f.last_error ? f.last_checked_at : null),
        feed_url: feedUrl(f), snapshot: one ? snap : lite(snap),
      });
    }
    tournaments.push({
      id: t.id, name: t.name, start: t.start, end: t.end, location: t.location || null, venue: (t.venue || "").trim() || null,
      tz, now_local: now, today: now.slice(0, 10), teams: names, posts_hint: postsHint(t.start), weekend: weekendOf(t),
      feeds: tFeeds.map((f) => ({ platform: f.platform, event_name: f.event_name || null, published: !!f.published, url: feedUrl(f) })),
      ...tnStatus({ start: t.start, end: t.end, today: now.slice(0, 10), snaps, expected: names.length, published: false }),
    });
  }
  // Live first, then by date.
  tournaments.sort((a, b) => (b.live_today ? 1 : 0) - (a.live_today ? 1 : 0) || a.start.localeCompare(b.start) || byName(a.name, b.name));

  // Season: each team's upcoming tournaments after this weekend's. The home page
  // only needs the first one per team ("Next: December Dash · Sat 12/5").
  const shown = new Set(tournaments.map((t) => t.id));
  const upcoming = {};
  for (const t of tns) {
    if (shown.has(t.id) || !counted.has(t.id) || t.end < today) continue;
    for (const [name, status] of counted.get(t.id)) {
      if (one && name !== one.name) continue;
      const list = (upcoming[name] ||= []);
      if (!one && list.length) continue;
      if (list.length >= 20) continue;
      list.push({ id: t.id, name: t.name, start: t.start, end: t.end, location: t.location || null, venue: (t.venue || "").trim() || null, tentative: !ENTERED.has(status), posts_hint: postsHint(t.start) });
    }
  }

  // Nothing on this weekend: tell the home page when the next tournament
  // weekend is and who's going (before Dec 5 that's every parent's question).
  let next_up = null;
  if (!one && !tournaments.length) {
    const fut = tns.filter((t) => counted.has(t.id) && t.start > today);
    if (fut.length) {
      const first = fut[0].start;
      const same = fut.filter((t) => t.start <= addDays(first, 2));
      next_up = { start: first, tournaments: same.map((t) => ({ id: t.id, name: t.name, start: t.start, end: t.end, location: t.location || null, venue: (t.venue || "").trim() || null, teams: [...counted.get(t.id).keys()].sort(byName) })) };
    }
  }
  return { ...base, tournaments, snapshots, upcoming, next_up };
}

// ---------------------------------------------------------------- demo (live platform, no DB)

// Per warm function: the CDN already caches the response for 60 s, this stops
// a cold page + its first refresh from fetching AES twice.
const memo = new Map();
function cached(key, ttlMs, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.p;
  const p = Promise.resolve().then(fn);
  memo.set(key, { at: Date.now(), p });
  p.catch(() => memo.delete(key));
  if (memo.size > 300) for (const [k, v] of memo) if (Date.now() - v.at > 600000) memo.delete(k);
  return p;
}

// aes:<results key>:<clubId> | otto:<esw id or numeric id>:<teamId,teamId>
export function parseDemo(s) {
  const str = String(s || "").trim();
  const a = /^aes:([A-Za-z0-9_-]{4,160}[0-2]):(-?\d{1,9})$/.exec(str);
  if (a) return { platform: "aes", key: a[1], clubId: Number(a[2]), param: str };
  const o = /^otto:([0-9a-f]{9}|\d{3,10}):(\d{1,12}(?:,\d{1,12}){0,11})$/i.exec(str);
  if (o) return { platform: "otto", key: o[1], teamIds: [...new Set(o[2].split(","))], param: str };
  return null;
}
const validTz = (tz) => { if (!tz) return null; try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return null; } };

async function buildAesDemo(d, { team: teamSlug, tz: tzParam }) {
  const { key, clubId } = d;
  const event = await cached("ev:" + key, 300000, () => aesEvent(key));
  if (!event) throw httpError(404, "That AES event isn't published (or the key is wrong).");
  // Venue zone: the registration landing has the address for club events;
  // scheduler-only events only have results' Location text.
  const eventId = aesDecodeKey(key);
  const landing = eventId ? await cached("land:" + eventId, 3600000, () => aesLanding(eventId).catch(() => null)) : null;
  const addr = landing?.address;
  const location = addr ? [addr.city, addr.state?.abbreviation].filter(Boolean).join(", ") : event.Location || null;
  const tz = validTz(tzParam) || tzForTournament({ location, venue: event.Location });
  const now = localNow(tz);

  const [standings, nexts, stamp] = await cached(`club:${key}:${clubId}`, 45000, async () => {
    const got = await Promise.all([aesStandings(key, [], { clubId }), aesNext(key, [], { clubId }), aesTimestamp(key).catch(() => null)]);
    // null = AES served its HTML error page. Throwing here keeps it out of the
    // cache, so the next request tries again instead of failing for 45 s.
    if (!got[0] || !got[1]) throw httpError(502, "AES results aren't readable right now. Try again in a minute.");
    return got;
  });
  const byId = new Map();
  for (const r of standings) byId.set(r.TeamId, { id: r.TeamId, name: r.TeamName, div: r.Division?.Name || null, divId: r.Division?.DivisionId ?? null, standing: r, next: null, club: r.Club?.Name });
  for (const r of nexts) {
    const t = byId.get(r.TeamId) || { id: r.TeamId, name: r.TeamName, div: r.TeamDivision?.Name || null, divId: r.TeamDivision?.DivisionId ?? null, standing: null, club: r.TeamClub?.Name };
    t.next = r; byId.set(r.TeamId, t);
  }
  const clubTeams = [...byId.values()].filter((t) => t.name).sort((a, b) => byName(a.div || "", b.div || "") || byName(a.name, b.name));
  if (!clubTeams.length) throw httpError(404, `Club ${clubId} has no teams in ${event.Name}.`);
  const club = clubTeams.find((t) => t.club)?.club || `Club ${clubId}`;
  const teams = clubTeams.map((t) => ({ name: t.name, slug: slugOf(t.name), level: t.div, group: t.div || "Teams" }));

  const eventUrl = aesEventUrl(key);
  const one = teamSlug ? clubTeams.find((t) => slugOf(t.name) === slugOf(teamSlug)) || null : null;
  const snapshots = {};
  if (one) {
    // A team page: the four schedule lists + its pool sheet (pool rank, the
    // teams in its work matches) — the same calls the 5-minute sync makes.
    const snap = await cached(`team:${key}:${one.id}`, 45000, async () => {
      let div = one.divId;
      if (div == null) div = (await aesTeamHeader(key, one.id))?.TeamDivision?.DivisionId;
      const [past, current, future, work] = await Promise.all(["past", "current", "future", "work"].map((w) => aesTeamSchedule(key, div, one.id, w)));
      const playId = aesPoolPlayId({ past, current });
      const poolsheet = playId != null ? await aesPoolsheet(key, playId).catch(() => null) : null;
      return aesTeamSnapshot({ event, eventUrl, teamUrl: aesTeamUrl(key, clubId, one.id), past, current, future, work, standing: one.standing, next: one.next, teamId: one.id, stamp, poolsheet, nowLocal: now });
    });
    snapshots[one.name] = [{ tournament_id: "demo", platform: "aes", synced_at: new Date().toISOString(), checked_at: new Date().toISOString(), feed_url: eventUrl, snapshot: withNext(snap, now) }];
  } else {
    // Home: standings + next assignments alone give every team's NEXT card
    // (2 calls for the whole club instead of 6 per team).
    for (const t of clubTeams) {
      const snap = aesTeamSnapshot({ event, eventUrl, teamUrl: aesTeamUrl(key, clubId, t.id), standing: t.standing, next: t.next, teamId: t.id, stamp, nowLocal: now });
      snapshots[t.name] = [{ tournament_id: "demo", platform: "aes", synced_at: new Date().toISOString(), checked_at: new Date().toISOString(), feed_url: eventUrl, snapshot: lite(withNext(snap, now)) }];
    }
  }
  const start = ymd(event.StartDate), end = ymd(event.EndDate) || start;
  const snapList = Object.values(snapshots).flat().map((x) => x.snapshot);
  const tournament = {
    id: "demo", name: event.Name, start, end, location, venue: event.Location && event.Location !== location ? event.Location : null,
    tz, now_local: now, today: now.slice(0, 10), teams: one ? [one.name] : teams.map((t) => t.name), posts_hint: null,
    feeds: [{ platform: "aes", event_name: event.Name, published: true, url: eventUrl }],
    ...tnStatus({ start, end, today: now.slice(0, 10), snaps: event.IsOver ? snapList.map((s) => ({ ...s, done: true })) : snapList, published: true }),
  };
  return demoResult(d, { club, event_name: event.Name, teams, one, teamSlug, tournament, snapshots });
}

// Same test as api/_lib/tournament-sync-core.js ottoWantsPools: a pool place
// is still unknown for a pool the team has left (not the one it's playing in)
// or for the pool before this one.
const ottoWantsPools = (snap, fav) => fav.division_id != null && (
  (!!snap.pool && snap.pool.rank == null && !(fav.ongoing_pool_bracket && Number(fav.ongoing_pool_bracket.is_pool) === 1))
  || (!!snap.last_pool && snap.last_pool.rank == null));

async function buildOttoDemo(d, { team: teamSlug, tz: tzParam }) {
  const ev = await cached("oev:" + d.key, 300000, () => ottoEventEsw(d.key));
  if (!ev) throw httpError(404, "That OTTO event wasn't found.");
  const esw = ev.esw_id || d.key;
  const fav = await cached(`ofav:${esw}:${d.teamIds.join(",")}`, 45000, () => ottoFavoriteTeams(esw, d.teamIds));
  if (!fav.length) throw httpError(404, "None of those OTTO team ids are in that event.");
  const location = [ev.city, ev.state].filter(Boolean).join(", ") || null;
  const tz = validTz(tzParam) || tzForTournament({ location });
  const now = localNow(tz);
  const all = fav.map((t) => ({ t, name: String(t.team_name || t.team_id).trim(), div: t.division_name ? String(t.division_name).trim() : null }))
    .sort((a, b) => byName(a.div || "", b.div || "") || byName(a.name, b.name));
  const teams = all.map((x) => ({ name: x.name, slug: slugOf(x.name), level: x.div, group: x.div || "Teams" }));
  const one = teamSlug ? all.find((x) => slugOf(x.name) === slugOf(teamSlug)) || null : null;
  const snapshots = {};
  for (const x of one ? [one] : all) {
    const base = { event: ev, eventUrl: ottoEventUrl(esw), teamUrl: ottoTeamUrl(esw, x.t.team_id), fav: x.t, nowLocal: now };
    let raw = ottoTeamSnapshot(base);
    // A team page gets the pool places only divisionPoolBrackets has (the pool
    // left for a bracket, round 1 of pool-to-pool rounds) — the sync's rule,
    // one cached call per division.
    if (one && ottoWantsPools(raw, x.t)) {
      const pools = await cached(`opools:${esw}:${x.t.division_id}`, 45000, () => ottoDivisionPools(esw, x.t.division_id)).catch(() => null);
      if (pools) raw = ottoTeamSnapshot({ ...base, pools });
    }
    const snap = withNext(raw, now);
    snapshots[x.name] = [{ tournament_id: "demo", platform: "otto", synced_at: new Date().toISOString(), checked_at: new Date().toISOString(), feed_url: ottoEventUrl(esw), snapshot: one ? snap : lite(snap) }];
  }
  const ms = (v) => { const n = Number(v); return n > 0 ? new Date(n).toISOString().slice(0, 10) : null; };
  const start = ms(ev.date_start) || now.slice(0, 10), end = ms(ev.date_end) || start;
  const snapList = Object.values(snapshots).flat().map((x) => x.snapshot);
  const club = all[0].t.external?.club_info?.club_name || "OTTO teams";
  const tournament = {
    id: "demo", name: ev.long_name || "OTTO event", start, end, location, venue: null, tz, now_local: now, today: now.slice(0, 10),
    teams: one ? [one.name] : teams.map((t) => t.name), posts_hint: null,
    feeds: [{ platform: "otto", event_name: ev.long_name || null, published: !!ev.schedule_published, url: ottoEventUrl(esw) }],
    ...tnStatus({ start, end, today: now.slice(0, 10), snaps: snapList, published: true }),
  };
  return demoResult(d, { club, event_name: ev.long_name, teams, one: one ? { name: one.name } : null, teamSlug, tournament, snapshots });
}

function demoResult(d, { club, event_name, teams, one, teamSlug, tournament, snapshots }) {
  const team = one ? teams.find((t) => t.name === one.name) : null;
  return {
    ok: true, mode: "demo", generated_at: new Date().toISOString(), now_central: localNow("America/Chicago"),
    demo: { platform: d.platform, param: d.param, club, event_name: event_name || null },
    team: team || null, not_found: teamSlug && !team ? String(teamSlug).slice(0, 60) : null,
    teams, tournaments: teamSlug && !team ? [] : [tournament], snapshots, upcoming: {}, next_up: null,
  };
}

// ---------------------------------------------------------------- entry points

// q: { team?, demo?, tz? }. sb only needed without demo.
export async function buildHubData(sb, q = {}) {
  if (q.demo) {
    const d = parseDemo(q.demo);
    if (!d) throw httpError(400, "demo must be aes:<key>:<clubId> or otto:<eswId>:<teamId,teamId>");
    return d.platform === "aes" ? buildAesDemo(d, q) : buildOttoDemo(d, q);
  }
  if (!sb) throw httpError(500, "Hub isn't configured (Supabase).");
  return buildFromDb(sb, q);
}

export function hubSupabase() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const hubQuery = (req) => {
  const u = new URL(req.url || "/", "https://x");
  const s = (k) => (u.searchParams.get(k) || "").trim().slice(0, 200) || null;
  return { team: s("team"), demo: s("demo"), tz: s("tz") };
};

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "GET only" });
  }
  const q = hubQuery(req);
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  try {
    const out = await buildHubData(q.demo ? null : hubSupabase(), q);
    res.setHeader("Cache-Control", q.demo ? "public, s-maxage=60, stale-while-revalidate=120" : "public, s-maxage=30, stale-while-revalidate=60");
    return res.status(out.not_found ? 404 : 200).json(out);
  } catch (e) {
    const status = e.status || 502;
    console.error("hub-data", q, e);
    res.setHeader("Cache-Control", "no-store");
    return res.status(status).json({ ok: false, error: e.status ? e.message : "Couldn't load the schedule right now. Try again in a minute." });
  }
}
