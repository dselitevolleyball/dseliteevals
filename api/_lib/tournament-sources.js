// Tournament Hub — server-side fetch clients for the two platforms DS Elite's
// tournaments publish on: AES (Advanced Event Systems) and OTTO (the renamed
// SportWrench). Consumed by api/_lib/tournament-sync-core.js (the 5-minute
// cron), api/tournament-feed.js (admin "link this event") and api/hub-data.js
// (?demo=), and by the scripts that test them. Raw platform JSON comes back
// from here; shared/tournament-feed.js turns it into TeamSnapshots.
//
// Node 20+ (global fetch). No auth anywhere — both platforms are public.
//
// AES
//   www.advancedeventsystems.com/api      directory, team season events, landing (results key)
//   results.advancedeventsystems.com/api  schedules, pools, brackets, search, timestamp
//   results.advancedeventsystems.com/odata/{key}/standings(...) / nextassignments(...)
//   Errors come back as HTTP 200 text/html (CloudFront serving the SPA's
//   index.html) — "not published yet", bad key and bad team id all look like
//   that — so every response is content-type checked and HTML reads as null.
//   /schedule/future answers 204 when nothing is ahead ([] here). The
//   results key is read from the landing API (eventSchedulerKey) once the
//   director posts the schedule; scheduler-only events (no eventId: most Lone
//   Star Classic, CTPL, Regionals) can't be computed and are found by date.
//
// OTTO
//   eventslegacy.ottoevent.ai/api/esw/... REST (hex esw id; the 2 MB event list)
//   events.ottoevent.ai/api/esw/graphql   GraphQL (hex esw id or numeric id)
//   No CORS at all, so parents' browsers can't call it — server only. Never
//   sportwrench.com / my.sportwrench.com: Cloudflare challenges Node fetch
//   there. GraphQL pages are capped at 20 items. Per-event team ids change;
//   master_team_id is stable (practice_teams.otto_master_team_id).
//
// Every call: a UA naming us, Accept json, 12 s per attempt and one retry on
// 5xx or a network error, all inside 15 s for the whole call. A timeout is not
// retried (a second 12 s wait would only push the sync past its budget; the
// next run tries again). Returns parsed JSON, or null for "nothing there"
// (204, the AES HTML fallback, 404 where noted); throws on anything else so
// the sync can record last_error. AES standings / nextassignments / team
// schedules are the exceptions: null there means only the HTML fallback
// (not readable), and a schedule's 204 is [] (nothing ahead).
//
// GraphQL documents below were run live on 10 Oct 2026 against the Tampa
// event 7bf1286c5 (in play), SoCal Cup 601906a1b (finished) and SPAM Slam
// 27297 (registration only).

