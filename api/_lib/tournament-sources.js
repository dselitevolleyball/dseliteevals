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
//   GraphQL is primary; when it fails (it answered 503 for hours on 10 Oct
//   2026) ottoEventEsw / ottoClubs / ottoFavoriteTeams / ottoDivisionPools
//   answer from REST in the same shapes, and a GraphQL outage is remembered
//   for 5 minutes so it isn't retried on every call (see "OTTO REST" below).
//   Env OTTO_GRAPHQL=off forces REST.
//
// Every call: a UA naming us, Accept json, 12 s per attempt and one retry on
// 5xx or a network error, all inside 15 s for the whole call. A timeout is not
// retried (a second 12 s wait would only push the sync past its budget; the
// next run tries again; OTTO GraphQL calls that have a REST fallback get one
// 8 s attempt, no retry). Returns parsed JSON, or null for "nothing there"
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

// One HTTP call → parsed JSON | null. opts: { method, body, nullOn404, on204,
// timeoutMs, retry } (on204: what a 204 returns, default null; timeoutMs: one
// attempt, default 12 s; retry: false = a single attempt, for calls that have
// a fallback of their own — OTTO GraphQL → REST).
export async function getJson(url, { method = "GET", body, nullOn404 = false, on204 = null, timeoutMs = TIMEOUT_MS, retry = true } = {}) {
  const deadline = Date.now() + Math.min(CALL_MS, retry ? CALL_MS : timeoutMs);
  let lastErr;
  for (let attempt = 0; attempt < (retry ? 2 : 1); attempt++) {
    if (attempt) {
      // Only a quick failure is worth a second try inside the call's 15 s.
      if (deadline - Date.now() - RETRY_GAP_MS < RETRY_MIN_MS) break;
      await sleep(RETRY_GAP_MS);
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), Math.min(timeoutMs, deadline - Date.now()));
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

// Who is registered for an event (the landing page's Teams tab), as the event
// director chose to show it: visibility = the event's eventTeamVisibilityType
// .code — 'all' → /teams (every entry with its status), 'accepted' →
// /teams/accepted (accepted entries only; pending ones are hidden), 'none' →
// nothing is public (null, no call). The page's setting is not the API's,
// though: /teams answered the full list (Dropped / Pending / Waitlist too) for
// 'accepted' and 'none' events alike when checked on 11 Oct 2026, so
// registration-check asks for 'all' first and uses the visibility only as the
// fallback. Rows: { teamId, name, clubId, clubName,
// teamCode, acceptedType: { displayName: 'Accepted' | 'Pending' | 'Dropped' |
// 'Waitlist' | 'Ok To Pay' | 'Incomplete' }, divisionDescription }. Null also
// for the HTML fallback / 404 (not readable — never read that as "no teams").
// Used by api/_lib/registration-check.js (DS Elite = clubId 32611).
export async function aesLandingTeams(eventId, visibility = "all") {
  const v = String(visibility || "all").toLowerCase();
  if (v === "none") return null;
  const j = await getJson(`${AES_WWW}/landing/events/${encodeURIComponent(eventId)}/teams${v === "accepted" ? "/accepted" : ""}`, { nullOn404: true });
  if (j == null) return null;
  return Array.isArray(j) || Array.isArray(j?.value) ? valueOf(j) : null;
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

// GraphQL is the first choice; the legacy REST API is the fallback. On 10 Oct
// 2026 events.ottoevent.ai/api/esw/graphql answered 503 "no healthy upstream"
// for hours (from Drew's machine and from Vercel) while
// eventslegacy.ottoevent.ai/api/esw/... kept answering 200, so every OTTO
// call the hub makes on a published event (hex esw id) can be answered from
// REST: ottoEventEsw, ottoClubs, ottoFavoriteTeams (adapted to the exact
// favoriteTeams shape, so ottoTeamSnapshot is unchanged) and ottoDivisionPools.
// A GraphQL outage (5xx, timeout, network error, 403/429, a non-JSON answer)
// is remembered for GQL_DOWN_MS in this warm function: until then GraphQL is
// not called at all, so a hanging GraphQL costs one 8 s wait per 5 minutes,
// not one per call in a 100 s sync. Registration-only events (numeric id, no
// schedule) have no REST equivalent for clubs/teams — those calls fail until
// GraphQL is back, and the sync records the error and moves on.
// Env OTTO_GRAPHQL=off skips GraphQL entirely (REST only) — a switch for a
// misbehaving GraphQL, and how the REST path is tested while GraphQL is up.
const GQL_FAST_MS = 8000;            // one GraphQL attempt when REST can answer instead
const GQL_DOWN_MS = 5 * 60 * 1000;
let gqlDown = { until: 0, why: null };
const gqlOff = () => /^(off|0|false|no)$/i.test(String(process.env.OTTO_GRAPHQL || ""));
const gqlOutage = (e) => !e?.gqlData && (e?.timeout || !e?.status || e.status >= 500 || e.status === 403 || e.status === 429);
// For logs / ?test= output: is GraphQL being skipped right now, and why.
export const ottoGqlState = () => (gqlOff() ? { down: true, until: null, why: "OTTO_GRAPHQL=off" } : { down: Date.now() < gqlDown.until, until: gqlDown.until ? new Date(gqlDown.until).toISOString() : null, why: gqlDown.why });
// A published event's 9-hex esw id ("601906a1b"; some are all digits:
// "204764064"). Registration-only events have 5-6 digit numeric ids.
export const isEswId = (k) => /^[0-9a-f]{9}$/i.test(String(k ?? ""));

// POST a GraphQL document → data. Throws on transport errors and when no data
// came back (validation errors, unknown event — marked gqlData, not an
// outage). opts.fast: one 8 s attempt, no retry (the caller has REST).
export async function ottoGql(query, variables = {}, { fast = false } = {}) {
  if (gqlOff()) throw Object.assign(new Error("OTTO GraphQL off (OTTO_GRAPHQL=off)"), { status: 503, gqlSkipped: true });
  if (Date.now() < gqlDown.until) throw Object.assign(new Error(`OTTO GraphQL skipped (down: ${gqlDown.why})`), { status: 503, gqlSkipped: true });
  let j;
  try {
    j = await getJson(OTTO_GQL, { method: "POST", body: { query, variables }, ...(fast ? { timeoutMs: GQL_FAST_MS, retry: false } : {}) });
    if (!j) throw Object.assign(new Error("OTTO GraphQL: not JSON"), { status: 502 });
  } catch (e) {
    if (gqlOutage(e)) gqlDown = { until: Date.now() + GQL_DOWN_MS, why: String(e.message || e).slice(0, 120) };
    throw e;
  }
  if (j.data == null) {
    const msg = j?.errors?.map((e) => e.message).join("; ") || "no data";
    throw Object.assign(new Error("OTTO GraphQL: " + msg), { gqlData: true });
  }
  return j.data;
}

// GraphQL first (fast when REST can answer), REST when it fails. rest = null:
// no REST equivalent, GraphQL's error stands.
async function gqlOrRest(label, gql, rest) {
  try {
    return await gql(!!rest);
  } catch (e) {
    if (!rest) throw e;
    try {
      return await rest();
    } catch (e2) {
      throw Object.assign(new Error(`${label}: GraphQL ${String(e.message || e).slice(0, 100)}; REST ${String(e2.message || e2).slice(0, 140)}`), { status: e2.status ?? e.status });
    }
  }
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
// REST event detail answers for both kinds of id.
export async function ottoEventEsw(id) {
  return gqlOrRest("OTTO event",
    async (fast) => (await ottoGql(EVENT_ESW, { eswId: String(id) }, { fast })).eventEsw || null,
    async () => eventFromRest(await ottoRest(encodeURIComponent(String(id)), 60000)));
}

// Clubs at an event matching search (≥ 3 chars; "DSELI" finds DS Elite),
// each with its teams (team_id is per event, master_team_id is stable).
// Works on registration-only events too (GraphQL only — REST clubs need the
// hex esw id). Up to 3 pages of 20.
export async function ottoClubs(eventKey, search) {
  return gqlOrRest("OTTO clubs", async (fast) => {
    const out = [];
    for (let page = 1; page <= 3; page++) {
      const d = await ottoGql(PAGINATED_CLUBS, { eswId: String(eventKey), page, pageSize: 20, search: search || null }, { fast });
      const p = d.paginatedClubs;
      out.push(...(p?.items || []));
      if (!p || page >= (p.page_info?.page_count || 1)) break;
    }
    return out;
  }, isEswId(eventKey) ? () => ottoClubsRest(String(eventKey), search) : null);
}

// favoriteTeams for per-event team ids → [team] (see FAVORITE_TEAMS). REST
// fallback: one team page per team plus the shared court grid / pool calls,
// adapted to the same item shape (ottoFavRest).
export async function ottoFavoriteTeams(eventKey, teamIds) {
  const ids = (Array.isArray(teamIds) ? teamIds : [teamIds]).filter((x) => x != null && x !== "").map(String);
  if (!ids.length) return [];
  return gqlOrRest("OTTO favoriteTeams", async (fast) => {
    const d = await ottoGql(FAVORITE_TEAMS, { eswId: String(eventKey), teamsIds: ids }, { fast });
    return Array.isArray(d.favoriteTeams) ? d.favoriteTeams : [];
  }, () => ottoFavoriteTeamsRest(eventKey, ids));
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
// REST fallback: the pools of that division the REST team adapter has just
// loaded (each team's own pools — the only ones ottoTeamSnapshot looks up, by
// uuid), or null — the snapshot then just lacks that place for now.
export async function ottoDivisionPools(eventKey, divisionId) {
  return gqlOrRest("OTTO division pools", async (fast) => {
    const d = await ottoGql(DIVISION_POOLS, { eswId: String(eventKey), divisionId: String(divisionId) }, { fast });
    return Array.isArray(d.divisionPoolBrackets) ? d.divisionPoolBrackets : [];
  }, async () => restPoolsSeen(String(eventKey), String(divisionId)));
}

// ---------------- OTTO REST (the GraphQL fallback) ----------------
//
// eventslegacy.ottoevent.ai/api/esw/{eswId}/... — routes verified live on
// 10 Oct 2026 against SoCal Cup 601906a1b (finished), Tampa 7bf1286c5 and
// SoCal 18/17 204764064 (in play):
//   {id}                         event detail (hex or numeric id): id (numeric), event_id (hex once published)
//   teams/{rosterTeamId}         record, upcoming [{match_type team1|team2|ref, date_start, court_name (long),
//                                pool_bracket_id, pool_name 'R1P4', pb_name}], results [{uuid, is_pool,
//                                pb_name, pb_stats (JSON string), matches (JSON string: our matches with
//                                set1..set5, winner, team1/team2 roster ids)}], athletes/staff (dropped here)
//   courts_matches/{day}/hour/0/hours/24/{divisionId}
//                                every match that day in the division by court: match_id, date_end,
//                                team1/2 ids + names, team_ref_name, secs_finished, and the court's
//                                short_name — GraphQL's court_info.short_name ("AIM HQ4", not
//                                "AIM Sportsplex HQ Ct 4"), so court strings (and the hub's "next" alert
//                                keys) don't change when the source does
//   pools/{uuid}                 a pool or bracket: display_name_short 'R1D3P5', pb_finishes (JSON string
//                                {"1": {team_id, next_match, next_ref}, ...} — GraphQL's array in order),
//                                pb_stats, upcoming_matches (a pool still being played)
//   brackets/{uuid}/matches      bracket matches with finishes (JSON string {Winner, Loser})
//   divisions/{id}/standings     {teams: {heading: [{roster_team_id, rank, points_ratio, seed_current, info}]}}
//   clubs, clubs/{rosterClubId}, divisions
// Times are the same wall-clock-as-UTC epoch ms as GraphQL's secs_start
// (date_start 1791039600000 = Sat 3:00 PM local in both), so they pass through.
// Every REST answer is memoized ~30 s per URL (in-flight shared), so teams in
// one division share the court grid and pools within a sync run.

const restMemo = new Map();
function ottoRest(path, ttl = 30000) {
  const url = `${OTTO_REST}/${path}`;
  const now = Date.now();
  const hit = restMemo.get(url);
  if (hit && now - hit.at < ttl) return hit.p;
  const p = getJson(url, { nullOn404: true });
  restMemo.set(url, { at: now, p });
  p.catch(() => { if (restMemo.get(url)?.p === p) restMemo.delete(url); });
  if (restMemo.size > 60) for (const [k, v] of restMemo) if (now - v.at > 10 * 60000) restMemo.delete(k);
  return p;
}

// n at a time, results in order; the first error rejects (all-or-nothing, like the one GraphQL call it stands in for).
async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
const pj = (s) => { if (s == null || typeof s === "object") return s ?? null; try { return JSON.parse(s); } catch { return null; } };
const msDayOf = (ms) => (Number(ms) > 0 ? new Date(Number(ms)).toISOString().slice(0, 10) : null);
const pbCode = (matchName) => { const m = /^(.*?)M\d+$/.exec(String(matchName || "")); return m ? m[1] : null; };
const idStr = (x) => (x == null || x === "" ? null : String(x));

// REST event detail → the eventEsw shape. Dates "10/03/2026" → wall-clock ms
// (only the day is ever read).
function eventFromRest(j) {
  if (!j || j.id == null) return null;
  const day = (s) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || "")); return m ? Date.UTC(+m[3], +m[1] - 1, +m[2]) : null; };
  const hex = isEswId(j.event_id) && String(j.event_id) !== String(j.id) ? String(j.event_id) : null;
  return {
    event_id: String(j.id), esw_id: hex, long_name: j.long_name || j.name || null, city: j.city || null, state: j.state || null, region: null,
    timezone: j.timezone || null, date_start: day(j.date_start), date_end: day(j.date_end || j.date_start),
    schedule_published: !!j.schedule_published, has_female_teams: !!j.has_female_teams, sport_sanctioning: j.sport_sanctioning || null,
  };
}

// The hex esw id REST routes need, from an esw id or a published event's numeric id.
async function restEswId(key) {
  if (isEswId(key)) return String(key);
  const ev = eventFromRest(await ottoRest(encodeURIComponent(String(key)), 60000));
  if (!ev?.esw_id) throw Object.assign(new Error(`OTTO event ${key} has no published schedule (REST needs the esw id)`), { status: 404 });
  return ev.esw_id;
}

// A team's REST page without the roster: athletes and staff (players' and
// coaches' names) are dropped here so they can never be stored. Null when
// the team isn't in the event.
export async function ottoTeamRest(eswId, rosterTeamId) {
  // A team id that isn't in the event answers 400 {"validation":"Can not find team with ID:..."}.
  const j = await ottoRest(`${encodeURIComponent(eswId)}/teams/${encodeURIComponent(rosterTeamId)}`)
    .catch((e) => { if (e.status === 400 && /team/i.test(e.message)) return null; throw e; });
  if (!j || typeof j !== "object" || j.roster_team_id == null) return null;
  const { athletes, staff, ...team } = j; // eslint-disable-line no-unused-vars
  return team;
}

// division_id → short name ("14/15 G" — the name favoriteTeams calls division_name).
async function restDivisionNames(esw) {
  const rows = await ottoRest(`${esw}/divisions`, 10 * 60000);
  return new Map((Array.isArray(rows) ? rows : []).map((d) => [String(d.division_id), String(d.short_name || d.name || "").trim() || null]));
}

// Clubs matching search, the paginatedClubs shape. REST /clubs has names only
// (no club code), so "DSELI" is matched against the name squeezed to letters
// ("DS Elite Volleyball Club" → "dselitevolleyballclub"). Only the fields the
// sync uses are kept — /clubs/{id} also carries payment, housing and ths_* fields.
async function ottoClubsRest(esw, search) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const q = norm(search);
  const clubs = await ottoRest(`${esw}/clubs`, 120000);
  const hits = (Array.isArray(clubs) ? clubs : []).filter((c) => c && (!q || norm(c.club_name).includes(q))).slice(0, 10);
  if (!hits.length) return [];
  const divs = await restDivisionNames(esw).catch(() => new Map());
  return mapLimit(hits, 3, async (c) => {
    const rows = await ottoRest(`${esw}/clubs/${encodeURIComponent(c.roster_club_id)}`, 120000);
    const teams = (Array.isArray(rows) ? rows : []).filter(Boolean).map((tm) => ({
      team_id: String(tm.roster_team_id), team_name: tm.team_name || null, team_code: tm.organization_code || null,
      division_id: idStr(tm.division_id), division_name: divs.get(String(tm.division_id)) ?? null, master_team_id: idStr(tm.master_team_id),
    }));
    // USAV team codes carry the club code: G15DSELI2LS → DSELI.
    const code = teams.map((t) => /^[BGC]\d{2}([A-Z]{5})\d/.exec(t.team_code || "")?.[1]).find(Boolean) || null;
    return { roster_club_id: String(c.roster_club_id), club_name: c.club_name || null, state: c.state || null, club_code: code, teams_count: Number(c.teams_count) || teams.length, teams };
  });
}

