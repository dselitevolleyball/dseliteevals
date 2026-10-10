// Tournament Hub sync — finds where each DS Elite team's games are posted
// (AES or OTTO, the renamed SportWrench), keeps a normalized snapshot of its
// schedule and results in tournament_team_feed, and pushes alerts to the
// families and coaches following the team (Drew, 10 Oct 2026: "an easy way for
// parents, coaches and directors to see who they are playing and when, in real
// time during the week leading up and during the tournament").
//
// runSync(sb, opts) is the whole job. api/tournament-sync.js (the 5-minute
// cron) and api/tournament-feed.js (admin link / unlink / sync) are thin
// wrappers, and scripts call it directly. Raw platform JSON comes from
// ./tournament-sources.js; shared/tournament-feed.js turns it into
// TeamSnapshots and decides which alerts are due.
//
// One run (today = Central date; everything else at the venue's wall clock):
//  1. Window: tournaments not cancelled, with a team going (assignment not
//     dropped / need_to_drop), start - 10 days <= today <= end + 1.
//  2. Discovery, every 6 h (every hour within 3 days of the start), at most
//     MAX_DISCOVER tournaments a run:
//     a. AES by team: each team's season events (ranking API, global team id)
//        overlapping the dates (±1 day if the name also matches) → landing →
//        feed (key once posted). Same date rule for b and c. An event in
//        another state counts only if its name also matches (a stray entry
//        in Foley, AL the CTPL #4 weekend is not CTPL #4).
//     b. AES by name, for teams with no published feed yet — an unposted AES
//        event from (a) doesn't count, the posted one may be the real one
//        (Rise teams have no AES id; scheduler-only events — CTPL, Lone Star
//        Classic, Regionals — have no eventId and their team ids may be ad
//        hoc): search the posted AES feeds we already have, then posted
//        scheduler-only events on those dates (name-similar first, max 25)
//        for "DS Elite" / "Dripping". When every such team is already in an
//        unposted AES event, only name-similar events are searched; with no
//        state in the location (a nationwide list), name- or city-similar.
//     c. OTTO, for teams with no published feed and no OTTO feed yet: events
//        on those dates (name-similar first, max 15) → paginatedClubs("DSELI")
//        → match by master_team_id, else by name.
//     d. Per team: a published feed beats an unpublished one, AES beats OTTO
//        on a tie, and a team row on a manually linked feed is never touched.
//  3. Poll. Event days: every run. Otherwise hourly. Unpublished feeds are
//     re-checked at the same cadence (one landing / eventEsw call), so a
//     posted schedule shows up within the hour instead of at the next
//     6-hourly discovery. AES: /timestamp first; unchanged stamp + every
//     team's snapshot < 30 min old = nothing to do. Otherwise one standings
//     and one nextassignments call for all the feed's teams, then the four
//     schedules + pool sheet only for teams whose standings/next row changed
//     (snapshot.src_sig) or whose snapshot is 30 min old, two teams at a
//     time; teams not started by 85 s wait for the next run (the stamp isn't
//     saved, so they're picked up). OTTO: one favoriteTeams call per feed.
//     At most 4 platform calls in flight; none starts after 108 s and one
//     still running then is abandoned, so a slow platform can't carry the
//     function past its 120 s limit.
//  4. Alerts (not when dry / alerts:false), 7:00-21:30 venue time; on event
//     days anything, otherwise only "schedule posted". Every key is inserted
//     into hub_alerts_sent BEFORE the push goes out (on conflict do nothing),
//     so two overlapping runs can't both send it. A team's alerts from one run
//     go out as ONE notification (they share the per-team tag, so separate
//     ones would replace each other in the tray). First sync of a team while
//     its event is already under way: only the next match and finals from
//     the last 2 hours go out; the backlog is recorded as not sent. Nothing
//     is recorded after 112 s (left for the next run, not lost to the kill).
//     14 Crystal (event team) is synced for the HQ view but never alerted.
//
// opts: { dry, tournamentId, discover, alerts (default true), windowDays,
//         force, now (Date, for tests), maxDiscover, budgetMs, sender }
// Also exported: testFeed (the ?test= / demo path, no DB), linkFeed /
// unlinkFeed / parseFeedUrl (admin), planTeamAlerts / deliverTeamAlerts
// (alert selection + delivery, exported so they can be exercised with a stub
// sender), authCaller (shared by both handlers), nameSim.

import * as S from "./tournament-sources.js";
import {
  dseTeamName, tzForTournament, localNow, aesTeamSnapshot, ottoTeamSnapshot, withNext,
  alertsFor, snapshotHash, aesPoolPlayId, aesKey, addMinutes,
} from "../../shared/tournament-feed.js";
import { isEventTeam } from "../../shared/event-teams.js";
import { hubPushReady, loadPushTargets, targetsForTeam, sendPush, hubPayload } from "./hub-push.js";

export const OWNERS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const NOT_GOING = new Set(["dropped", "need_to_drop"]);
const MIN = 60000, HOUR = 60 * MIN;
const WINDOW_BEFORE_DAYS = 10;
const DISCOVER_EVERY = 6 * HOUR, DISCOVER_EVERY_NEAR = HOUR, NEAR_DAYS = 3;
const PREWEEK_EVERY = 60 * MIN, STALE = 30 * MIN;
const HTTP_CONCURRENCY = 4;
const BUDGET_MS = 100000;        // maxDuration is 120 s; leave room to write and answer
const HARD_STOP_MS = 8000;       // platform calls fail once budget + this has passed
const ALERT_STOP_MS = 12000;     // no alert is recorded once budget + this has passed
const AES_TEAMS_IN_FLIGHT = 2;
const MAX_DISCOVER = 4;          // discoveries per run — the rest wait 5 minutes
const AES_SEARCH_CAP = 25, OTTO_PROBE_CAP = 15;
const SEND_FROM = "07:00", SEND_UNTIL = "21:30";
const BACKLOG_MIN = 120;         // first sync mid-event: finals from the last 2 h only
const STALE_FINAL_MIN = 12 * 60; // never announce a result older than this (overnight hold is ~9.5 h)
const US_STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));

// ---------- small helpers ----------