export const UA = "Mozilla/5.0 (DS Elite HQ tournament hub; +https://dseliteevals.vercel.app)";
const AES_WWW = "https://www.advancedeventsystems.com/api";
const AES_API = "https://results.advancedeventsystems.com/api";
const AES_ODATA = "https://results.advancedeventsystems.com/odata";
const AES_RESULTS = "https://results.advancedeventsystems.com";
const OTTO_REST = "https://eventslegacy.ottoevent.ai/api/esw";
const OTTO_GQL = "https://events.ottoevent.ai/api/esw/graphql";
const TIMEOUT_MS = 12000;    // one attempt
const CALL_MS = 15000;       // the whole call, retry included
const RETRY_MIN_MS = 3000;   // no retry with less than this left
const RETRY_GAP_MS = 700;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One HTTP call → parsed JSON | null. opts: { method, body, nullOn404, on204 }
// (on204: what a 204 returns, default null).
export async function getJson(url, { method = "GET", body, nullOn404 = false, on204 = null } = {}) {
  const deadline = Date.now() + CALL_MS;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) {
      // Only a quick failure is worth a second try inside the call's 15 s.
      if (deadline - Date.now() - RETRY_GAP_MS < RETRY_MIN_MS) break;
      await sleep(RETRY_GAP_MS);
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), Math.min(TIMEOUT_MS, deadline - Date.now()));
    try {
      const headers = { "User-Agent": UA, Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const r = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ac.signal });
      if (r.status === 204) return on204;
      if (r.status === 404 && nullOn404) return null;
      if (r.status >= 500) {
        r.body?.cancel().catch(() => {}); // free the connection
        lastErr = Object.assign(new Error(`HTTP ${r.status} ${shortUrl(url)}`), { status: r.status });
        continue;
      }
      const ct = r.headers.get("content-type") || "";
      const text = await r.text();
      if (!r.ok) {
        // OTTO GraphQL validation errors come back 400 with a JSON body worth reading.
        let msg = text.slice(0, 200);
        try { const j = JSON.parse(text); msg = j?.errors?.[0]?.message || j?.validation || msg; } catch { /* not json */ }
        throw Object.assign(new Error(`HTTP ${r.status} ${shortUrl(url)}: ${msg}`), { status: r.status, noRetry: true });
      }
      if (!ct.includes("json")) return null; // AES CloudFront SPA fallback
      if (!text.trim()) return null;          // AES landing for an old event: 200, empty
      return JSON.parse(text);
    } catch (e) {
      if (e.noRetry) throw e;
      // Our timer fired (on the fetch or while reading the body): no retry.
      if (ac.signal.aborted || e.name === "AbortError") throw Object.assign(new Error(`timeout ${shortUrl(url)}`), { status: 0, timeout: true });
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
const shortUrl = (u) => String(u).replace(/^https?:\/\//, "").slice(0, 140);
const valueOf = (j) => (Array.isArray(j) ? j : Array.isArray(j?.value) ? j.value : []);
const ymd = (d) => String(d || "").slice(0, 10);
const odataDate = (d) => `${ymd(d)}T00:00:00Z`;
const odataStr = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// ---------------- AES ----------------

// A team's season events (registered, upcoming and past) by its global AES team id.
export async function aesTeamEvents(teamId) {
  return valueOf(await getJson(`${AES_WWW}/ranking/${encodeURIComponent(teamId)}/events`, { nullOn404: true }));
}

// Registration landing for an eventId: isSchedulerPosted + eventSchedulerKey
// (the results key) once the director publishes. Null for old events (404/empty).
export async function aesLanding(eventId) {
  return getJson(`${AES_WWW}/landing/events/${encodeURIComponent(eventId)}`, { nullOn404: true });
}

// The landing list (OData) — the only place scheduler-only events (no eventId)
// can be found. Events overlapping [start, end]; optional state ('TX'),
// schedulerOnly, posted, nameContains.
export async function aesLandingEvents({ start, end, state = null, schedulerOnly = null, posted = null, nameContains = null, top = 200 } = {}) {
  const f = [];
  // AES compares these as instants and its midnight is the venue's (an event
  // starting 10/10 sorts after 10/10T00:00Z), so "le end" would drop every
  // event that starts on the last day — bound it by the next midnight instead.
  if (end) f.push(`startDate lt ${odataDate(new Date(Date.parse(ymd(end) + "T00:00:00Z") + 86400000).toISOString())}`);
  if (start) f.push(`endDate ge ${odataDate(start)}`);
  if (schedulerOnly != null) f.push(`isSchedulerOnly eq ${schedulerOnly ? "true" : "false"}`);
  if (posted != null) f.push(`isSchedulerPosted eq ${posted ? "true" : "false"}`);
  if (state) f.push(`address/state/abbreviation eq ${odataStr(String(state).toUpperCase())}`);
  if (nameContains) f.push(`contains(tolower(name),${odataStr(String(nameContains).toLowerCase())})`);
  const qs = [f.length ? "$filter=" + encodeURIComponent(f.join(" and ")) : null, "$orderby=startDate", "$top=" + Math.min(Math.max(1, top), 500)].filter(Boolean).join("&");
  return valueOf(await getJson(`${AES_WWW}/landing/events?${qs}`)).map((e) => ({
    eventId: e.eventId ?? null,
    eventSchedulerId: e.eventSchedulerId ?? null,
    eventSchedulerKey: e.eventSchedulerKey || null,
    isSchedulerPosted: !!e.isSchedulerPosted,
    isSchedulerOnly: !!e.isSchedulerOnly,
    isPastEvent: !!e.isPastEvent,
    name: e.name || null,
    startDate: ymd(e.startDate) || null,
    endDate: ymd(e.endDate) || null,
    city: e.address?.city || null,
    state: e.address?.state?.abbreviation || null,
    locationName: e.locationName || null,
  }));
}

// Scheduler-only AES events overlapping the dates (Lone Star Classic, CTPL,
// Regionals, Heart of Texas, nationals...). Key is null until posted.
export async function aesSchedulerEvents({ start, end, state = null } = {}) {
  const rows = await aesLandingEvents({ start, end, state, schedulerOnly: true });
  return rows.map(({ eventSchedulerId, eventSchedulerKey, isSchedulerPosted, name, startDate, endDate, city, state: st }) => ({ eventSchedulerId, eventSchedulerKey, isSchedulerPosted, name, startDate, endDate, city, state: st }));
}

// Results event (Name, StartDate, EndDate, IsOver, Clubs, Divisions). Null = not published.
export async function aesEvent(key) {
  return getJson(`${AES_API}/event/${encodeURIComponent(key)}`);
}

// LastUpdatedTimestamp (true UTC ISO) — the cheap "did anything change" poll.
export async function aesTimestamp(key) {
  const j = await getJson(`${AES_API}/event/${encodeURIComponent(key)}/timestamp`);
  return j?.LastUpdatedTimestamp || null;
}

// Teams/clubs matching text in one event. Users (players' and coaches' names)
// are dropped here so they can never be stored.
export async function aesSearch(key, text) {
  const j = await getJson(`${AES_API}/event/${encodeURIComponent(key)}/search/${encodeURIComponent(String(text || "").trim())}`);
  if (!j) return null;
  return { Teams: Array.isArray(j.Teams) ? j.Teams : [], Clubs: Array.isArray(j.Clubs) ? j.Clubs : [], Divisions: Array.isArray(j.Divisions) ? j.Divisions : [] };
}

// Team header in an event: TeamDivision.DivisionId (needed for the schedule routes), TeamClub, TeamText.
export async function aesTeamHeader(key, teamId) {
  return getJson(`${AES_API}/event/${encodeURIComponent(key)}/teams/${encodeURIComponent(teamId)}`);
}

// which: 'past' | 'current' | 'future' | 'work' → array. future answers 204
// when nothing is ahead, returned as []. Null = the AES HTML fallback only
// (wrong division — the team moved — or an AES error page), never "empty".
export async function aesTeamSchedule(key, divisionId, teamId, which) {
  if (!["past", "current", "future", "work"].includes(which)) throw new Error("aesTeamSchedule: bad which " + which);
  return getJson(`${AES_API}/event/${encodeURIComponent(key)}/division/${encodeURIComponent(divisionId)}/team/${encodeURIComponent(teamId)}/schedule/${which}`, { on204: [] });
}

// Pool sheet: standings (FinishRank once the pool is done), every pool match
// with set scores and work team, and FutureRoundMatches. Feed it to
// aesTeamSnapshot({ poolsheet }) for pool rank and the teams in our work matches.
export async function aesPoolsheet(key, playId) {
  return getJson(`${AES_API}/event/${encodeURIComponent(key)}/poolsheet/${encodeURIComponent(playId)}`);
}

const odataIds = (teamIds) => (Array.isArray(teamIds) ? teamIds : [teamIds]).map(Number).filter(Number.isFinite).join(",");
// odata rejects an empty cId ("cId=") with the HTML fallback — always send a value or null.
function odataFn(key, fn, teamIds, { clubId = null, divisionId = null } = {}) {
  const ids = odataIds(teamIds || []);
  return `${AES_ODATA}/${encodeURIComponent(key)}/${fn}(dId=${divisionId == null ? "null" : Number(divisionId)},cId=${clubId == null ? "null" : Number(clubId)},tIds=[${ids}])`;
}

// Overall standings rows (W-L, sets, PointRatio, FinishRank/OverallRank once final) for those teams.
// opts.clubId instead of team ids = a whole club (tIds empty).
// Null (not []) when AES answers with its HTML fallback, so callers can tell
// "not readable" from "no rows" and keep what they have.
export async function aesStandings(key, teamIds, opts = {}) {
  const j = await getJson(odataFn(key, "standings", teamIds, opts));
  return j == null ? null : valueOf(j);
}

// Each team's next match (opponent, court, time — includes one in progress)
// and work matches. Null on the HTML fallback, like aesStandings.
export async function aesNext(key, teamIds, opts = {}) {
  const j = await getJson(odataFn(key, "nextassignments", teamIds, opts));
  return j == null ? null : valueOf(j);
}

export const aesEventUrl = (key) => `${AES_RESULTS}/event/${encodeURIComponent(key)}/home`;
// SPA route clubs/:clubId/teams/:teamId (the team opens as a modal over its club).
export const aesTeamUrl = (key, clubId, teamId) =>
  clubId != null && teamId != null ? `${AES_RESULTS}/event/${encodeURIComponent(key)}/clubs/${encodeURIComponent(clubId)}/teams/${encodeURIComponent(teamId)}` : aesEventUrl(key);

// ---------------- OTTO ----------------

// POST a GraphQL document → data. Throws on transport errors and when no data
// came back (validation errors, unknown event).
export async function ottoGql(query, variables = {}) {
  const j = await getJson(OTTO_GQL, { method: "POST", body: { query, variables } });
  if (!j || j.data == null) {
    const msg = j?.errors?.map((e) => e.message).join("; ") || "no data";
    throw new Error("OTTO GraphQL: " + msg);
  }
  return j.data;
}

const MATCH_FIELDS = "match_id match_name team_id opponent_id ref_team_id secs_start secs_end pool_bracket_id";
const MATCH_EXTERNAL = "external { team_display_name opponent_display_name ref_team_display_name court_info { short_name } pool_bracket_info { is_pool uuid } }";
const NEXT_FIELDS = "court match_id week_day secs_start display_name start_time_string";

// One call for a set of teams: finished matches (set scores), upcoming
// matches (opponent, court, time, ref team), upcoming ref (work) duties,
// division standing, the ongoing pool with its finishes ("1st goes to ...")
// and a bracket match's winner/loser paths. No athletes or staff — never ask
// OTTO for players' names.
export const FAVORITE_TEAMS = `query FavoriteTeams($eswId: ID!, $teamsIds: [ID!]!) {
  favoriteTeams(eventKey: $eswId, teamsIds: $teamsIds) {
    team_id team_name team_code division_id division_name master_team_id club_id
    external { club_info { club_name state } }
    division_standing { matches_won matches_lost sets_won sets_lost points_ratio rank seed heading heading_priority }
    ongoing_pool_bracket {
      ... on Pool { is_pool uuid display_name short_name name team_pb_stat { rank matches_won matches_lost sets_won sets_lost points_ratio }
        pb_finishes { team_name team_id next_match { ${NEXT_FIELDS} } next_ref { ${NEXT_FIELDS} } } }
      ... on Bracket { is_pool uuid display_name short_name name team_pb_stat { rank matches_won matches_lost sets_won sets_lost points_ratio } }
    }
    finished_matches(as_team: true) {
      ${MATCH_FIELDS} secs_finished
      results { sets winner winner_team { scores roster_team_id } }
      ${MATCH_EXTERNAL}
    }
    upcoming_matches(as_team: true) {
      ${MATCH_FIELDS}
      ${MATCH_EXTERNAL}
      finishes { winner { team_name team_id next_match { ${NEXT_FIELDS} } next_ref { ${NEXT_FIELDS} } }
                 looser { team_name team_id next_match { ${NEXT_FIELDS} } next_ref { ${NEXT_FIELDS} } } }
    }
    upcoming_ref_matches: upcoming_matches(as_ref: true) {
      ${MATCH_FIELDS}
      ${MATCH_EXTERNAL}
    }
  }
}`;

const PAGINATED_CLUBS = `query PaginatedClubs($eswId: ID!, $page: Float!, $pageSize: Float!, $search: String) {
  paginatedClubs(eventKey: $eswId, page: $page, pageSize: $pageSize, search: $search) {
    items { roster_club_id club_name state club_code teams_count
      teams { team_id team_name team_code division_id division_name master_team_id } }
    page_info { page page_size page_count item_count }
  }
}`;

const EVENT_ESW = `query EventEsw($eswId: ID!) {
  eventEsw(id: $eswId) { event_id esw_id long_name city state region timezone date_start date_end schedule_published has_female_teams sport_sanctioning }
}`;

const PAGINATED_EVENTS = `query PaginatedEvents($page: Float!, $pageSize: Float!, $search: String, $startBefore: String, $startAfter: String, $endBefore: String, $endAfter: String, $asc: Boolean) {
  paginatedEvents(page: $page, pageSize: $pageSize, search: $search, startBefore: $startBefore, startAfter: $startAfter, endBefore: $endBefore, endAfter: $endAfter, asc: $asc) {
    items { event_id long_name city date_start state address schedule_published }
    page_info { page page_size page_count item_count }
  }
}`;

// Event detail by hex esw id or numeric id: { event_id (numeric), esw_id (hex,
// null until published), schedule_published, long_name, city, state,
// timezone (not trusted — see tzForTournament), date_start/date_end (wall-clock ms) }.
export async function ottoEventEsw(id) {
  const d = await ottoGql(EVENT_ESW, { eswId: String(id) });
  return d.eventEsw || null;
}

// Clubs at an event matching search (≥ 3 chars; "DSELI" finds DS Elite),
// each with its teams (team_id is per event, master_team_id is stable).
// Works on registration-only events too. Up to 3 pages of 20.
export async function ottoClubs(eventKey, search) {
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const d = await ottoGql(PAGINATED_CLUBS, { eswId: String(eventKey), page, pageSize: 20, search: search || null });
    const p = d.paginatedClubs;
    out.push(...(p?.items || []));
    if (!p || page >= (p.page_info?.page_count || 1)) break;
  }
  return out;
}

// favoriteTeams for per-event team ids → [team] (see FAVORITE_TEAMS).
export async function ottoFavoriteTeams(eventKey, teamIds) {
  const ids = (Array.isArray(teamIds) ? teamIds : [teamIds]).filter((x) => x != null && x !== "").map(String);
  if (!ids.length) return [];
  const d = await ottoGql(FAVORITE_TEAMS, { eswId: String(eventKey), teamsIds: ids });
  return Array.isArray(d.favoriteTeams) ? d.favoriteTeams : [];
}

// Every pool's finishing order in a division (pb_finishes[i].team_id is
// filled once the pool is decided, i = place - 1). For ottoTeamSnapshot({ pools })
// when a team has left its pool; ~100 KB for a 137-team division, so only
// when a pool rank is still unknown.
const DIVISION_POOLS = `query DivisionPools($eswId: ID!, $divisionId: ID!) {
  divisionPoolBrackets(eventKey: $eswId, divisionId: $divisionId) {
    ... on Pool { is_pool uuid display_name name pb_stats { team_id rank } pb_finishes { team_id } }
    ... on Bracket { is_pool uuid display_name name pb_stats { team_id rank } }
  }
}`;
export async function ottoDivisionPools(eventKey, divisionId) {
  const d = await ottoGql(DIVISION_POOLS, { eswId: String(eventKey), divisionId: String(divisionId) });
  return Array.isArray(d.divisionPoolBrackets) ? d.divisionPoolBrackets : [];
}

// The full OTTO event list is one 2 MB array (every event since 2015), so it's
// fetched at most every 10 minutes per warm function and filtered here.
let eventsCache = { at: 0, rows: null };
const EVENTS_TTL = 10 * 60 * 1000;
async function allOttoEvents() {
  if (eventsCache.rows && Date.now() - eventsCache.at < EVENTS_TTL) return eventsCache.rows;
  const rows = await getJson(`${OTTO_REST}/events`);
  if (!Array.isArray(rows)) throw new Error("OTTO events: unexpected response");
  eventsCache = { at: Date.now(), rows };
  return rows;
}

// OTTO events overlapping [start, end] (YYYY-MM-DD), optionally in a state.
// event_id is the hex esw id once the schedule is published, the numeric id
// before. Falls back to GraphQL paginatedEvents (no end dates there) if the
// REST list is down.
export async function ottoEvents({ start, end, state = null } = {}) {
  const s = ymd(start), e = ymd(end || start), st = state ? String(state).toUpperCase() : null;
  const pick = (r) => ({
    event_id: String(r.event_id), name: r.name || r.long_name || null, long_name: r.long_name || r.name || null,
    date_start: ymd(r.date_start) || null, date_end: ymd(r.date_end) || ymd(r.date_start) || null,
    timezone: r.timezone || null, city: r.city || null, state: r.state || null,
    schedule_published: !!r.schedule_published, current: !!r.current,
  });
  try {
    const rows = await allOttoEvents();
    return rows.map(pick).filter((r) => r.date_start && r.date_start <= e && (r.date_end || r.date_start) >= s && (!st || String(r.state || "").toUpperCase() === st));
  } catch (err) {
    const out = [];
    const before = new Date(Date.parse(e + "T00:00:00Z") + 2 * 86400000).toISOString().slice(0, 10);
    const after = new Date(Date.parse(s + "T00:00:00Z") - 14 * 86400000).toISOString().slice(0, 10);
    for (let page = 1; page <= 10; page++) {
      const d = await ottoGql(PAGINATED_EVENTS, { page, pageSize: 20, startAfter: after, startBefore: before, asc: true });
      const p = d.paginatedEvents;
      for (const it of p?.items || []) {
        const ds = Number(it.date_start) > 0 ? new Date(Number(it.date_start)).toISOString().slice(0, 10) : null;
        out.push(pick({ ...it, date_start: ds, date_end: null }));
      }
      if (!p || page >= (p.page_info?.page_count || 1)) break;
    }
    // Without end dates, keep events starting in the window (or up to 3 days before it).
    const early = new Date(Date.parse(s + "T00:00:00Z") - 3 * 86400000).toISOString().slice(0, 10);
    return out.filter((r) => r.date_start && r.date_start <= e && r.date_start >= early && (!st || String(r.state || "").toUpperCase() === st));
  }
}

// Parent links. The new site (events.ottoevent.ai) has no per-team page, so the
// team link is the legacy SPA's team route (events.event.teams.team).
export const ottoEventUrl = (eswId) => `https://events.ottoevent.ai/event/${encodeURIComponent(eswId)}`;
export const ottoTeamUrl = (eswId, teamId) => `https://eventslegacy.ottoevent.ai/#/events/${encodeURIComponent(eswId)}/teams/${encodeURIComponent(teamId)}`;