// Pools/brackets the REST adapter loaded, by `${esw}:${divisionId}` → uuid →
// { at, pool } in divisionPoolBrackets shape — what ottoDivisionPools answers
// with while GraphQL is down. A later fetch of the same pool replaces it.
const restPools = new Map();
function rememberPool(esw, div, pool) {
  if (!pool?.uuid || div == null) return;
  const k = `${esw}:${div}`;
  if (!restPools.has(k)) restPools.set(k, new Map());
  restPools.get(k).set(pool.uuid, { at: Date.now(), pool });
  if (restPools.size > 40) restPools.delete(restPools.keys().next().value);
}
function restPoolsSeen(esw, div) {
  const m = restPools.get(`${esw}:${div}`);
  if (!m) return null;
  const fresh = [...m.values()].filter((x) => Date.now() - x.at < 15 * 60000).map((x) => x.pool);
  return fresh.length ? fresh : null;
}
// pb_finishes JSON {"1": {...}, "2": {...}, "team_ids": "..."} → GraphQL's array, place order.
const finsArr = (s) => {
  const o = pj(s);
  if (!o || typeof o !== "object") return [];
  return Object.keys(o).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b).map((k) => {
    const v = o[k] || {};
    return { team_name: v.team_name ?? "", team_id: v.team_id ?? 0, next_match: v.next_match || null, next_ref: v.next_ref || null };
  });
};
// pb_stats JSON {"1st": {team_id, rank, matches_won, ...}} → [{...}] by rank.
const statsArr = (s) => {
  const o = pj(s);
  if (!o || typeof o !== "object") return [];
  return Object.values(o).filter((v) => v && typeof v === "object" && v.team_id != null)
    .map((v) => ({ team_id: String(v.team_id), name: v.name ?? null, rank: Number(v.rank) || 0, matches_won: v.matches_won ?? 0, matches_lost: v.matches_lost ?? 0, sets_won: v.sets_won ?? 0, sets_lost: v.sets_lost ?? 0, points_ratio: v.points_ratio ?? 0 }))
    .sort((a, b) => a.rank - b.rank);
};
const poolFromRest = (det, name) => ({
  is_pool: Number(det.is_pool) ? 1 : 0, uuid: det.uuid, display_name: det.display_name_short || null, name: name || null,
  pb_stats: statsArr(det.pb_stats).map(({ team_id, rank }) => ({ team_id, rank })), pb_finishes: finsArr(det.pb_finishes),
});