const ymd = (d) => String(d || "").slice(0, 10);
const addDays = (iso, n) => { const t = Date.parse(ymd(iso) + "T12:00:00Z"); return Number.isFinite(t) ? new Date(t + n * 86400000).toISOString().slice(0, 10) : null; };
const centralToday = (now) => localNow("America/Chicago", now).slice(0, 10);
const trunc = (s, n = 300) => { const t = String(s ?? ""); return t.length > n ? t.slice(0, n - 3) + "..." : t; };
const errMsg = (e) => trunc(e?.message || String(e));
const localMs = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(s || "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : NaN; };
const ageMs = (iso, now) => (iso ? now.getTime() - Date.parse(iso) : Infinity);
const place = (city, st) => [city, st].filter(Boolean).join(", ") || null;
const dayMs = (d) => { const t = Date.parse(ymd(d) + "T00:00:00Z"); return Number.isFinite(t) ? t : null; };
const msDay = (ms) => (Number(ms) > 0 ? new Date(Number(ms)).toISOString().slice(0, 10) : null); // OTTO wall-clock-as-UTC
const hashOf = (s) => (s ? snapshotHash({ ...s, src_sig: null }) : null);
function dateRange(start, end) {
  const a = Date.parse(ymd(start) + "T00:00:00Z"), b = Date.parse(ymd(end || start) + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || b - a > 9 * 86400000) return [];
  const out = [];
  for (let t = a; t <= b; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
// Last two-letter state code in "Austin, TX" / "La Vernia, Texas 78121, TX".
export function stateOf(s) {
  const codes = [...String(s || "").matchAll(/\b([A-Z]{2})\b/g)].map((m) => m[1]).filter((c) => US_STATES.has(c));
  return codes.length ? codes[codes.length - 1] : null;
}

// Event-name similarity (0..~1.25), the same idea as api/_lib/tournament-match.js
// but as a score for ranking candidates: "CTPL #1" ~ "2027 CTPL #1
// (12/12-12/13/2026)", "#1" vs "#2" is a strong mismatch. Dates, years and
// filler words don't count.
const NAME_NOISE = new Set(["the", "and", "of", "a", "an", "at", "in", "for", "girls", "boys", "girl", "boy", "adidas", "nike", "usav", "usa", "volleyball", "vb", "tournament", "event", "presented", "by", "club", "jr", "junior", "juniors"]);
const nameWords = (s) => String(s || "").toLowerCase()
  .replace(/\([^)]*\d+\/\d+[^)]*\)/g, " ")
  .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ")
  .replace(/[^a-z0-9 ]/g, " ")
  .split(/\s+/).filter((w) => w && !NAME_NOISE.has(w) && !/^(19|20)\d\d$/.test(w));
const nameNums = (s) => new Set((String(s || "").match(/(?:#|weekend\s*|wk\s*|no\.\s*)(\d+)/gi) || []).map((x) => x.replace(/\D/g, "")));
export function nameSim(a, b) {
  const A = new Set(nameWords(a)), B = new Set(nameWords(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  let score = shared / Math.max(A.size, B.size);
  const na = nameNums(a), nb = nameNums(b);
  if (na.size && nb.size) score += [...na].some((x) => nb.has(x)) ? 0.25 : -0.35;
  return Math.max(0, Math.round(score * 100) / 100);
}

function limiter(n) {
  let active = 0;
  const q = [];
  const pump = () => {
    if (active >= n || !q.length) return;
    active++;
    const { fn, res, rej } = q.shift();
    Promise.resolve().then(fn).then(res, rej).finally(() => { active--; pump(); });
  };
  return (fn) => new Promise((res, rej) => { q.push({ fn, res, rej }); pump(); });
}

// Per-run context: the clock, the HTTP limiter (leaf platform calls only — a
// limited task must never wait on another, or it deadlocks), per-run memo.
// Past the deadline a queued call fails without running, and a call still
// running is given up on (its fetch may finish in the background, unread).
const budgetError = () => Object.assign(new Error("time budget - left for the next run"), { budget: true });
function makeCtx(sb, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : opts.now ? new Date(opts.now) : new Date();
  const lim = limiter(HTTP_CONCURRENCY);
  const started = Date.now(), budget = Number(opts.budgetMs) || BUDGET_MS;
  const ctx = {
    sb, now, nowIso: now.toISOString(), dry: !!opts.dry, started, budget, deadline: started + budget + HARD_STOP_MS,
    calls: 0, memo: new Map(), tempId: 0,
    sender: opts.sender || null,
    http: (fn) => lim(() => {
      const left = ctx.deadline - Date.now();
      if (left <= 0) throw budgetError();
      ctx.calls++;
      let timer;
      const cut = new Promise((_, rej) => { timer = setTimeout(() => rej(budgetError()), left); });
      return Promise.race([Promise.resolve().then(fn), cut]).finally(() => clearTimeout(timer));
    }),
    once: (key, fn) => { if (!ctx.memo.has(key)) ctx.memo.set(key, Promise.resolve().then(fn)); return ctx.memo.get(key); },
    elapsed: () => Date.now() - ctx.started,
  };
  return ctx;
}

const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };

// ---------- state ----------

// Everything the run needs from the database, in a handful of queries.
async function loadState(ctx, { tournamentId = null, windowDays = WINDOW_BEFORE_DAYS } = {}) {
  const { sb } = ctx;
  const today = centralToday(ctx.now);
  const wd = Number.isFinite(Number(windowDays)) ? Math.max(0, Math.min(400, Number(windowDays))) : WINDOW_BEFORE_DAYS;
  const G = { today, window: tournamentId != null ? { tournament: tournamentId } : { from: addDays(today, -1), starts_by: addDays(today, wd) }, tournaments: [], skipped: [], teams: new Map(), known: [], byAesId: new Map(), byMaster: new Map(), sent: new Map() };
  let q = sb.from("tournaments").select("id, name, start_date, end_date, location, venue, time_zone, cancelled, feed_discovered_at");
  q = tournamentId != null ? q.eq("id", tournamentId) : q.lte("start_date", addDays(today, wd)).gte("start_date", addDays(today, -45));
  const tns = must(await q, "tournaments") || [];
  const cand = [];
  for (const t of tns) {
    if (!t.start_date) continue;
    if (t.cancelled) { if (tournamentId != null) G.skipped.push({ id: t.id, name: t.name, why: "cancelled" }); continue; }
    if (tournamentId == null && ymd(t.end_date || t.start_date) < addDays(today, -1)) continue;
    cand.push(t);
  }
  if (tournamentId != null && !tns.length) G.skipped.push({ id: tournamentId, why: "no such tournament" });
  const pts = must(await sb.from("practice_teams").select("team_name, level, practices_per_week, aes_team_id, otto_master_team_id"), "practice_teams") || [];
  for (const p of pts) {
    G.teams.set(p.team_name, p);
    G.known.push(p.team_name);
    if (p.aes_team_id != null) G.byAesId.set(String(p.aes_team_id), p.team_name);
    if (p.otto_master_team_id != null) G.byMaster.set(String(p.otto_master_team_id), p.team_name);
  }
  if (!cand.length) return G;
  const ids = cand.map((t) => t.id);
  const [asg, feeds, rows, sent] = await Promise.all([
    sb.from("tournament_assignments").select("tournament_id, team_id, status").in("tournament_id", ids),
    sb.from("tournament_feeds").select("*").in("tournament_id", ids).order("id"),
    sb.from("tournament_team_feed").select("*").in("tournament_id", ids),
    sb.from("hub_alerts_sent").select("tournament_id, team_name, kind, key, sent_at").in("tournament_id", ids),
  ]);
  must(asg, "tournament_assignments"); must(feeds, "tournament_feeds"); must(rows, "tournament_team_feed"); must(sent, "hub_alerts_sent");
  for (const s of sent.data || []) {
    const k = `${s.tournament_id}|${s.team_name}`;
    if (!G.sent.has(k)) G.sent.set(k, []);
    G.sent.get(k).push(s);
  }
  for (const t of cand) {
    const counted = [...new Set((asg.data || []).filter((a) => a.tournament_id === t.id && !NOT_GOING.has(String(a.status || "").toLowerCase()) && G.teams.has(a.team_id)).map((a) => a.team_id))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!counted.length) { if (tournamentId != null) G.skipped.push({ id: t.id, name: t.name, why: "no teams going" }); continue; }
    const tz = tzForTournament(t);
    const nowLocal = localNow(tz, ctx.now);
    const T = {
      t, id: t.id, name: t.name, start: ymd(t.start_date), end: ymd(t.end_date || t.start_date),
      tz, nowLocal, day: nowLocal.slice(0, 10), counted,
      feeds: (feeds.data || []).filter((f) => f.tournament_id === t.id),
      rows: new Map((rows.data || []).filter((r) => r.tournament_id === t.id).map((r) => [r.team_name, r])),
    };
    T.out = { id: t.id, name: t.name, start: T.start, end: T.end, tz, now_local: nowLocal, event_day: isEventDay(T), teams: counted, discovery: null, feeds: [], alerts: [], rows: [] };
    G.tournaments.push(T);
  }
  return G;
}

const isEventDay = (T, feed = null) =>
  (T.start <= T.day && T.day <= T.end) || !!(feed && feed.start_date && ymd(feed.start_date) <= T.day && T.day <= ymd(feed.end_date || feed.start_date));
const feedById = (T, id) => (id == null ? null : T.feeds.find((f) => String(f.id) === String(id)) || null);

// Insert or refresh a feed. Existing = same platform + event_ref, or the same
// results key under another ref (a manual 'key:' link and the same event found
// later as 'sched:'). linked_by is only ever changed when asked (link).
// published/event_key undefined = leave alone (a failed landing call must not
// unpublish a live feed).
async function saveFeed(ctx, T, fields) {
  let f = T.feeds.find((x) => x.platform === fields.platform && (x.event_ref === fields.event_ref || (fields.event_key && x.event_key === fields.event_key)));
  if (f) {
    const patch = {};
    for (const k of ["event_key", "event_name", "start_date", "end_date", "location"]) if (fields[k] != null && fields[k] !== f[k]) patch[k] = fields[k];
    if (fields.published !== undefined && !!fields.published !== !!f.published) patch.published = !!fields.published;
    if (fields.linked_by && fields.linked_by !== f.linked_by) patch.linked_by = fields.linked_by;
    if (Object.keys(patch).length) {
      patch.updated_at = ctx.nowIso;
      if (!ctx.dry) must(await ctx.sb.from("tournament_feeds").update(patch).eq("id", f.id), "update feed");
      Object.assign(f, patch);
      f._touched = Object.keys(patch).filter((k) => k !== "updated_at");
    }
    return f;
  }
  const row = {
    tournament_id: T.id, platform: fields.platform, event_ref: String(fields.event_ref), event_key: fields.event_key || null,
    event_name: fields.event_name || null, start_date: fields.start_date || null, end_date: fields.end_date || null,
    location: fields.location || null, published: !!fields.published, linked_by: fields.linked_by || "auto", updated_at: ctx.nowIso,
  };
  if (ctx.dry) f = { id: -(++ctx.tempId), ...row, last_stamp: null, last_checked_at: null, last_changed_at: null, last_error: null };
  else f = must(await ctx.sb.from("tournament_feeds").upsert(row, { onConflict: "tournament_id,platform,event_ref" }).select().single(), "insert feed");
  f._new = true;
  T.feeds.push(f);
  return f;
}

// Feed bookkeeping columns (last_checked_at etc.).
async function saveFeedState(ctx, feed, patch) {
  Object.assign(feed, patch);
  if (ctx.dry || feed.id < 0) return;
  must(await ctx.sb.from("tournament_feeds").update({ ...patch, updated_at: ctx.nowIso }).eq("id", feed.id), "feed state");
}

const ROW_COLS = ["tournament_id", "team_name", "feed_id", "platform_team_id", "division_id", "division_name", "snapshot", "synced_at", "updated_at"];
async function saveRow(ctx, T, team, patch) {
  const cur = T.rows.get(team);
  const row = { ...(cur || { tournament_id: T.id, team_name: team, feed_id: null, platform_team_id: null, division_id: null, division_name: null, snapshot: null, synced_at: null }), ...patch, updated_at: ctx.nowIso };
  T.rows.set(team, row);
  if (ctx.dry || (row.feed_id != null && row.feed_id < 0)) return row;
  if (cur) must(await ctx.sb.from("tournament_team_feed").update({ ...patch, updated_at: ctx.nowIso }).eq("tournament_id", T.id).eq("team_name", team), "update team row");
  else must(await ctx.sb.from("tournament_team_feed").upsert(Object.fromEntries(ROW_COLS.map((k) => [k, row[k] ?? null])), { onConflict: "tournament_id,team_name" }), "insert team row");
  return row;
}

// ---------- discovery ----------

function discoveryDue(ctx, T, opts) {
  if (opts.discover) return { due: true, reason: "forced" };
  const age = ageMs(T.t.feed_discovered_at, ctx.now);
  if (!Number.isFinite(age)) return { due: true, reason: "never searched" };
  const near = T.start <= addDays(centralToday(ctx.now), NEAR_DAYS);
  const every = near ? DISCOVER_EVERY_NEAR : DISCOVER_EVERY;
  return age >= every ? { due: true, reason: `last searched ${Math.round(age / MIN)} min ago` } : { due: false, reason: `searched ${Math.round(age / MIN)} min ago (every ${every / HOUR} h)` };
}

async function discover(ctx, G, T) {
  const out = { ran: true, feeds: [], mapped: [], errors: [], probes: { aes_search: 0, otto_clubs: 0 } };
  const cands = new Map();
  const add = (team, c) => { if (!cands.has(team)) cands.set(team, []); if (!cands.get(team).some((x) => x.feed.id === c.feed.id)) cands.get(team).push(c); };
  const curFeed = (n) => feedById(T, T.rows.get(n)?.feed_id);
  const has = (n, test) => (cands.get(n) || []).some((c) => test(c.feed)) || (curFeed(n) ? test(curFeed(n)) : false);
  const lo = addDays(T.start, -1), hi = addDays(T.end, 1);
  const st = stateOf(T.t.location) || stateOf(T.t.venue);
  // The ±1 day slack (tournament rows are sometimes a day off) only counts
  // for an event whose name also looks like ours: a team entered in an
  // unrelated Sunday event must not have it mapped onto Saturday's tournament.
  const fits = (s, e, ...names) => {
    s = ymd(s); e = ymd(e || s);
    if (!s || s > hi || e < lo) return false;
    return (s <= T.end && e >= T.start) || names.some((n) => nameSim(n, T.name) >= 0.34);
  };

  // a. AES by team id (the ranking API lists every event a team is entered in).
  const withId = T.counted.filter((n) => G.teams.get(n)?.aes_team_id != null);
  const lists = await Promise.all(withId.map((n) => {
    const id = G.teams.get(n).aes_team_id;
    return ctx.once(`aesTeamEvents:${id}`, () => ctx.http(() => S.aesTeamEvents(id))).then((evs) => [n, evs || []], (e) => { out.errors.push(`AES events for ${n}: ${errMsg(e)}`); return [n, []]; });
  }));
  // An exact-date event in another state is a different event unless its
  // name says otherwise: 14 Emerald is also entered in "2027 March Madness"
  // (Foley, AL) the CTPL #4 (Austin) weekend.
  const sameState = (e) => { const s = e.address?.state?.abbreviation; return !st || !s || String(s).toUpperCase() === st; };
  for (const [n, evs] of lists) {
    const hits = evs.filter((e) => e && e.eventId && fits(e.startDate, e.endDate, e.name) && (sameState(e) || nameSim(e.name, T.name) >= 0.34));
    if (!hits.length) continue;
    // Two events that weekend (a Saturday one-day and a Sunday one): the one
    // starting on our start date, then the closer name, then the shorter.
    const rank = (e) => (ymd(e.startDate) === T.start ? 2 : 0) + nameSim(e.name, T.name) - (Date.parse(ymd(e.endDate || e.startDate)) - Date.parse(ymd(e.startDate))) / 86400000 / 100;
    const e = hits.sort((a, b) => rank(b) - rank(a))[0];
    let landing;
    try { landing = await ctx.once(`aesLanding:${e.eventId}`, () => ctx.http(() => S.aesLanding(e.eventId))); }
    catch (err) { out.errors.push(`AES landing ${e.eventId}: ${errMsg(err)}`); }
    const posted = !!(landing?.isSchedulerPosted && landing?.eventSchedulerKey);
    const feed = await saveFeed(ctx, T, {
      platform: "aes", event_ref: String(e.eventId), event_key: posted ? landing.eventSchedulerKey : undefined,
      published: landing === undefined ? undefined : posted, event_name: e.name, start_date: ymd(e.startDate), end_date: ymd(e.endDate || e.startDate),
      location: place(e.address?.city, e.address?.state?.abbreviation),
    });
    add(n, { feed, platform_team_id: String(G.teams.get(n).aes_team_id), how: "AES team events" });
  }

  // b. AES by name, for teams with no published feed. A team that only has
  // an unposted AES event (from a, or kept) still looks: the posted
  // scheduler-only event that lists it is the one that will have its games.
  // A team already on a published feed (an OTTO event in play) doesn't —
  // that was 50 fruitless searches an hour all tournament week.
  const gotAes = (n) => has(n, (f) => f.platform === "aes" && f.published);
  const needAes = T.counted.filter((n) => !has(n, (f) => f.published));
  if (needAes.length) {
    const targets = T.feeds.filter((f) => f.platform === "aes" && f.published && f.event_key).map((f) => ({ key: f.event_key, feed: f }));
    // Only events whose name looks like this tournament are worth a search
    // when everyone still looking is already entered in an (unposted) AES
    // event — that one gets posted in place, the search is just for a stray
    // entry like Foley — or when there's no state and the list would be
    // nationwide (then a city match counts too). Not for teams on an OTTO
    // registration: Lone Star Classic posts on AES as "2026 adidas LSC 1:
    // 15LA, 16A (SAN ANTONIO)", nothing like our name for it.
    const strict = !st || needAes.every((n) => has(n, (f) => f.platform === "aes"));
    const words = (s) => ` ${String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
    const where = words(`${T.t.location || ""} ${T.t.venue || ""}`);
    const looksLikeOurs = (x) => nameSim(x.name, T.name) >= 0.34 || (!st && words(x.city).trim() !== "" && where.includes(words(x.city)));
    try {
      const sched = await ctx.once(`aesSched:${lo}:${hi}:${st}`, () => ctx.http(() => S.aesSchedulerEvents({ start: lo, end: hi, state: st })));
      const posted = (sched || []).filter((x) => x.isSchedulerPosted && x.eventSchedulerKey && fits(x.startDate, x.endDate, x.name) && !targets.some((t) => t.key === x.eventSchedulerKey) && (!strict || looksLikeOurs(x)))
        .map((x) => ({ x, score: nameSim(x.name, T.name) + (x.startDate === T.start ? 0.2 : 0) }))
        .sort((a, b) => b.score - a.score);
      for (const { x } of posted) targets.push({ key: x.eventSchedulerKey, sched: x });
    } catch (e) { out.errors.push("AES scheduler-only list: " + errMsg(e)); }
    let probed = 0;
    for (const tg of targets) {
      if (!needAes.some((n) => !gotAes(n))) break;
      if (probed >= AES_SEARCH_CAP) { out.errors.push(`AES search stopped at ${AES_SEARCH_CAP} events`); break; }
      if (ctx.elapsed() > ctx.budget * 0.6) { out.errors.push("AES search stopped (time budget)"); break; }
      probed++;
      const hits = new Map();
      for (const text of ["DS Elite", "Dripping"]) {
        let res;
        out.probes.aes_search++;
        try { res = await ctx.once(`aesSearch:${tg.key}:${text}`, () => ctx.http(() => S.aesSearch(tg.key, text))); }
        catch (e) { out.errors.push(`AES search ${text}: ${errMsg(e)}`); break; }
        for (const tm of res?.Teams || []) {
          const name = G.byAesId.get(String(tm.TeamId)) || dseTeamName(tm.TeamName, G.known);
          if (name && !hits.has(name)) hits.set(name, tm);
        }
        if (needAes.every((n) => hits.has(n))) break;
      }
      const mine = [...hits].filter(([n]) => needAes.includes(n) && !gotAes(n));
      if (!mine.length) continue;
      const feed = tg.feed || await saveFeed(ctx, T, {
        platform: "aes", event_ref: "sched:" + tg.sched.eventSchedulerId, event_key: tg.key, published: true,
        event_name: tg.sched.name, start_date: tg.sched.startDate, end_date: tg.sched.endDate, location: place(tg.sched.city, tg.sched.state),
      });
      for (const [n, tm] of mine) add(n, { feed, platform_team_id: String(tm.TeamId), division_id: tm.DivisionId != null ? String(tm.DivisionId) : null, how: "AES name search" });
    }
  }

  // c. OTTO. When every team still looking already has some (unposted) feed,
  // only events whose names look like this tournament are worth a probe —
  // otherwise December Dash would probe every Texas OTTO event that weekend
  // every hour of tournament week.
  const needOtto = T.counted.filter((n) => !has(n, (f) => f.published) && !has(n, (f) => f.platform === "otto"));
  if (needOtto.length) {
    let evs = [];
    try { evs = await ctx.once(`ottoEvents:${lo}:${hi}:${st}`, () => ctx.http(() => S.ottoEvents({ start: lo, end: hi, state: st }))); }
    catch (e) { out.errors.push("OTTO events: " + errMsg(e)); }
    const strict = needOtto.every((n) => (cands.get(n) || []).length || curFeed(n));
    const ranked = (evs || []).filter((ev) => fits(ev.date_start, ev.date_end, ev.long_name, ev.name))
      .map((ev) => ({ ev, sim: Math.max(nameSim(ev.long_name, T.name), nameSim(ev.name, T.name)) }))
      .filter((x) => !strict || x.sim >= 0.34)
      .sort((a, b) => b.sim - a.sim || (b.ev.date_start === T.start) - (a.ev.date_start === T.start))
      .slice(0, OTTO_PROBE_CAP);
    for (const { ev } of ranked) {
      if (!needOtto.some((n) => !has(n, (f) => f.platform === "otto"))) break;
      if (ctx.elapsed() > ctx.budget * 0.6) { out.errors.push("OTTO search stopped (time budget)"); break; }
      let clubs;
      out.probes.otto_clubs++;
      try { clubs = await ctx.once(`ottoClubs:${ev.event_id}`, () => ctx.http(() => S.ottoClubs(ev.event_id, "DSELI"))); }
      catch (e) { out.errors.push(`OTTO clubs ${ev.event_id}: ${errMsg(e)}`); continue; }
      const mine = new Map();
      for (const tm of (clubs || []).flatMap((c) => c.teams || [])) {
        const name = G.byMaster.get(String(tm.master_team_id)) || dseTeamName(tm.team_name, G.known);
        if (name && needOtto.includes(name) && !has(name, (f) => f.platform === "otto") && !mine.has(name)) mine.set(name, tm);
      }
      if (!mine.size) continue;
      let info = null;
      try { info = await ctx.once(`ottoEsw:${ev.event_id}`, () => ctx.http(() => S.ottoEventEsw(ev.event_id))); }
      catch (e) { out.errors.push(`OTTO event ${ev.event_id}: ${errMsg(e)}`); }
      // event_ref is the numeric id: the REST list shows the hex esw id once
      // the schedule is published (some esw ids are all digits, e.g.
      // 204764064), so only eventEsw's event_id is trusted as the stable ref.
      const published = info ? !!(info.schedule_published && info.esw_id) : !!ev.schedule_published;
      const feed = await saveFeed(ctx, T, {
        platform: "otto", event_ref: String(info?.event_id ?? ev.event_id), event_key: published ? String(info?.esw_id || ev.event_id) : undefined,
        published, event_name: info?.long_name || ev.long_name || ev.name, start_date: ev.date_start, end_date: ev.date_end, location: place(ev.city, ev.state),
      });
      for (const [n, tm] of mine) add(n, { feed, platform_team_id: String(tm.team_id), division_id: tm.division_id != null ? String(tm.division_id) : null, division_name: String(tm.division_name || "").trim() || null, how: "OTTO clubs" });
    }
  }

  // d. Choose per team.
  for (const n of T.counted) {
    const row = T.rows.get(n);
    const cur = curFeed(n);
    if (cur && cur.linked_by === "manual") continue;
    const opts = [...(cands.get(n) || [])];
    if (cur && !opts.some((o) => o.feed.id === cur.id)) opts.push({ feed: cur, platform_team_id: row.platform_team_id, division_id: row.division_id, division_name: row.division_name, how: "kept" });
    if (!opts.length) continue;
    const score = (o) => (o.feed.published ? 4 : 0) + (o.feed.platform === "aes" ? 2 : 0) + (cur && o.feed.id === cur.id ? 1 : 0);
    const best = opts.sort((a, b) => score(b) - score(a))[0];
    if (row && row.feed_id === best.feed.id && String(row.platform_team_id ?? "") === String(best.platform_team_id ?? "")) {
      if (best.division_id && !row.division_id) await saveRow(ctx, T, n, { division_id: best.division_id, division_name: best.division_name ?? row.division_name ?? null });
      continue;
    }
    await saveRow(ctx, T, n, { feed_id: best.feed.id, platform_team_id: best.platform_team_id ?? null, division_id: best.division_id ?? null, division_name: best.division_name ?? null, snapshot: null, synced_at: null });
    out.mapped.push({ team: n, platform: best.feed.platform, event: best.feed.event_name, event_ref: best.feed.event_ref, published: !!best.feed.published, team_id: best.platform_team_id ?? null, how: best.how, was: cur ? `${cur.platform} ${cur.event_name}` : null });
  }
  for (const f of T.feeds) if (f._new || f._touched) out.feeds.push({ id: f.id, platform: f.platform, event_ref: f.event_ref, event_key: f.event_key, event_name: f.event_name, dates: `${f.start_date}..${f.end_date}`, location: f.location, published: !!f.published, linked_by: f.linked_by, change: f._new ? "new" : f._touched.join(",") });
  out.unfound = T.counted.filter((n) => !feedById(T, T.rows.get(n)?.feed_id));
  if (!ctx.dry) must(await ctx.sb.from("tournaments").update({ feed_discovered_at: ctx.nowIso }).eq("id", T.id), "feed_discovered_at");
  T.t.feed_discovered_at = ctx.nowIso;
  return out;
}

// ---------- building snapshots (shared by the poll and ?test=) ----------

// One AES team: division + club from the odata rows (else the team header),
// the four schedule lists, and the pool sheet of its current / last pool.
// nowLocal: the venue clock, so a duty AES stopped listing after its start
// is kept (it was worked) and one dropped before its start (reassigned) is not.
async function buildAesTeam(ctx, key, teamId, { event = null, standing = null, next = null, stamp = null, prev = null, divisionId = null, clubId = null, nowLocal = null } = {}) {
  let div = next?.TeamDivision?.DivisionId ?? standing?.Division?.DivisionId ?? divisionId ?? null;
  let club = next?.TeamClub?.ClubId ?? standing?.Club?.ClubId ?? clubId ?? null;
  let header = null;
  const getHeader = async () => { header = await ctx.http(() => S.aesTeamHeader(key, teamId)); return header; };
  if (div == null || club == null) {
    await getHeader();
    div = div ?? header?.TeamDivision?.DivisionId ?? null;
    club = club ?? header?.TeamClub?.ClubId ?? null;
  }
  if (div == null) return { error: "team is not in the AES results" };
  const fetch4 = (d) => Promise.all(["past", "current", "future", "work"].map((w) => ctx.http(() => S.aesTeamSchedule(key, d, teamId, w))));
  let [past, current, future, work] = await fetch4(div);
  // All HTML fallbacks = the stored division is wrong (team moved): ask the header once.
  if (past == null && current == null && work == null && !header) {
    const h = await getHeader();
    const d2 = h?.TeamDivision?.DivisionId;
    if (d2 != null && String(d2) !== String(div)) { div = d2; [past, current, future, work] = await fetch4(div); }
  }
  // A team AES has in that division always gets JSON (often []) for these
  // four; HTML for any of them is an AES error page (aesTeamSchedule turns
  // future's 204 "nothing ahead" into []). Building from it would save the
  // team with no games until the next 30-min refresh — fail instead, so the
  // old snapshot stays and the stamp isn't trusted.
  if (past == null || current == null || future == null || work == null) return { error: "AES schedule not readable (HTML fallback)" };
  const playId = aesPoolPlayId({ past, current });
  const poolsheet = playId != null ? await ctx.once(`aesPool:${key}:${playId}`, () => ctx.http(() => S.aesPoolsheet(key, playId))).catch(() => null) : null;
  const snapshot = aesTeamSnapshot({ event, eventUrl: S.aesEventUrl(key), teamUrl: S.aesTeamUrl(key, club, teamId), past, current, future, work, standing, next, teamId: Number(teamId), stamp, poolsheet, prev, nowLocal });
  return { snapshot, divisionId: String(div), divisionName: String(standing?.Division?.Name || next?.TeamDivision?.Name || header?.TeamDivision?.Name || snapshot.division || "").trim() || null };
}

// Does this OTTO snapshot have a pool place only divisionPoolBrackets can
// give? The pool the team has left (rank unknown; a pool still being played
// has no place yet), or the pool before this one in pool-to-pool rounds —
// OTTO seeds round 2 the moment round 1 is decided, so favoriteTeams rarely
// shows the round-1 place even while the team plays its round-2 pool.
const ottoWantsPools = (snap, fav) => fav.division_id != null && (
  (!!snap.pool && snap.pool.rank == null && !(fav.ongoing_pool_bracket && Number(fav.ongoing_pool_bracket.is_pool) === 1))
  || (!!snap.last_pool && snap.last_pool.rank == null));

// One OTTO team from its favoriteTeams item. divisionPoolBrackets (~100 KB)
// only when ottoWantsPools, only when allowPools (the caller limits that to
// changes / stale snapshots), and once per division per run (ctx.once).
// nowLocal: the venue clock, so a ref duty OTTO dropped after its start is
// kept as worked.
async function buildOttoTeam(ctx, key, fav, { event = null, prev = null, allowPools = true, nowLocal = null } = {}) {
  const base = { event, eventUrl: S.ottoEventUrl(key), teamUrl: S.ottoTeamUrl(key, fav.team_id), fav, prev, nowLocal };
  let snapshot = ottoTeamSnapshot(base);
  if (allowPools && ottoWantsPools(snapshot, fav)) {
    const pools = await ctx.once(`ottoPools:${key}:${fav.division_id}`, () => ctx.http(() => S.ottoDivisionPools(key, fav.division_id))).catch(() => null);
    if (pools) snapshot = ottoTeamSnapshot({ ...base, pools });
  }
  return snapshot;
}

const brief = (s) => (s ? {
  division: s.division, record: s.record ? `${s.record.mw}-${s.record.ml}` : null,
  pool: s.pool ? `${s.pool.name}${s.pool.rank != null ? ` ${s.pool.rank_text}${s.pool.teams ? "/" + s.pool.teams : ""}` : ""}` : null,
  finish: s.finish?.text || null, matches: s.matches.length, finals: s.matches.filter((m) => m.final).length, work: s.work.length, paths: s.paths.length,
  next: s.next?.play ? `${s.next.play.start} ${s.next.play.court || ""} vs ${s.next.play.opponent || "TBD"}`.replace(/\s+/g, " ") : null,
  live: s.next?.live ? `${s.next.live.start} vs ${s.next.live.opponent || "TBD"}` : null,
  next_work: s.next?.work ? `${s.next.work.start} ${s.next.work.court || ""}`.trim() : null, done: s.done,
} : null);

// ---------- polling ----------

async function pollTournament(ctx, G, T, { force = false } = {}) {
  await Promise.all(T.feeds.map(async (feed) => {
    const rows = T.counted.map((n) => T.rows.get(n)).filter((r) => r && String(r.feed_id) === String(feed.id));
    const fo = { id: feed.id, platform: feed.platform, event_ref: feed.event_ref, event_key: feed.event_key, event_name: feed.event_name, published: !!feed.published, linked_by: feed.linked_by, teams: rows.map((r) => r.team_name), action: null, results: [] };
    T.out.feeds.push(fo);
    if (!rows.length) { fo.action = "idle (no teams on it)"; return; }
    const due = force || isEventDay(T, feed) || ageMs(feed.last_checked_at, ctx.now) >= PREWEEK_EVERY;
    if (!due) { fo.action = `not due (checked ${Math.round(ageMs(feed.last_checked_at, ctx.now) / MIN)} min ago)`; return; }
    if (ctx.elapsed() > ctx.budget) { fo.action = "deferred (time budget)"; return; }
    try {
      if (!feed.published || !feed.event_key) {
        await checkPublished(ctx, feed, fo);
        fo.published = !!feed.published; fo.event_key = feed.event_key;
        if (!feed.published || !feed.event_key) return;
      }
      if (feed.platform === "aes") await pollAes(ctx, G, T, feed, rows, fo, force);
      else await pollOtto(ctx, G, T, feed, rows, fo, force);
    } catch (e) {
      fo.error = errMsg(e);
      await saveFeedState(ctx, feed, { last_checked_at: ctx.nowIso, last_error: fo.error }).catch(() => {});
    }
  }));
  T.out.rows = T.counted.map((n) => {
    const r = T.rows.get(n), f = feedById(T, r?.feed_id);
    return { team: n, event_team: isEventTeam(G.teams.get(n)), platform: f?.platform || null, event: f?.event_name || null, published: f ? !!f.published : null, linked_by: f?.linked_by || null, team_id: r?.platform_team_id ?? null, division: r?.division_name ?? null, synced_at: r?.synced_at ?? null, snapshot: brief(r?.snapshot ? withNext(r.snapshot, T.nowLocal) : null) };
  });
}

// Unposted feeds: has the director published since we looked?
async function checkPublished(ctx, feed, fo) {
  let patch = {};
  if (feed.platform === "aes") {
    if (/^\d+$/.test(feed.event_ref)) {
      const l = await ctx.once(`aesLanding:${feed.event_ref}`, () => ctx.http(() => S.aesLanding(feed.event_ref)));
      if (l?.isSchedulerPosted && l?.eventSchedulerKey) patch = { published: true, event_key: l.eventSchedulerKey, ...(l.name ? { event_name: l.name } : {}) };
    } else if (feed.event_key) {
      if (await ctx.http(() => S.aesTimestamp(feed.event_key))) patch = { published: true };
    }
  } else {
    const info = await ctx.once(`ottoEsw:${feed.event_ref}`, () => ctx.http(() => S.ottoEventEsw(feed.event_ref)));
    if (info?.schedule_published && info?.esw_id) patch = { published: true, event_key: String(info.esw_id), ...(info.long_name ? { event_name: info.long_name } : {}) };
  }
  await saveFeedState(ctx, feed, { ...patch, last_checked_at: ctx.nowIso, last_error: null });
  fo.action = patch.published ? "schedule just posted" : "not posted yet";
}

// Teams linked by hand before the schedule was posted have no platform id:
// find them by name now (and AES teams by their global id).
async function resolveMissing(ctx, G, T, feed, rows, fo) {
  const missing = rows.filter((r) => r.platform_team_id == null || r.platform_team_id === "");
  if (!missing.length) return;
  const found = await findTeamsInFeed(ctx, G, feed, missing.map((r) => r.team_name));
  for (const r of missing) {
    const hit = found.get(r.team_name);
    if (!hit) { fo.results.push({ team: r.team_name, error: "not found in this event yet" }); continue; }
    Object.assign(r, await saveRow(ctx, T, r.team_name, { platform_team_id: hit.platform_team_id, division_id: hit.division_id ?? r.division_id ?? null, division_name: hit.division_name ?? r.division_name ?? null }));
  }
}

// DS Elite teams (from `wanted`) present in a feed's event → Map name → { platform_team_id, division_id, division_name }.
async function findTeamsInFeed(ctx, G, feed, wanted) {
  const want = new Set(wanted);
  const found = new Map();
  if (feed.platform === "aes") {
    if (feed.event_key) {
      for (const text of ["DS Elite", "Dripping"]) {
        const res = await ctx.once(`aesSearch:${feed.event_key}:${text}`, () => ctx.http(() => S.aesSearch(feed.event_key, text))).catch(() => null);
        for (const tm of res?.Teams || []) {
          const n = G.byAesId.get(String(tm.TeamId)) || dseTeamName(tm.TeamName, G.known);
          if (n && want.has(n) && !found.has(n)) found.set(n, { platform_team_id: String(tm.TeamId), division_id: tm.DivisionId != null ? String(tm.DivisionId) : null, division_name: null });
        }
        if ([...want].every((n) => found.has(n))) break;
      }
      const rest = [...want].filter((n) => !found.has(n) && G.teams.get(n)?.aes_team_id != null);
      if (rest.length) {
        const ids = rest.map((n) => G.teams.get(n).aes_team_id);
        const rows = (await ctx.http(() => S.aesStandings(feed.event_key, ids)).catch(() => [])) || [];
        for (const n of rest) {
          const r = rows.find((x) => String(x.TeamId) === String(G.teams.get(n).aes_team_id));
          if (r) found.set(n, { platform_team_id: String(r.TeamId), division_id: r.Division?.DivisionId != null ? String(r.Division.DivisionId) : null, division_name: r.Division?.Name || null });
        }
      }
    } else if (/^\d+$/.test(feed.event_ref)) {
      // Not posted: the ranking API says which of our teams are entered.
      for (const n of want) {
        const id = G.teams.get(n)?.aes_team_id;
        if (id == null) continue;
        const evs = await ctx.once(`aesTeamEvents:${id}`, () => ctx.http(() => S.aesTeamEvents(id))).catch(() => []);
        if ((evs || []).some((e) => String(e.eventId) === feed.event_ref)) found.set(n, { platform_team_id: String(id), division_id: null, division_name: null });
      }
    }
  } else {
    const clubs = await ctx.once(`ottoClubs:${feed.event_key || feed.event_ref}`, () => ctx.http(() => S.ottoClubs(feed.event_key || feed.event_ref, "DSELI")));
    for (const tm of (clubs || []).flatMap((c) => c.teams || [])) {
      const n = G.byMaster.get(String(tm.master_team_id)) || dseTeamName(tm.team_name, G.known);
      if (n && want.has(n) && !found.has(n)) found.set(n, { platform_team_id: String(tm.team_id), division_id: tm.division_id != null ? String(tm.division_id) : null, division_name: String(tm.division_name || "").trim() || null });
    }
  }
  return found;
}

async function pollAes(ctx, G, T, feed, rows, fo, force) {
  const key = feed.event_key;
  const stamp = await ctx.http(() => S.aesTimestamp(key));
  if (!stamp) {
    fo.action = "results not readable";
    await saveFeedState(ctx, feed, { last_checked_at: ctx.nowIso, last_error: "AES results not readable (HTML fallback) - taken down, or the key changed" });
    return;
  }
  await resolveMissing(ctx, G, T, feed, rows, fo);
  const live = rows.filter((r) => r.platform_team_id != null && r.platform_team_id !== "");
  const fresh = live.length === rows.length && live.every((r) => r.snapshot && ageMs(r.synced_at, ctx.now) < STALE);
  if (!force && stamp === feed.last_stamp && fresh) {
    fo.action = "unchanged";
    await saveFeedState(ctx, feed, { last_checked_at: ctx.nowIso, last_error: null });
    return;
  }
  if (!live.length) { await saveFeedState(ctx, feed, { last_checked_at: ctx.nowIso }); fo.action = "no team ids yet"; return; }
  const ids = live.map((r) => Number(r.platform_team_id));
  const [standings, nexts] = await Promise.all([ctx.http(() => S.aesStandings(key, ids)), ctx.http(() => S.aesNext(key, ids))]);
  // Null = AES answered with its HTML error page: keep every snapshot and the
  // old stamp, try again next run.
  if (!standings || !nexts) {
    fo.action = "results not readable";
    await saveFeedState(ctx, feed, { last_checked_at: ctx.nowIso, last_error: "AES standings / nextassignments not readable (HTML fallback)" });
    return;
  }
  const todo = [];
  for (const r of live) {
    const standing = standings.find((x) => String(x.TeamId) === String(r.platform_team_id)) || null;
    const next = nexts.find((x) => String(x.TeamId) === String(r.platform_team_id)) || null;
    // The cheap "did anything about this team change" test: its own
    // standings + nextassignments rows (W-L, finish, next match, work duties).
    const sig = snapshotHash({ s: standing, n: next });
    const stale = !r.snapshot || ageMs(r.synced_at, ctx.now) >= STALE;
    if (!force && !stale && r.snapshot.src_sig === sig) continue;
    todo.push({ r, standing, next, sig });
  }
  const event = todo.length ? await ctx.http(() => S.aesEvent(key)) : null;
  const errors = [];
  let changed = 0, deferred = 0, at = 0;
  const refresh = async ({ r, standing, next, sig }) => {
    const res = { team: r.team_name };
    fo.results.push(res);
    try {
      const b = await buildAesTeam(ctx, key, r.platform_team_id, { event, standing, next, stamp, prev: r.snapshot, divisionId: r.division_id, nowLocal: T.nowLocal });
      if (b.error) { res.error = b.error; errors.push(`${r.team_name}: ${b.error}`); return; }
      const snap = { ...b.snapshot, src_sig: sig };
      res.changed = hashOf(snap) !== hashOf(r.snapshot);
      if (res.changed) changed++;
      res.snapshot = brief(withNext(snap, T.nowLocal));
      Object.assign(r, await saveRow(ctx, T, r.team_name, { snapshot: snap, synced_at: ctx.nowIso, division_id: b.divisionId, division_name: b.divisionName }));
    } catch (e) { res.error = errMsg(e); errors.push(`${r.team_name}: ${res.error}`); }
  };
  // Two teams at a time (each still shares the 4-call limiter), so snapshots
  // land one after another; when AES is crawling, the teams not started by
  // 85 s wait for the next run instead of all of them finishing too late.
  await Promise.all(Array.from({ length: Math.min(AES_TEAMS_IN_FLIGHT, todo.length) }, async () => {
    while (at < todo.length) {
      const job = todo[at++];
      if (ctx.elapsed() > ctx.budget * 0.85) {
        deferred++;
        fo.results.push({ team: job.r.team_name, deferred: "time budget" });
        errors.push(`${job.r.team_name}: not refreshed yet (time budget)`);
        continue;
      }
      await refresh(job);
    }
  }));
  // A team that failed or waited keeps the old stamp, so the next run tries
  // it again instead of trusting "stamp unchanged".
  await saveFeedState(ctx, feed, {
    ...(errors.length ? {} : { last_stamp: stamp }), last_checked_at: ctx.nowIso,
    ...(changed ? { last_changed_at: ctx.nowIso } : {}), last_error: errors.length ? trunc(errors.join("; ")) : null,
  });
  fo.action = todo.length ? `refreshed ${todo.length - deferred} team(s), ${changed} changed${deferred ? `, ${deferred} left for the next run (time budget)` : ""}` : "stamp moved, no team row changed";
}

async function pollOtto(ctx, G, T, feed, rows, fo, force) {
  const key = feed.event_key;
  await resolveMissing(ctx, G, T, feed, rows, fo);
  const live = rows.filter((r) => r.platform_team_id != null && r.platform_team_id !== "");
  if (!live.length) { await saveFeedState(ctx, feed, { last_checked_at: ctx.nowIso }); fo.action = "no team ids yet"; return; }
  const favs = await ctx.http(() => S.ottoFavoriteTeams(key, live.map((r) => r.platform_team_id)));
  // The feed row already has the name and dates; no eventEsw call per poll.
  const event = { long_name: feed.event_name, date_start: dayMs(feed.start_date), date_end: dayMs(feed.end_date || feed.start_date) };
  const errors = [], hashes = [];
  let changed = 0;
  for (const r of live) {
    const res = { team: r.team_name };
    fo.results.push(res);
    const fav = favs.find((f) => String(f.team_id) === String(r.platform_team_id));
    if (!fav) { res.error = "not in favoriteTeams"; errors.push(`${r.team_name}: not in OTTO favoriteTeams`); continue; }
    try {
      const stale = force || !r.snapshot || ageMs(r.synced_at, ctx.now) >= STALE;
      const opts = { event, prev: r.snapshot, nowLocal: T.nowLocal };
      let snap = await buildOttoTeam(ctx, key, fav, { ...opts, allowPools: false });
      if (ottoWantsPools(snap, fav) && (stale || hashOf(snap) !== hashOf(r.snapshot))) snap = await buildOttoTeam(ctx, key, fav, { ...opts, allowPools: true });
      res.changed = hashOf(snap) !== hashOf(r.snapshot);
      hashes.push(hashOf(snap));
      res.snapshot = brief(withNext(snap, T.nowLocal));
      if (res.changed) { changed++; Object.assign(r, await saveRow(ctx, T, r.team_name, { snapshot: snap, synced_at: ctx.nowIso, division_id: fav.division_id != null ? String(fav.division_id) : r.division_id, division_name: String(fav.division_name || "").trim() || r.division_name })); }
      else Object.assign(r, await saveRow(ctx, T, r.team_name, { synced_at: ctx.nowIso }));
    } catch (e) { res.error = errMsg(e); errors.push(`${r.team_name}: ${res.error}`); }
  }
  await saveFeedState(ctx, feed, {
    last_stamp: snapshotHash(hashes), last_checked_at: ctx.nowIso, ...(changed ? { last_changed_at: ctx.nowIso } : {}),
    last_error: errors.length ? trunc(errors.join("; ")) : null,
  });
  fo.action = `polled ${live.length} team(s), ${changed} changed`;
}

// ---------- alerts ----------

// Pure: which of a team's due alerts go out now, which are recorded as not
// sent (backlog / stale), which wait for morning. sentRows = its
// hub_alerts_sent rows for this tournament.
export function planTeamAlerts({ snapshot, teamName, nowLocal, tournament = null, sentRows = [] } = {}) {
  const plan = { quiet: false, backlog: false, send: [], suppress: [], held: [] };
  if (!snapshot) return plan;
  const sentKeys = new Set((sentRows || []).map((r) => `${r.kind}|${r.key}`));
  const eventDays = [...new Set([...(snapshot.days || []), ...(tournament ? dateRange(tournament.start_date, tournament.end_date || tournament.start_date) : [])])].sort();
  const due = alertsFor({ snapshot, teamName, nowLocal, eventDays, sentKeys });
  if (!due.length) return plan;
  const hm = String(nowLocal || "").slice(11, 16);
  if (hm < SEND_FROM || hm >= SEND_UNTIL) { plan.quiet = true; plan.held = due; return plan; }
  plan.backlog = !(sentRows || []).length && (snapshot.matches || []).some((m) => m.final);
  for (const a of due) {
    let why = null;
    if (a.kind === "final") {
      const m = (snapshot.matches || []).find((x) => x.id === a.key);
      const ended = m ? (m.end || addMinutes(m.start, 60)) : null;
      const ago = ended ? (localMs(nowLocal) - localMs(ended)) / MIN : Infinity;
      if (plan.backlog && ago > BACKLOG_MIN) why = "first sync mid-event";
      else if (ago > STALE_FINAL_MIN) why = "result too old";
    } else if (plan.backlog && a.kind !== "next") why = "first sync mid-event";
    if (why) plan.suppress.push({ ...a, why }); else plan.send.push(a);
  }
  return plan;
}

// Record (insert-before-send, on conflict do nothing) and push one combined
// notification for the alerts this call won. opts.targets = loadPushTargets
// result; opts.sender / opts.cleanup pass through to sendPush (tests).
export async function deliverTeamAlerts(sb, { tournamentId, teamName, plan }, { targets = null, sender = null, cleanup = true } = {}) {
  const res = { recorded: 0, sent_alerts: [], recipients: 0, push: null };
  const rows = [
    ...plan.send.map((a) => ({ tournament_id: tournamentId, team_name: teamName, kind: a.kind, key: a.key, body: a.body, recipients: null })),
    ...plan.suppress.map((a) => ({ tournament_id: tournamentId, team_name: teamName, kind: a.kind, key: a.key, body: trunc(`[not sent: ${a.why}] ${a.body}`, 500), recipients: 0 })),
  ];
  if (!rows.length) return res;
  const won = must(await sb.from("hub_alerts_sent").upsert(rows, { onConflict: "tournament_id,team_name,kind,key", ignoreDuplicates: true }).select("id, kind, key"), "hub_alerts_sent") || [];
  res.recorded = won.length;
  const mine = plan.send.filter((a) => won.some((w) => w.kind === a.kind && w.key === a.key));
  if (!mine.length) return res;
  const ids = won.filter((w) => mine.some((a) => a.kind === w.kind && a.key === w.key)).map((w) => w.id);
  const list = targetsForTeam(targets || await loadPushTargets(sb), teamName);
  res.sent_alerts = mine.map((a) => `${a.kind}: ${a.body}`);
  if (list.length) {
    res.push = await sendPush(sb, list, hubPayload(teamName, mine.map((a) => a.body).join("\n")), { sender, cleanup });
    res.recipients = res.push.sent;
  }
  must(await sb.from("hub_alerts_sent").update({ recipients: res.recipients }).in("id", ids), "hub_alerts_sent recipients");
  return res;
}

async function alertTournament(ctx, G, T, alertsOn) {
  for (const n of T.counted) {
    const pt = G.teams.get(n);
    if (!pt || isEventTeam(pt)) continue;          // 14 Crystal: HQ view only, never alerted
    const r = T.rows.get(n), feed = feedById(T, r?.feed_id);
    if (!r?.snapshot || !feed?.published) continue;
    const plan = planTeamAlerts({ snapshot: r.snapshot, teamName: n, nowLocal: T.nowLocal, tournament: T.t, sentRows: G.sent.get(`${T.id}|${n}`) || [] });
    if (!plan.send.length && !plan.suppress.length && !plan.held.length) continue;
    const ao = { team: n, quiet: plan.quiet, backlog: plan.backlog, send: plan.send.map((a) => `${a.kind}: ${a.body}`), suppress: plan.suppress.map((a) => `${a.kind} (${a.why}): ${a.body}`), held: plan.held.map((a) => `${a.kind}: ${a.body}`) };
    T.out.alerts.push(ao);
    if (ctx.dry || !alertsOn) { ao.mode = ctx.dry ? "dry run - not sent" : "alerts off - not sent"; continue; }
    if (plan.quiet) { ao.mode = "quiet hours - held"; continue; }
    if (!hubPushReady() && !ctx.sender) { ao.mode = "VAPID keys missing - nothing recorded"; continue; }
    // Recorded-then-sent: too close to the 120 s kill, a recorded alert might
    // never go out. Leave it unrecorded for the next run instead.
    if (ctx.elapsed() > ctx.budget + ALERT_STOP_MS) { ao.mode = "time budget - left for the next run"; continue; }
    try {
      const targets = await ctx.once("pushTargets", () => loadPushTargets(ctx.sb));
      Object.assign(ao, await deliverTeamAlerts(ctx.sb, { tournamentId: T.id, teamName: n, plan }, { targets, sender: ctx.sender }));
      ao.mode = "delivered";
    } catch (e) { ao.error = errMsg(e); }
  }
}

// ---------- the run ----------

export async function runSync(sb, opts = {}) {
  const ctx = makeCtx(sb, opts);
  const alertsOn = opts.alerts !== false && !ctx.dry;
  const tournamentId = opts.tournamentId != null && opts.tournamentId !== "" ? Number(opts.tournamentId) : null;
  const G = await loadState(ctx, { tournamentId, windowDays: opts.windowDays ?? WINDOW_BEFORE_DAYS });
  const out = { ok: true, dry: ctx.dry, alerts: alertsOn, now: ctx.nowIso, today: G.today, window: G.window, tournaments: [], skipped: G.skipped };
  // Event-day tournaments first: if the time budget runs out, it's the
  // pre-week checks that wait five minutes, not Saturday's scores.
  const order = [...G.tournaments].sort((a, b) => (isEventDay(b) - isEventDay(a)) || a.start.localeCompare(b.start) || a.id - b.id);
  let discovered = 0;
  const maxDiscover = opts.maxDiscover ?? MAX_DISCOVER;
  for (const T of order) {
    out.tournaments.push(T.out);
    try {
      const due = discoveryDue(ctx, T, opts);
      if (!due.due) T.out.discovery = { ran: false, reason: due.reason };
      else if (discovered >= maxDiscover || ctx.elapsed() > ctx.budget * 0.6) T.out.discovery = { ran: false, reason: "due, deferred to the next run" };
      else { discovered++; T.out.discovery = { reason: due.reason, ...(await discover(ctx, G, T)) }; }
      await pollTournament(ctx, G, T, { force: tournamentId != null || !!opts.force });
      await alertTournament(ctx, G, T, alertsOn);
    } catch (e) { T.out.error = errMsg(e); out.ok = false; }
  }
  out.calls = ctx.calls;
  out.ms = ctx.elapsed();
  return out;
}

// ---------- ?test= / demo: another club's event, no database ----------

// "aes:<key or eventId>:<clubId>" or "otto:<eswId>:<teamId,teamId>". Fetches
// and normalizes exactly as the sync does and returns the snapshots with
// `next` judged at the venue's now — how we prove a deployment can reach both
// platforms, and what /hub?demo= can show. opts.tz overrides the zone guess.
export async function testFeed(spec, { tz = null, now = new Date(), maxTeams = 12 } = {}) {
  const ctx = makeCtx(null, { now });
  const m = /^(aes|otto):([^:]+):?(.*)$/i.exec(String(spec || "").trim());
  if (!m) throw Object.assign(new Error("test must be aes:<key>:<clubId> or otto:<eswId>:<teamId,teamId>"), { status: 400 });
  const platform = m[1].toLowerCase();
  if (platform === "aes") {
    let key = m[2];
    const clubId = Number(m[3]);
    if (!Number.isFinite(clubId) || !m[3]) throw Object.assign(new Error("aes test needs a club id: aes:<key>:<clubId>"), { status: 400 });
    let landing = null;
    if (/^\d+$/.test(key)) {
      landing = await ctx.http(() => S.aesLanding(key)).catch(() => null);
      key = landing?.eventSchedulerKey || aesKey(Number(key));
    } else landing = await aesLandingByKey(ctx, key).catch(() => null);
    const event = await ctx.http(() => S.aesEvent(key));
    if (!event) throw Object.assign(new Error("AES results not readable for that key (not published?)"), { status: 404 });
    const zone = tz || tzForTournament({ location: place(landing?.address?.city || landing?.city, landing?.address?.state?.abbreviation || landing?.state) || event.Location });
    const nowLocal = localNow(zone, ctx.now);
    const [standings, nexts, stamp] = await Promise.all([
      ctx.http(() => S.aesStandings(key, [], { clubId })).then((x) => x || []), ctx.http(() => S.aesNext(key, [], { clubId })).then((x) => x || []), ctx.http(() => S.aesTimestamp(key)),
    ]);
    const ids = [...new Set([...standings, ...nexts].map((r) => r?.TeamId).filter((x) => x != null))].slice(0, maxTeams);
    const teams = await Promise.all(ids.map(async (id) => {
      const standing = standings.find((r) => r.TeamId === id) || null, next = nexts.find((r) => r.TeamId === id) || null;
      const b = await buildAesTeam(ctx, key, id, { event, standing, next, stamp, clubId, nowLocal });
      return { team_id: id, team_name: standing?.TeamName || next?.TeamName || null, error: b.error || null, snapshot: b.snapshot ? withNext(b.snapshot, nowLocal) : null };
    }));
    return { ok: true, platform, key, club_id: clubId, event: { name: event.Name, start: ymd(event.StartDate), end: ymd(event.EndDate), location: event.Location || null, is_over: !!event.IsOver }, tz: zone, now_local: nowLocal, stamp, teams, calls: ctx.calls, ms: ctx.elapsed() };
  }
  const eswId = m[2];
  const ids = String(m[3] || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, maxTeams);
  if (!ids.length) throw Object.assign(new Error("otto test needs team ids: otto:<eswId>:<teamId,teamId>"), { status: 400 });
  const event = await ctx.http(() => S.ottoEventEsw(eswId));
  if (!event) throw Object.assign(new Error("OTTO event not found"), { status: 404 });
  const zone = tz || tzForTournament({ location: place(event.city, event.state) });
  const nowLocal = localNow(zone, ctx.now);
  const key = event.esw_id || eswId;
  const favs = await ctx.http(() => S.ottoFavoriteTeams(key, ids));
  const teams = [];
  for (const fav of favs) {
    const snap = await buildOttoTeam(ctx, key, fav, { event, allowPools: true, nowLocal });
    // source: which OTTO API answered — "rest" while GraphQL is down (tournament-sources.js).
    teams.push({ team_id: fav.team_id, team_name: fav.team_name, source: fav._source || "graphql", error: null, snapshot: withNext(snap, nowLocal) });
  }
  return { ok: true, platform, key, event: { name: event.long_name, start: msDay(event.date_start), end: msDay(event.date_end), location: place(event.city, event.state), published: !!event.schedule_published, otto_timezone: event.timezone || null }, tz: zone, now_local: nowLocal, otto_graphql: S.ottoGqlState(), teams, calls: ctx.calls, ms: ctx.elapsed() };
}

// The landing row for a results key (scheduler-only events have no eventId,
// so this is how a pasted results link finds its eventSchedulerId).
async function aesLandingByKey(ctx, key) {
  const f = `eventSchedulerKey eq '${String(key).replace(/'/g, "''")}'`;
  const j = await ctx.http(() => S.getJson(`https://www.advancedeventsystems.com/api/landing/events?$filter=${encodeURIComponent(f)}&$top=1`));
  const row = (Array.isArray(j) ? j : j?.value || [])[0];
  return row || null;
}

// ---------- admin: link / unlink ----------

// A pasted link (or id) → { platform: 'aes'|'otto'|null, key?, eventId?, id? }.
// AES: results.advancedeventsystems.com/event/{key}/..., advancedeventsystems.com/{eventId},
// .../events/{eventId}. OTTO: events.ottoevent.ai/event/{id}, eventslegacy.ottoevent.ai/#/events/{eswId},
// events.sportwrench.com/#/events/{id}. Bare: 9-char esw id → OTTO; a results
// key → AES; "aes:46756" / "otto:27123" to be explicit; a bare short number is
// ambiguous (platform null) and is settled by dates in linkFeed.
export function parseFeedUrl(input) {
  let s = String(input || "").trim();
  if (!s) throw Object.assign(new Error("Paste the AES or OTTO link for this event."), { status: 400 });
  let m;
  if ((m = /^aes\s*:\s*(\S+)$/i.exec(s))) return /^\d+$/.test(m[1]) ? { platform: "aes", eventId: Number(m[1]) } : { platform: "aes", key: m[1] };
  if ((m = /^otto\s*:\s*(\S+)$/i.exec(s))) return { platform: "otto", id: m[1] };
  if (/^\d{9}$/.test(s) || /^(?=[0-9a-f]*[a-f])[0-9a-f]{9}$/i.test(s)) return { platform: "otto", id: s.toLowerCase() };
  if (/^\d{3,8}$/.test(s)) return { platform: null, id: s };
  if (/^[A-Za-z0-9_-]{10,}[0-2]$/.test(s)) return { platform: "aes", key: s };
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch { throw Object.assign(new Error("That doesn't look like an AES or OTTO link."), { status: 400 }); }
  const host = u.hostname.toLowerCase();
  const path = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const hash = u.hash.replace(/^#!?\/?/, "").split(/[/?]/).filter(Boolean).map(decodeURIComponent);
  if (/(^|\.)advancedeventsystems\.com$/.test(host)) {
    const i = path.indexOf("event");
    if (i >= 0 && path[i + 1]) return { platform: "aes", key: path[i + 1] };
    const num = path.find((p) => /^\d+$/.test(p));
    if (num) return { platform: "aes", eventId: Number(num) };
  }
  if (/(^|\.)(ottoevent\.ai|sportwrench\.com)$/.test(host)) {
    for (const segs of [hash, path]) {
      const i = segs.findIndex((p) => p === "events" || p === "event");
      if (i >= 0 && segs[i + 1]) return { platform: "otto", id: segs[i + 1] };
    }
  }
  throw Object.assign(new Error("Couldn't find an event in that link. Paste the AES results link or the OTTO event link."), { status: 400 });
}

// Parsed link → feed fields.
async function resolveEvent(ctx, p, T) {
  const aesById = async (eventId) => {
    const l = await ctx.http(() => S.aesLanding(eventId));
    if (!l) return null;
    const posted = !!(l.isSchedulerPosted && l.eventSchedulerKey);
    return { platform: "aes", event_ref: String(eventId), event_key: posted ? l.eventSchedulerKey : null, published: posted, event_name: l.name || null, start_date: ymd(l.startDate) || null, end_date: ymd(l.endDate || l.startDate) || null, location: place(l.address?.city, l.address?.state?.abbreviation) };
  };
  const ottoById = async (id) => {
    const info = await ctx.http(() => S.ottoEventEsw(id));
    if (!info) return null;
    const published = !!(info.schedule_published && info.esw_id);
    return { platform: "otto", event_ref: String(info.event_id), event_key: published ? String(info.esw_id) : null, published, event_name: info.long_name || null, start_date: msDay(info.date_start), end_date: msDay(info.date_end || info.date_start), location: place(info.city, info.state) };
  };
  const near = (ev) => ev && ev.start_date && ev.start_date <= addDays(T.end, 3) && (ev.end_date || ev.start_date) >= addDays(T.start, -3);
  if (p.platform === null) {
    const [a, o] = await Promise.all([aesById(p.id).catch(() => null), ottoById(p.id).catch(() => null)]);
    const hits = [a, o].filter(near);
    if (hits.length === 1) return hits[0];
    throw Object.assign(new Error(hits.length ? `${p.id} is an event on both AES and OTTO those dates - paste the full link.` : `No AES or OTTO event ${p.id} near these dates - paste the full link.`), { status: 400 });
  }
  if (p.platform === "aes" && p.eventId != null) {
    const ev = await aesById(p.eventId);
    if (!ev) throw Object.assign(new Error(`AES event ${p.eventId} not found.`), { status: 404 });
    return ev;
  }
  if (p.platform === "aes") {
    const [l, evt] = await Promise.all([aesLandingByKey(ctx, p.key).catch(() => null), ctx.http(() => S.aesEvent(p.key)).catch(() => null)]);
    if (!l && !evt) throw Object.assign(new Error("AES doesn't know that results link."), { status: 404 });
    return {
      platform: "aes", event_ref: l?.eventId ? String(l.eventId) : l?.eventSchedulerId ? "sched:" + l.eventSchedulerId : "key:" + p.key,
      event_key: p.key, published: !!evt, event_name: l?.name || evt?.Name || null,
      start_date: ymd(l?.startDate || evt?.StartDate) || null, end_date: ymd(l?.endDate || evt?.EndDate) || null,
      location: place(l?.address?.city, l?.address?.state?.abbreviation) || evt?.Location || null,
    };
  }
  const ev = await ottoById(p.id);
  if (!ev) throw Object.assign(new Error(`OTTO event ${p.id} not found.`), { status: 404 });
  return ev;
}

async function readTournamentFeeds(sb, tournamentId) {
  const [f, r] = await Promise.all([
    sb.from("tournament_feeds").select("*").eq("tournament_id", tournamentId).order("id"),
    sb.from("tournament_team_feed").select("*").eq("tournament_id", tournamentId).order("team_name"),
  ]);
  return { feeds: must(f, "tournament_feeds") || [], rows: must(r, "tournament_team_feed") || [] };
}

// {action:'link'}: the feed becomes linked_by 'manual' and the teams in it
// (all teams going that it has, or exactly `teams`) move onto it; discovery
// never moves them off again. Then a sync of just this tournament.
export async function linkFeed(sb, { tournamentId, url, teams = null, now = null } = {}) {
  const ctx = makeCtx(sb, { now });
  const G = await loadState(ctx, { tournamentId: Number(tournamentId) });
  const T = G.tournaments[0];
  if (!T) throw Object.assign(new Error(G.skipped[0]?.why === "cancelled" ? "That tournament is cancelled." : "No teams are going to that tournament (or it doesn't exist)."), { status: 400 });
  const ev = await resolveEvent(ctx, parseFeedUrl(url), T);
  const feed = await saveFeed(ctx, T, { ...ev, linked_by: "manual" });
  const given = Array.isArray(teams) && teams.length ? [...new Set(teams.map(String))] : null;
  const notGoing = given ? given.filter((n) => !T.counted.includes(n)) : [];
  const wanted = given ? given.filter((n) => T.counted.includes(n)) : T.counted;
  const found = await findTeamsInFeed(ctx, G, feed, wanted);
  const mapped = [];
  for (const n of wanted) {
    const hit = found.get(n);
    if (!hit && !given) continue;
    const row = T.rows.get(n);
    const same = row && String(row.feed_id) === String(feed.id) && (!hit || String(row.platform_team_id ?? "") === String(hit.platform_team_id));
    await saveRow(ctx, T, n, {
      feed_id: feed.id, platform_team_id: hit?.platform_team_id ?? (same ? row.platform_team_id : null),
      division_id: hit?.division_id ?? (same ? row.division_id : null), division_name: hit?.division_name ?? (same ? row.division_name : null),
      ...(same ? {} : { snapshot: null, synced_at: null }),
    });
    mapped.push({ team: n, team_id: hit?.platform_team_id ?? null, found: !!hit });
  }
  const sync = await runSync(sb, { tournamentId: T.id, discover: false });
  const { feeds, rows } = await readTournamentFeeds(sb, T.id);
  return { ok: true, feed: feeds.find((f) => String(f.id) === String(feed.id)) || feed, mapped, not_going: notGoing, not_found: wanted.filter((n) => !found.has(n)), sync, feeds, rows };
}

// {action:'unlink'}: the teams on it lose their mapping and snapshot, the feed
// row goes. A hand-linked feed being removed means "that was the wrong paste",
// so discovery runs again on the next cron; an auto one may be found again by
// the next scheduled discovery — link the right event to override it for good.
export async function unlinkFeed(sb, { tournamentId, feedId } = {}) {
  const tid = Number(tournamentId);
  const feed = must(await sb.from("tournament_feeds").select("*").eq("id", Number(feedId)).eq("tournament_id", tid).maybeSingle(), "tournament_feeds");
  if (!feed) throw Object.assign(new Error("That feed isn't linked to this tournament."), { status: 404 });
  const now = new Date().toISOString();
  must(await sb.from("tournament_team_feed").update({ feed_id: null, platform_team_id: null, division_id: null, division_name: null, snapshot: null, synced_at: null, updated_at: now }).eq("tournament_id", tid).eq("feed_id", feed.id), "clear team rows");
  must(await sb.from("tournament_feeds").delete().eq("id", feed.id), "delete feed");
  if (feed.linked_by === "manual") must(await sb.from("tournaments").update({ feed_discovered_at: null }).eq("id", tid), "feed_discovered_at");
  const { feeds, rows } = await readTournamentFeeds(sb, tid);
  return { ok: true, removed: { id: feed.id, platform: feed.platform, event_name: feed.event_name, linked_by: feed.linked_by }, feeds, rows };
}

// {action:'sync'}: discovery (forced) + poll of one tournament.
export async function syncTournament(sb, { tournamentId } = {}) {
  const sync = await runSync(sb, { tournamentId: Number(tournamentId), discover: true });
  if (!sync.tournaments.length) {
    const why = sync.skipped[0]?.why;
    throw Object.assign(new Error(why === "cancelled" ? "That tournament is cancelled." : why === "no such tournament" ? "That tournament doesn't exist." : "No teams are going to that tournament yet."), { status: 400 });
  }
  const { feeds, rows } = await readTournamentFeeds(sb, Number(tournamentId));
  return { ok: sync.ok, sync, feeds, rows };
}

// ---------- auth (both handlers) ----------

// Vercel Cron (Bearer CRON_SECRET or ?token=), the service-role key as bearer
// (operator scripts), or a signed-in owner / approved admin — the
// api/day-schedule.js rule. → { ok, who } | { ok:false, status, error }.
export async function authCaller(sb, req, { cron = true } = {}) {
  const { CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const token = (() => { try { return new URL(req.url, "https://x").searchParams.get("token") || ""; } catch { return ""; } })();
  const bearer = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (cron && CRON_SECRET && (bearer === CRON_SECRET || token === CRON_SECRET)) return { ok: true, who: "cron" };
  if (bearer && SUPABASE_SERVICE_ROLE_KEY && bearer === SUPABASE_SERVICE_ROLE_KEY) return { ok: true, who: "operator" };
  if (!bearer) return { ok: false, status: 401, error: "Not signed in" };
  const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
  const email = String(user?.email || "").trim().toLowerCase();
  if (!email) return { ok: false, status: 401, error: "Not signed in" };
  if (OWNERS.includes(email)) return { ok: true, who: email };
  const { data: c } = await sb.from("coaches").select("is_admin, is_approved").ilike("email", email).maybeSingle();
  return c && c.is_approved && c.is_admin ? { ok: true, who: email } : { ok: false, status: 403, error: "Admins only" };
}