// favoriteTeams from REST, for these per-event team ids (teams not in the
// event are left out, as GraphQL does).
async function ottoFavoriteTeamsRest(eventKey, ids) {
  const esw = await restEswId(eventKey);
  const out = await mapLimit(ids, 3, (id) => ottoFavRest(esw, id));
  return out.filter(Boolean);
}

// One team's REST page (plus the court grid for its days, its current pool or
// bracket, and division standings once it has nothing left to play) → one
// favoriteTeams item with every field ottoTeamSnapshot reads:
//   team_id team_name team_code division_id division_name master_team_id club_id
//   external.club_info, division_standing {matches_won matches_lost sets_won
//   sets_lost points_ratio rank seed heading heading_priority},
//   ongoing_pool_bracket {is_pool uuid display_name short_name name team_pb_stat pb_finishes[]},
//   finished_matches / upcoming_matches / upcoming_ref_matches [{match_id
//   match_name team_id opponent_id ref_team_id secs_start secs_end
//   secs_finished pool_bracket_id results {sets winner winner_team {scores
//   roster_team_id}} external {team_display_name opponent_display_name
//   ref_team_display_name court_info {short_name} pool_bracket_info {is_pool uuid}}
//   finishes {winner looser}}].
// Orientation is GraphQL's: team_id/team_display_name are the match's team 1
// (not necessarily us) and results.sets are team 1's score first; the
// snapshot turns them to ours. ongoing_pool_bracket follows what GraphQL was
// seen doing on 10 Oct: the pool/bracket of the next match we play; with
// nothing left to play, the last one we played while it is still undecided
// for us (others still playing, our place not in pb_finishes); else null.
async function ottoFavRest(esw, teamId) {
  const t = await ottoTeamRest(esw, teamId);
  if (!t) return null;
  const tid = String(t.roster_team_id);
  const isPlay = (r) => r && (r.match_type === "team1" || r.match_type === "team2");
  const won12 = (r) => { const w = String(r?.results?.winner ?? ""); return w === "1" || w === "2"; };
  const pbs = (Array.isArray(t.results) ? t.results : []).filter((r) => r && r.uuid).map((r) => ({
    uuid: String(r.uuid), is_pool: Number(r.is_pool) ? 1 : 0, name: r.pb_name || null, stats: r.pb_stats, matches: (pj(r.matches) || []).filter(Boolean),
  }));
  const pbOf = new Map(pbs.map((p) => [p.uuid, p]));
  const upRows = (Array.isArray(t.upcoming) ? t.upcoming : []).filter(Boolean);

  // Our play matches by id: the per-pool lists (scored and not), plus upcoming rows.
  const play = new Map();
  for (const p of pbs) for (const m of p.matches) if (isPlay(m) && m.match_id) play.set(String(m.match_id), { ...m, pool_bracket_id: m.pool_bracket_id || p.uuid });
  for (const u of upRows) {
    if (!isPlay(u) || !u.match_id) continue;
    const had = play.get(String(u.match_id));
    if (!had || !won12(had)) play.set(String(u.match_id), { ...(had || {}), ...u }); // a scored row is never undone by a stale upcoming one
  }
  const refs = upRows.filter((u) => u.match_type === "ref" && u.match_id);
  const all = [...play.values(), ...refs];
  const div = all.map((r) => r.division_id).find((x) => x != null) ?? null;
  const divName = all.map((r) => r.division_short_name).find(Boolean) || null;

  // Started now, awaited below (each settles to {v} | {e}, so none is ever an
  // unhandled rejection): division standings — rank / heading / seed only
  // matter once there's nothing left to play (finish), so the ~90 KB list is
  // read only then — and the club's team list, the only place with
  // master_team_id (stable across events) and a team's division before it has a match.
  const settle = (p) => p.then((v) => ({ v }), (e) => ({ e }));
  const nothingLeft = ![...play.values()].some((r) => !won12(r)) && [...play.values()].some(won12);
  const standP = nothingLeft && div != null ? settle(ottoRest(`${esw}/divisions/${encodeURIComponent(div)}/standings`)) : null;
  const clubP = t.roster_club_id != null ? settle(ottoRest(`${esw}/clubs/${encodeURIComponent(t.roster_club_id)}`, 10 * 60000)) : null;

  // Court grid for each (day, division) we're on: short court names, end
  // times, team names for work matches, the work team of our matches.
  const grids = [...new Set(all.map((r) => { const d = msDayOf(r.date_start); const dv = r.division_id ?? div; return d && dv != null ? `${d}|${dv}` : null; }).filter(Boolean))];
  const cm = new Map();
  await mapLimit(grids, 3, async (k) => {
    const [d, dv] = k.split("|");
    const j = await ottoRest(`${esw}/courts_matches/${d}/hour/0/hours/24/${encodeURIComponent(dv)}`);
    for (const c of j?.courts || []) for (const m of c?.matches || []) if (m?.match_id) cm.set(String(m.match_id), { ...m, court_short: c.short_name || c.court_name || null });
  });

  const toGql = (r, kind) => {
    const x = cm.get(String(r.match_id)) || {};
    const opp = (k) => (r.match_type === "team1" ? (k === 1 ? [tid, t.team_name] : [r.opponent_team_id, r.opponent_team_name]) : (k === 1 ? [r.opponent_team_id, r.opponent_team_name] : [tid, t.team_name]));
    const t1 = x.team1_roster_id ?? (isPlay(r) ? opp(1)[0] : null), t2 = x.team2_roster_id ?? (isPlay(r) ? opp(2)[0] : null);
    const n1 = x.team_1_name ?? (isPlay(r) ? opp(1)[1] : null), n2 = x.team_2_name ?? (isPlay(r) ? opp(2)[1] : null);
    const uuid = r.pool_bracket_id ? String(r.pool_bracket_id) : null;
    const pb = uuid ? pbOf.get(uuid) : null;
    const o = {
      match_id: String(r.match_id), match_name: r.display_name || x.match_name || null,
      team_id: idStr(t1), opponent_id: idStr(t2), ref_team_id: kind === "ref" ? tid : null,
      secs_start: Number(r.date_start ?? x.date_start) || null, secs_end: Number(x.date_end) || null, pool_bracket_id: uuid,
      external: {
        team_display_name: n1 || null, opponent_display_name: n2 || null,
        ref_team_display_name: kind === "ref" ? t.team_name || null : x.team_ref_name || null,
        court_info: { short_name: x.court_short || r.court_name || null },
        pool_bracket_info: { is_pool: pb ? pb.is_pool : r.is_pool != null ? (Number(r.is_pool) ? 1 : 0) : null, uuid },
      },
    };
    if (kind === "finished") {
      const res = r.results || {};
      const w = String(res.winner);
      o.secs_finished = Number(x.secs_finished) || (Number(r.unix_finished) > 0 ? Number(r.unix_finished) * 1000 : null);
      o.results = {
        sets: ["set1", "set2", "set3", "set4", "set5"].map((k) => res[k]).filter((s) => /^\s*\d+\s*-\s*\d+\s*$/.test(String(s ?? ""))).map(String),
        winner: w,
        winner_team: { scores: (w === "1" ? res.team1?.scores : res.team2?.scores) ?? null, roster_team_id: idStr(w === "1" ? res.team1?.roster_team_id ?? t1 : res.team2?.roster_team_id ?? t2) },
      };
    }
    if (kind === "upcoming") o.finishes = null;
    return o;
  };
  const byStart = (a, b) => (a.secs_start || 0) - (b.secs_start || 0) || String(a.match_name).localeCompare(String(b.match_name), undefined, { numeric: true });
  const finished = [...play.values()].filter(won12).map((r) => toGql(r, "finished")).sort(byStart);
  const upcoming = [...play.values()].filter((r) => !won12(r)).map((r) => toGql(r, "upcoming")).sort(byStart);
  // GraphQL drops a work match the moment it's scored; so does this.
  const refsUp = refs.filter((r) => { const x = cm.get(String(r.match_id)); return !(x && (x.secs_finished || String(x.res_winner || "") === "1" || String(x.res_winner || "") === "2")); }).map((r) => toGql(r, "ref")).sort(byStart);

  // The pool/bracket we're in now, plus our last two finished pools (their
  // pb_finishes are the places ottoDivisionPools would give).
  const lastStart = (p) => Math.max(0, ...p.matches.map((m) => Number(m.date_start) || 0));
  const curUuid = upcoming[0]?.pool_bracket_id || ([...pbs].sort((a, b) => lastStart(b) - lastStart(a))[0]?.uuid ?? null);
  const nextUp = upcoming[0] || null;
  // A bracket we play next needs no pool detail (its name is on the row; its paths come from brackets/{uuid}/matches).
  const curDet = curUuid && !(nextUp && Number(nextUp.external.pool_bracket_info.is_pool) === 0);
  const poolUuids = [...new Set([curDet ? curUuid : null, ...pbs.filter((p) => p.is_pool && p.uuid !== curUuid).sort((a, b) => lastStart(b) - lastStart(a)).slice(0, 2).map((p) => p.uuid)].filter(Boolean))];
  // A bracket match's "if we win / lose" paths come from its bracket's match list.
  const nextInBracket = !!(nextUp && Number(nextUp.external.pool_bracket_info.is_pool) === 0 && nextUp.pool_bracket_id);
  const brP = nextInBracket ? settle(ottoRest(`${esw}/brackets/${encodeURIComponent(nextUp.pool_bracket_id)}/matches`)) : null;
  const dets = new Map();
  await mapLimit(poolUuids, 3, async (u) => {
    const det = u === curUuid ? await ottoRest(`${esw}/pools/${encodeURIComponent(u)}`) : await ottoRest(`${esw}/pools/${encodeURIComponent(u)}`).catch(() => null);
    if (!det || !det.uuid) return;
    dets.set(u, det);
    rememberPool(esw, div, poolFromRest(det, pbOf.get(u)?.name));
  });
  let ongoing = null;
  if (curUuid) {
    const pb = pbOf.get(curUuid);
    const det = dets.get(curUuid) || null;
    const fins = det ? finsArr(det.pb_finishes) : [];
    const placed = fins.some((f) => String(f.team_id) === tid);
    const undecided = fins.length ? fins.some((f) => !Number(f.team_id)) : (det?.upcoming_matches || []).length > 0;
    if (nextUp || (det && !placed && undecided)) {
      const upRow = upRows.find((u) => String(u.pool_bracket_id) === curUuid);
      const code = det?.display_name_short || upRow?.pool_name || pbCode(nextUp?.match_name) || pbCode(pb?.matches?.[0]?.display_name) || null;
      const isPool = det ? (Number(det.is_pool) ? 1 : 0) : pb ? pb.is_pool : Number(upRow?.is_pool) ? 1 : 0;
      const mine = statsArr(pb?.stats).find((s) => s.team_id === tid);
      ongoing = {
        is_pool: isPool, uuid: curUuid, display_name: code, short_name: /([PX]\d+)$/i.exec(code || "")?.[1] || null,
        name: pb?.name || upRow?.pb_name || null,
        team_pb_stat: mine ? { rank: mine.rank, matches_won: mine.matches_won, matches_lost: mine.matches_lost, sets_won: mine.sets_won, sets_lost: mine.sets_lost, points_ratio: mine.points_ratio } : null,
        ...(isPool ? { pb_finishes: fins } : {}),
      };
    }
  }
  if (brP) {
    const br = (await brP).v;
    const f = pj((br?.matches || []).find((m) => m && String(m.match_id) === nextUp.match_id)?.finishes);
    const side = (v) => (v && typeof v === "object" ? { team_name: v.team_name ?? "", team_id: v.team_id ?? 0, next_match: v.next_match || null, next_ref: v.next_ref || null } : null);
    if (f) nextUp.finishes = { winner: side(f.Winner), looser: side(f.Loser) };
  }

  // Record from the team page (the same numbers as the standings);
  // GraphQL's points_ratio is points won / lost.
  const pw = Number(t.points_won) || 0, pl = Number(t.points_lost) || 0;
  const ds = { matches_won: Number(t.matches_won) || 0, matches_lost: Number(t.matches_lost) || 0, sets_won: Number(t.sets_won) || 0, sets_lost: Number(t.sets_lost) || 0, points_ratio: pl ? pw / pl : 0, rank: 0, seed: null, heading: "None", heading_priority: 0 };
  if (standP) {
    const s = await standP;
    if (s.e) throw s.e; // a finish is the one thing this call can't answer without it
    const row = Object.values(s.v?.teams || {}).flat().find((r) => r && String(r.roster_team_id) === tid);
    if (row) Object.assign(ds, {
      matches_won: Number(row.matches_won) || 0, matches_lost: Number(row.matches_lost) || 0, sets_won: Number(row.sets_won) || 0, sets_lost: Number(row.sets_lost) || 0,
      points_ratio: Number(row.points_ratio) || ds.points_ratio, rank: Number(row.rank) || 0, seed: row.seed_current ?? null,
      heading: row.info?.heading || row.heading_group || "None", heading_priority: row.info?.heading_sort_priority ?? row.heading_sorting_group ?? 0,
    });
  }

  const clubTeams = clubP ? (await clubP).v : null;
  const ct = (Array.isArray(clubTeams) ? clubTeams : []).find((x) => x && String(x.roster_team_id) === tid);
  const divId = idStr(div ?? ct?.division_id);
  const divisionName = divName || (divId ? (await restDivisionNames(esw).catch(() => new Map())).get(divId) ?? null : null);

  return {
    team_id: tid, team_name: t.team_name || null, team_code: t.organization_code || null,
    division_id: divId, division_name: divisionName, master_team_id: idStr(ct?.master_team_id), club_id: idStr(t.roster_club_id),
    external: { club_info: { club_name: t.club_name || null, state: t.state || null } },
    division_standing: ds, ongoing_pool_bracket: ongoing,
    finished_matches: finished, upcoming_matches: upcoming, upcoming_ref_matches: refsUp,
    _source: "rest",
  };
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
// REST list is down. That fallback is NOT the whole window — 10 pages of 20
// from two weeks back cover only a few weeks of a busy season (975 events in
// the 300 days ahead on 11 Oct 2026; page 10 ended 9 Jan) — so its array
// carries complete = false (plus truncated, and why REST failed). A caller
// that must see every event (api/_lib/registration-check.js) treats that like
// no list at all; the REST list's array has complete = true.
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
    const res = rows.map(pick).filter((r) => r.date_start && r.date_start <= e && (r.date_end || r.date_start) >= s && (!st || String(r.state || "").toUpperCase() === st));
    res.complete = true;
    return res;
  } catch (err) {
    const out = [];
    const before = new Date(Date.parse(e + "T00:00:00Z") + 2 * 86400000).toISOString().slice(0, 10);
    const after = new Date(Date.parse(s + "T00:00:00Z") - 14 * 86400000).toISOString().slice(0, 10);
    let truncated = true;
    for (let page = 1; page <= 10; page++) {
      const d = await ottoGql(PAGINATED_EVENTS, { page, pageSize: 20, startAfter: after, startBefore: before, asc: true });
      const p = d.paginatedEvents;
      for (const it of p?.items || []) {
        const ds = Number(it.date_start) > 0 ? new Date(Number(it.date_start)).toISOString().slice(0, 10) : null;
        out.push(pick({ ...it, date_start: ds, date_end: null }));
      }
      if (!p || page >= (p.page_info?.page_count || 1)) { truncated = false; break; }
    }
    // Without end dates, keep events starting in the window (or up to 3 days before it).
    const early = new Date(Date.parse(s + "T00:00:00Z") - 3 * 86400000).toISOString().slice(0, 10);
    const res = out.filter((r) => r.date_start && r.date_start <= e && r.date_start >= early && (!st || String(r.state || "").toUpperCase() === st));
    // Never the whole window (no end dates; maybe cut at 10 pages) — see above.
    Object.assign(res, { complete: false, truncated, why: String(err?.message || err).slice(0, 160) });
    return res;
  }
}

// Parent links. The new site (events.ottoevent.ai) has no per-team page, so the
// team link is the legacy SPA's team route (events.event.teams.team).
export const ottoEventUrl = (eswId) => `https://events.ottoevent.ai/event/${encodeURIComponent(eswId)}`;
export const ottoTeamUrl = (eswId, teamId) => `https://eventslegacy.ottoevent.ai/#/events/${encodeURIComponent(eswId)}/teams/${encodeURIComponent(teamId)}`;
