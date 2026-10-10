// Tournament Hub — one normalized shape for a DS Elite team's schedule and
// results at a tournament, whichever platform runs it (Drew, 10 Oct 2026: "an
// easy way for parents, coaches and directors to see who they are playing and
// when ... like Volleyball Hub ... pulls schedules from AES, Otto, SportWrench").
//
// AES and OTTO (the renamed SportWrench) describe the same weekend very
// differently, so everything downstream — the 5-minute sync, the alerts, the
// public /hub page, the HQ view — works on a TeamSnapshot built here and never
// on raw platform JSON. Pure: no fetch, no Node APIs (the SPA imports this
// too), no clock unless one is passed in.
//
// Times. Both platforms give match times as the venue's wall clock with no
// zone: AES as naive strings ('2026-12-05T09:00:00'), OTTO as epoch ms of the
// wall clock encoded as if it were UTC (and pb_finishes in seconds since
// 1904). A snapshot keeps every time as a venue-local 'YYYY-MM-DDTHH:mm'
// string, and "now" is compared in the same form (localNow(tz)), so nothing
// here ever converts between zones. Platform zones are not trusted — OTTO has
// Paniolo (Fort Worth) down as Pacific/Honolulu — so the zone comes from the
// tournament row (tzForTournament).
//
// Sets are always DS Elite's score first. AES ScoreText is written winner-first
// (not FirstTeam-first), so it is never read; FirstTeamScore/SecondTeamScore
// are oriented by which side our TeamId is on. OTTO's results.sets are
// team_id-first (team_id is "team1", not necessarily us), oriented the same way.
//
// TeamSnapshot (v:1):
// { v:1, platform:'aes'|'otto', event_name, event_url, team_url,
//   division, team_text,
//   record: { mw, ml, sw, sl, pr }|null,
//   pool: { name, play_id?, rank, rank_text, teams }|null, // current or last pool; rank null until the pool is decided; teams = number of teams in it (null if unknown); play_id = AES PlayId
//   last_pool: same shape|null,                    // the pool before `pool` (multi-round pool formats), once its place is known or recoverable
//   finish: { rank, text, overall, flight_text? }|null, // final placing; overall true only when rank/text is the division-wide place (AES OverallRank)
//   matches: Match[], work: Work[], paths: Path[],
//   next: { play, work, live },                    // recompute with withNext(snapshot, localNow(tz))
//   days: ['YYYY-MM-DD'], stamp, done }
// Match = { id, round, play_id?, label, start, end, court, opponent, opponent_club, work_team, sets:[[us,them]], won, final }
// Work  = { id, round, label, start, end, court, teams, final }   // final: the work match has been scored
// Path  = { if, round, start, court, work_start, work_court, pending? } // pending 'reseed': start/court not known yet

// ---------- AES event keys ----------

// AES results keys are ASP.NET HttpServerUtility.UrlTokenEncode of
// "=" + eventId zero-padded to 10 + "=": base64url, '=' padding stripped and
// the pad count appended as a digit. 41412 → "PTAwMDAwNDE0MTI90". Only club
// events (with an eventId) can be computed; scheduler-only events (most Lone
// Star Classic, CTPL, Regionals) use name-based keys and must be read from
// the landing API, never built here.
const b64enc = (s) => btoa(s);
const b64dec = (s) => atob(s);

export function aesKey(eventId) {
  const raw = "=" + String(eventId).padStart(10, "0") + "=";
  const b64 = b64enc(raw);
  const pad = (b64.match(/=+$/) || [""])[0].length;
  return b64.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_") + pad;
}

// The decoded text of any key ("=0000041412=", or "2026_Force_MS_Tournament"
// for a scheduler-only event). UTF-8 safe. Null when it isn't a key.
export function aesKeyText(key) {
  const k = String(key || "");
  if (!/^[A-Za-z0-9_-]+[0-2]$/.test(k)) return null;
  try {
    const body = k.slice(0, -1).replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(Number(k.slice(-1)));
    const bin = b64dec(body);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch { return null; }
}

// eventId for a club-event key, null for a scheduler-only (name) key.
export function aesDecodeKey(key) {
  const m = /^=(\d{10})=$/.exec(aesKeyText(key) || "");
  return m ? Number(m[1]) : null;
}

// ---------- names ----------

// Our name on each platform → the HQ practice_teams.team_name. AES says "DS
// Elite 14 Diamond", OTTO the same, results text adds the region and seed
// ("DS ELITE 14 DIAMOND (LS) (12)"), older registrations say "Dripping Springs
// Elite". Anything without a club prefix is someone else's team (null) unless
// it is already exactly an HQ name. With `known` (the HQ names), a platform
// name that is short of ours resolves when only one fits — "DS Elite 13 Rise"
// → "13 Rise 1" — and a name that fits none is null rather than a phantom team.
const CLUB_PREFIX = /^(?:dripping\s+springs\s+elite|ds\s*elite|dseli|dse)(?:\s+volleyball)?(?:\s+club)?(?=[\s\-:_]|\d|$)[\s\-:_]*/i;
const titleWord = (w) => (/^\d+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
const stripTrailingParens = (s) => { let t = String(s || "").trim(), prev; do { prev = t; t = t.replace(/\s*\([^()]*\)\s*$/, "").trim(); } while (t !== prev); return t; };

export function dseTeamName(platformName, known) {
  if (platformName == null) return null;
  const raw = stripTrailingParens(String(platformName).replace(/\s+/g, " "));
  const knownList = Array.isArray(known) ? known.filter(Boolean).map(String) : null;
  const findKnown = (n) => knownList && knownList.find((k) => k.toLowerCase() === n.toLowerCase());
  let rest;
  if (CLUB_PREFIX.test(raw)) rest = raw.replace(CLUB_PREFIX, "");
  else { const exact = findKnown(raw); return exact || null; }
  // "14U", "14s", "14's" → "14"
  const m = /^(\d{1,2})(?:u|s|'s)?\b\s*(.*)$/i.exec(rest.trim());
  if (!m) return null;
  const words = m[2].split(/[\s\-_]+/).filter(Boolean).map(titleWord);
  const name = [String(Number(m[1])), ...words].join(" ");
  if (!knownList) return words.length ? name : null;
  const exact = findKnown(name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  // ours is short ("13 Rise" → "13 Rise 1")
  const longer = knownList.filter((k) => k.toLowerCase().startsWith(lower + " "));
  if (longer.length === 1) return longer[0];
  // platform's is long ("14 Ruby National" → "14 Ruby")
  const shorter = knownList.filter((k) => lower.startsWith(k.toLowerCase() + " "));
  if (shorter.length === 1) return shorter[0];
  return null;
}

// Opponent / work team text without the trailing seed "(12)" and region
// "(LS)" AES appends ("Alta 14 (AZ) (11)" → "Alta 14").
export function cleanTeamText(s) {
  if (s == null) return null;
  const t = stripTrailingParens(s);
  return t || null;
}

// ---------- time zones and local time ----------

const STATE_TZ = {
  CA: "America/Los_Angeles", NV: "America/Los_Angeles", WA: "America/Los_Angeles", OR: "America/Los_Angeles",
  AZ: "America/Phoenix",
  CO: "America/Denver", UT: "America/Denver", NM: "America/Denver", MT: "America/Denver", WY: "America/Denver", ID: "America/Boise",
  HI: "Pacific/Honolulu", AK: "America/Anchorage", PR: "America/Puerto_Rico",
  FL: "America/New_York", GA: "America/New_York", NY: "America/New_York", NC: "America/New_York", SC: "America/New_York",
  VA: "America/New_York", WV: "America/New_York", PA: "America/New_York", OH: "America/New_York", MI: "America/Detroit",
  IN: "America/Indiana/Indianapolis", KY: "America/New_York", MD: "America/New_York", DE: "America/New_York", DC: "America/New_York",
  NJ: "America/New_York", MA: "America/New_York", CT: "America/New_York", RI: "America/New_York", NH: "America/New_York",
  VT: "America/New_York", ME: "America/New_York",
  TN: "America/Chicago", TX: "America/Chicago", OK: "America/Chicago", LA: "America/Chicago", AR: "America/Chicago",
  MS: "America/Chicago", AL: "America/Chicago", MO: "America/Chicago", IA: "America/Chicago", MN: "America/Chicago",
  WI: "America/Chicago", IL: "America/Chicago", KS: "America/Chicago", NE: "America/Chicago", SD: "America/Chicago", ND: "America/Chicago",
};
const STATE_NAMES = {
  california: "CA", nevada: "NV", washington: "WA", oregon: "OR", arizona: "AZ", colorado: "CO", utah: "UT", "new mexico": "NM",
  hawaii: "HI", florida: "FL", georgia: "GA", "new york": "NY", "north carolina": "NC", "south carolina": "SC", virginia: "VA",
  pennsylvania: "PA", ohio: "OH", michigan: "MI", indiana: "IN", kentucky: "KY", tennessee: "TN", maryland: "MD", "new jersey": "NJ",
  massachusetts: "MA", connecticut: "CT", "rhode island": "RI", texas: "TX", oklahoma: "OK", louisiana: "LA", illinois: "IL", missouri: "MO",
};
// Venues written without a state ("Anaheim") — the travel cities DS Elite actually goes to.
const CITY_TZ = [
  [/\b(anaheim|long beach|los angeles|san diego|seal beach|ontario|las vegas|henderson|reno|sacramento|san jose)\b/i, "America/Los_Angeles"],
  [/\b(phoenix|mesa|scottsdale|tucson)\b/i, "America/Phoenix"],
  [/\b(denver|salt lake|albuquerque)\b/i, "America/Denver"],
  [/\b(honolulu|oahu)\b/i, "Pacific/Honolulu"],
  [/\b(orlando|kissimmee|tampa|daytona|atlanta|louisville|indianapolis|columbus|detroit|baltimore|philadelphia|new york|boston|washington,? dc)\b/i, "America/New_York"],
];
// Cities on the other side of their state's time-zone line: East Tennessee is
// Eastern (Nashville/Memphis Central), El Paso is Mountain, NW/SW Indiana,
// western Kentucky and the Florida panhandle are Central.
const CITY_OVERRIDE = [
  [/\b(knoxville|chattanooga|johnson city|kingsport|gatlinburg|pigeon forge)\b/i, "America/New_York"],
  [/\bel paso\b/i, "America/Denver"],
  [/\b(crown point|gary|hammond|merrillville|valparaiso|schererville|evansville|bowling green,? ky|paducah|owensboro|pensacola|panama city|destin|fort walton)\b/i, "America/Chicago"],
];

export function tzForTournament(t) {
  if (!t) return "America/Chicago";
  if (t.time_zone && String(t.time_zone).trim()) return String(t.time_zone).trim();
  for (const field of [t.location, t.venue]) {
    const s = String(field || "");
    if (!s) continue;
    const over = CITY_OVERRIDE.find(([re]) => re.test(s));
    if (over) return over[1];
    // Uppercase two-letter codes only, last one wins ("La Vernia, Texas 78121, TX").
    const codes = [...s.matchAll(/\b([A-Z]{2})\b/g)].map((m) => m[1]).filter((c) => STATE_TZ[c]);
    let st = codes.length ? codes[codes.length - 1] : null;
    if (!st) { const nm = Object.keys(STATE_NAMES).find((n) => new RegExp("\\b" + n + "\\b", "i").test(s)); if (nm) st = STATE_NAMES[nm]; }
    if (st) return STATE_TZ[st];
    const city = CITY_TZ.find(([re]) => re.test(s));
    if (city) return city[1];
  }
  return "America/Chicago";
}

const dtfCache = new Map();
const dtf = (tz) => {
  if (!dtfCache.has(tz)) dtfCache.set(tz, new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }));
  return dtfCache.get(tz);
};

// Wall clock in `tz` as 'YYYY-MM-DDTHH:mm' — the same form as every snapshot time.
export function localNow(tz, date = new Date()) {
  let parts;
  try { parts = dtf(tz || "America/Chicago").formatToParts(date); } catch { parts = dtf("America/Chicago").formatToParts(date); }
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const hh = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hh}:${p.minute}`;
}

// Local-string arithmetic, done in UTC so no zone ever leaks in.
const localToMs = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(s || "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : NaN; };
const msToLocal = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 16) : null);
export const addMinutes = (local, n) => msToLocal(localToMs(local) + n * 60000);

// AES '2026-05-16T08:59:59' → '2026-05-16T09:00' (its ends are a second shy of the hour).
function aesLocal(s) {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?/.exec(String(s));
  if (!m) return null;
  return m[2] === "59" ? addMinutes(m[1], 1) : m[1];
}
// OTTO epoch ms of the wall clock as if UTC → local string.
const ottoLocal = (ms) => { const n = Number(ms); return n > 0 ? msToLocal(n) : null; };
// OTTO pb_finishes / finishes secs are seconds since 1904-01-01.
const otto1904Local = (secs) => { const n = Number(secs); return n > 2082844800 ? msToLocal((n - 2082844800) * 1000) : null; };

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function fmtTime(local) {
  const m = /T(\d{2}):(\d{2})/.exec(String(local || ""));
  if (!m) return "";
  const h = +m[1], mi = m[2];
  return `${h % 12 === 0 ? 12 : h % 12}:${mi} ${h < 12 ? "AM" : "PM"}`;
}
export function fmtDay(x) {
  if (x instanceof Date) return `${DOW[x.getDay()]} ${x.getMonth() + 1}/${x.getDate()}`;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(x || ""));
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${DOW[d.getUTCDay()]} ${+m[2]}/${+m[3]}`;
}

export function ordinal(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  const s = v % 100 >= 11 && v % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[v % 10] || "th");
  return v + s;
}

// Every date from start to end inclusive ('YYYY-MM-DD'); [] past 10 days so a
// season-long league (AES has power leagues running Sep–Dec as one event)
// doesn't become 90 "event days".
function dateRange(start, end) {
  const a = localToMs(String(start || "").slice(0, 10)), b = localToMs(String(end || start || "").slice(0, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || b - a > 9 * 86400000) return [];
  const out = [];
  for (let t = a; t <= b; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
const uniqSorted = (arr) => [...new Set(arr.filter(Boolean))].sort();
const byStart = (a, b) => String(a.start || "9999").localeCompare(String(b.start || "9999")) || String(a.label || "").localeCompare(String(b.label || ""), undefined, { numeric: true });
const round3 = (x) => (x == null || !Number.isFinite(Number(x)) ? null : Math.round(Number(x) * 1000) / 1000);

function recordFromMatches(matches) {
  let mw = 0, ml = 0, sw = 0, sl = 0, pf = 0, pa = 0, any = false;
  for (const m of matches) {
    if (!m.final) continue;
    any = true;
    if (m.won === true) mw++; else if (m.won === false) ml++;
    for (const [a, b] of m.sets) { if (a > b) sw++; else if (b > a) sl++; pf += a; pa += b; }
  }
  return any ? { mw, ml, sw, sl, pr: pa ? round3(pf / pa) : null } : null;
}

// Work duties a platform stops reporting once they're done (AES schedule/work
// and OTTO upcoming ref matches only list what's ahead) are kept from the
// previous snapshot, so a parent can still see today's whole play + work day.
// With the venue clock (nowLocal) a duty that has started and is no longer
// listed was worked and is kept; one still ahead that vanished was reassigned
// and is dropped. Without a clock, only duties before the last final match /
// first listed duty are kept. goneDone: the platform drops a duty the moment
// it is scored (OTTO), so a kept one is marked final.
function carryWork(work, prev, matches, nowLocal = null, goneDone = false) {
  if (!prev || !Array.isArray(prev.work) || !prev.work.length) return work;
  const have = new Set(work.map((w) => w.id));
  let keep;
  if (nowLocal) {
    const now = String(nowLocal);
    keep = (w) => w.start <= now;
  } else {
    const lastFinal = matches.filter((m) => m.final).map((m) => m.start).sort().pop();
    const firstNew = work.map((w) => w.start).filter(Boolean).sort()[0];
    const cutoff = [lastFinal, firstNew].filter(Boolean).sort().pop();
    if (!cutoff) return work;
    keep = (w) => w.start < cutoff;
  }
  const kept = prev.work.filter((w) => w && !have.has(w.id) && w.start && keep(w)).map((w) => (goneDone && !w.final ? { ...w, final: true } : w));
  return kept.length ? [...work, ...kept].sort(byStart) : work;
}

// A pool's rank, once known, survives the team moving on to a bracket (AES
// current switches play, OTTO's ongoing pool moves on); the previous snapshot
// is the memory. Same pool = same name and (AES) same PlayId — Lone Star
// Classic names a round-1 and a round-2 pool "Pool 1". A snapshot stored
// before play_id existed matches on name alone.
const samePool = (a, b) => !!a && !!b && a.name === b.name && (a.play_id === undefined || b.play_id === undefined || a.play_id === b.play_id);
function carryPool(pool, prev) {
  const pp = prev && prev.pool;
  if (!pool) return pp || null;
  if (pool.rank == null && samePool(pp, pool) && pp.rank != null) return { ...pool, rank: pp.rank, rank_text: pp.rank_text, teams: pool.teams ?? pp.teams };
  return pool;
}

// The pool before `pool` in multi-round pool play: `found` (from this poll's
// data, rank possibly still null), else the previous snapshot's pool if the
// team has since moved to a new one, else its last_pool. A rank known in an
// earlier poll is kept.
function carryLastPool(found, pool, prev) {
  const cands = [found, prev?.pool, prev?.last_pool].filter((p) => p && p.name && !samePool(p, pool));
  const lp = cands[0] || null;
  if (!lp || lp.rank != null) return lp;
  const known = cands.find((p) => samePool(p, lp) && p.rank != null);
  return known ? { ...lp, rank: known.rank, rank_text: known.rank_text, teams: lp.teams ?? known.teams } : lp;
}

// "If we finish 2nd" when that place goes to a round the director reseeds
// first: no time or court yet, but the place still leads somewhere.
const reseedPath = (iff, round = null) => ({ if: iff, round: round ? `${round}, after reseed (time TBD)` : "Next round after reseed (time TBD)", start: null, court: null, work_start: null, work_court: null, pending: "reseed" });

function snapshotDays(eventStart, eventEnd, matches, work) {
  const fromMatches = [...matches, ...work].map((x) => String(x.start || "").slice(0, 10));
  return uniqSorted([...dateRange(eventStart, eventEnd), ...fromMatches]);
}

// ---------- AES ----------

// A play's name for parents. Lone Star Classic reuses "Pool 1" in every
// round, so a bare "Pool N" from round 2 on gets its round ("Round 2 Pool 1",
// the way ottoRoundName names OTTO's).
function aesPlayName(p) {
  if (!p) return null;
  const name = p.FullName || p.CompleteShortName || null;
  if (!name || !/^pool\s+\w+$/i.test(name)) return name;
  const r = /^round\s+(\d+)\b/i.exec(p.RoundName || "") || /^round\s+(\d+)\b/i.exec(p.CompleteFullName || "") || /^R(\d+)G\d/i.exec(p.CompleteShortName || "");
  return r && Number(r[1]) > 1 ? `Round ${Number(r[1])} ${name}` : name;
}

// Inputs are raw AES JSON: event = results /api/event/{key} (or null);
// past/current/future/work = the team's /schedule/{which} arrays (future null
// on 204); standing = its odata standings row; next = its nextassignments row.
// Optional: teamId (else from standing/next), stamp (LastUpdatedTimestamp),
// poolsheet (/poolsheet/{playId} of the current or last pool — the only AES
// source of a pool's finishing order and of the teams in a work match; see
// aesPoolPlayId), prev (the stored snapshot, for carry-over), nowLocal (the
// venue clock, localNow(tz) — lets a worked duty AES no longer lists stay on
// the day list; see carryWork).
export function aesTeamSnapshot({ event = null, eventUrl = null, teamUrl = null, past = null, current = null, future = null, work = null, standing = null, next = null, teamId = null, stamp = null, poolsheet = null, prev = null, nowLocal = null } = {}) {
  const rows = [
    ...(Array.isArray(past) ? past : []).filter((r) => r && r.Match).map((r) => ({ m: r.Match, play: r.Play, src: 0 })),
    ...(Array.isArray(current) ? current : []).flatMap((r) => (r && Array.isArray(r.Matches) ? r.Matches : []).map((m) => ({ m, play: r.Play, src: 1 }))),
  ];
  let tid = Number(teamId ?? standing?.TeamId ?? next?.TeamId);
  if (!Number.isFinite(tid)) {
    // Fall back to the team that is in every match.
    const count = new Map();
    for (const { m } of rows) for (const id of [m.FirstTeamId, m.SecondTeamId]) if (id != null) count.set(id, (count.get(id) || 0) + 1);
    tid = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  const psPlay = poolsheet && poolsheet.Pool ? poolsheet.Pool : null;
  if (poolsheet && Array.isArray(poolsheet.Matches)) {
    for (const m of poolsheet.Matches) if (m && (m.FirstTeamId === tid || m.SecondTeamId === tid)) rows.push({ m, play: psPlay, src: 2 });
  }
  // One row per MatchId: a scored version beats an unscored one, else the fresher source.
  const byId = new Map();
  for (const r of rows) {
    const id = r.m.MatchId;
    const cur = byId.get(id);
    if (!cur || (!!r.m.HasScores >= !!cur.m.HasScores)) byId.set(id, r.play ? r : { ...r, play: cur?.play });
  }
  const futureArr = Array.isArray(future) ? future : [];
  // nextassignments knows the decided next match before (or as) it reaches a
  // schedule list — e.g. the crossover right after a pool completes.
  if (next && next.NextMatch && next.NextMatch.MatchId != null && !byId.has(next.NextMatch.MatchId)) {
    const nm = next.NextMatch;
    const fp = futureArr.find((f) => f?.NextMatch?.MatchId === nm.MatchId);
    byId.set(nm.MatchId, {
      m: { MatchId: nm.MatchId, FirstTeamId: tid, SecondTeamId: next.OpponentTeamId, SecondTeamName: next.OpponentTeamName, SecondTeamText: next.OpponentTeamText, HasScores: false, Sets: [], Court: nm.Court, ScheduledStartDateTime: nm.ScheduledStartDateTime, ScheduledEndDateTime: nm.ScheduledEndDateTime, TypeOfOutcome: 0 },
      play: fp?.NextPlay || null, src: 3,
    });
  }
  const nextOppClub = next?.NextMatch ? { id: next.NextMatch.MatchId, club: next.OpponentClub?.Name || null } : null;

  const matches = [...byId.values()].map(({ m, play }) => {
    // We're FirstTeam unless the match says we're SecondTeam.
    const us1 = m.SecondTeamId !== tid;
    const oppName = us1 ? (m.SecondTeamName || cleanTeamText(m.SecondTeamText)) : (m.FirstTeamName || cleanTeamText(m.FirstTeamText));
    const sets = (Array.isArray(m.Sets) ? m.Sets : [])
      .filter((s) => s && s.FirstTeamScore != null && s.SecondTeamScore != null)
      .map((s) => (us1 ? [Number(s.FirstTeamScore), Number(s.SecondTeamScore)] : [Number(s.SecondTeamScore), Number(s.FirstTeamScore)]));
    const final = !!m.HasScores || Number(m.TypeOfOutcome) > 0;
    let won = null;
    if (final) {
      const usWon = us1 ? m.FirstTeamWon : m.SecondTeamWon, themWon = us1 ? m.SecondTeamWon : m.FirstTeamWon;
      if (usWon === true) won = true;
      else if (themWon === true) won = false;
      else { const w = sets.filter(([a, b]) => a > b).length, l = sets.filter(([a, b]) => b > a).length; won = w === l ? null : w > l; }
    }
    const wt = cleanTeamText(m.WorkTeamText);
    return {
      id: String(m.MatchId),
      round: aesPlayName(play),
      play_id: play?.PlayId ?? null,
      label: m.MatchShortName || m.MatchFullName || null,
      start: aesLocal(m.ScheduledStartDateTime),
      end: aesLocal(m.ScheduledEndDateTime),
      court: m.Court?.Name || null,
      opponent: oppName || null,
      opponent_club: nextOppClub && nextOppClub.id === m.MatchId ? nextOppClub.club : null,
      work_team: wt && !/^no work team$/i.test(wt) ? wt : null,
      sets, won, final,
    };
  }).sort(byStart);

  // Work: schedule/work + nextassignments.WorkMatchs + (with a poolsheet)
  // every pool match we're the work team for, which also names the two teams
  // and says whether it has been scored (schedule/work never does).
  const psById = new Map((poolsheet?.Matches || []).filter(Boolean).map((m) => [String(m.MatchId), m]));
  const workMap = new Map();
  const addWork = (mm, play) => {
    if (!mm || mm.MatchId == null) return;
    const ps = psById.get(String(mm.MatchId));
    const a = ps ? (ps.FirstTeamName || cleanTeamText(ps.FirstTeamText)) : null, b = ps ? (ps.SecondTeamName || cleanTeamText(ps.SecondTeamText)) : null;
    const prevW = workMap.get(String(mm.MatchId));
    workMap.set(String(mm.MatchId), {
      id: String(mm.MatchId),
      round: aesPlayName(play) || prevW?.round || (ps ? aesPlayName(psPlay) : null) || null,
      label: ps?.MatchShortName || mm.MatchShortName || prevW?.label || null,
      start: aesLocal(mm.ScheduledStartDateTime) || prevW?.start || null,
      end: aesLocal(mm.ScheduledEndDateTime) || prevW?.end || null,
      court: mm.Court?.Name || prevW?.court || null,
      teams: a && b ? `${a} vs ${b}` : prevW?.teams || null,
      final: ps ? !!ps.HasScores || Number(ps.TypeOfOutcome) > 0 : !!(mm.HasScores || prevW?.final),
    });
  };
  for (const r of Array.isArray(work) ? work : []) addWork(r?.Match, r?.Play);
  for (const w of Array.isArray(next?.WorkMatchs) ? next.WorkMatchs : []) addWork(w, null);
  for (const m of poolsheet?.Matches || []) if (m && m.WorkTeamId === tid) addWork(m, psPlay);
  const workList = carryWork([...workMap.values()].sort(byStart), prev, matches, nowLocal);

  // Pool: the current play if it's a pool, else the last pool played. Keyed
  // by PlayId as well as name (LSC has a "Pool 1" in every round).
  const isPool = (p) => p && Number(p.Type) === 0;
  const curPoolPlay = (Array.isArray(current) ? current : []).map((r) => r?.Play).find(isPool);
  const lastPastPool = [...(Array.isArray(past) ? past : [])].filter((r) => isPool(r?.Play)).sort((a, b) => String(a.Match?.ScheduledStartDateTime).localeCompare(String(b.Match?.ScheduledStartDateTime))).pop()?.Play;
  const poolPlay = curPoolPlay || (isPool(psPlay) ? psPlay : null) || lastPastPool || null;
  let pool = null;
  if (poolPlay) {
    pool = { name: aesPlayName(poolPlay), play_id: poolPlay.PlayId ?? null, rank: null, rank_text: null, teams: null };
    if (psPlay && psPlay.PlayId === poolPlay.PlayId && Array.isArray(psPlay.Teams)) {
      pool.teams = psPlay.Teams.length || null;
      const row = psPlay.Teams.find((t) => t.TeamId === tid);
      if (row && row.FinishRank != null) { pool.rank = Number(row.FinishRank); pool.rank_text = row.FinishRankText || ordinal(row.FinishRank); }
    }
  }
  pool = carryPool(pool, prev);
  const lastPool = carryLastPool(null, pool, prev);

  // "If we finish Nth" — until the current play is decided: its pool place
  // is known, or one of the conditional next matches is already ours (a
  // bracket round is over; AES clears `future` a poll or two later).
  const curPlay = (Array.isArray(current) ? current : []).map((r) => r?.Play).find(Boolean) || null;
  const decided = (pool && pool.rank != null && curPoolPlay && pool.play_id === curPoolPlay.PlayId)
    || futureArr.some((f) => f?.NextMatch?.MatchId != null && byId.has(f.NextMatch.MatchId));
  // A row with no NextMatch is the end of play, unless AES says the next
  // round is waiting on a reseed (then the place still leads somewhere).
  const paths = decided ? [] : futureArr.filter((f) => f && (f.NextMatch || f.NextPendingReseed === true)).map((f) => {
    const txt = String(f.PotentialRankText || "");
    const mm = /^(\d+(?:st|nd|rd|th))\s*-\s*(.+)$/i.exec(txt);
    const where = aesPlayName(curPlay) || (mm ? mm[2] : null);
    const iff = mm ? `${mm[1]} in ${where}` : (f.PotentialRank != null && where ? `${ordinal(f.PotentialRank)} in ${where}` : txt || null);
    const nextName = aesPlayName(f.NextPlay);
    if (!f.NextMatch) return reseedPath(iff, nextName);
    return {
      if: iff,
      round: nextName,
      start: aesLocal(f.NextMatch.ScheduledStartDateTime),
      court: f.NextMatch.Court?.Name || null,
      work_start: aesLocal(f.WorkMatch?.ScheduledStartDateTime),
      work_court: f.WorkMatch?.Court?.Name || null,
    };
  });

  const record = standing
    ? { mw: Number(standing.MatchesWon) || 0, ml: Number(standing.MatchesLost) || 0, sw: Number(standing.SetsWon) || 0, sl: Number(standing.SetsLost) || 0, pr: Number(standing.SetsWon) + Number(standing.SetsLost) > 0 ? round3(standing.PointRatio) : null }
    : recordFromMatches(matches);
  // FinishRank / FinishRankText are the place inside the team's flight (Gold
  // 1-4, Silver 5-10 → Silver's winner has FinishRank 1); OverallRank is the
  // division placing. Show the overall one; keep the flight place as context.
  let finish = prev?.finish || null;
  if (standing && standing.FinishRank != null) {
    const fr = Number(standing.FinishRank), ov = standing.OverallRank != null && Number(standing.OverallRank) > 0 ? Number(standing.OverallRank) : null;
    const frText = standing.FinishRankText || ordinal(fr);
    finish = ov != null
      ? { rank: ov, text: ordinal(ov), overall: true, flight_text: fr !== ov ? frText : null }
      : { rank: fr, text: frText, overall: false };
  }

  const pending = matches.some((m) => !m.final);
  const pendingWork = new Set([...(Array.isArray(work) ? work : []).map((r) => String(r?.Match?.MatchId)), ...(Array.isArray(next?.WorkMatchs) ? next.WorkMatchs : []).map((w) => String(w?.MatchId))]);
  // A duty AES still lists, or a pool match we work that the poolsheet shows
  // unscored (AES drops it from schedule/work ~10 min after its start).
  const workOpen = workList.some((w) => !w.final && (pendingWork.has(w.id) || psById.has(w.id)));
  const done = !!finish || !!event?.IsOver || (matches.length > 0 && !pending && !paths.length && !next?.NextMatch && !next?.NextPendingReseed && !(Array.isArray(work) && work.length) && !workOpen);

  const platNext = next?.NextMatch ? matches.find((m) => m.id === String(next.NextMatch.MatchId) && !m.final) : null;
  const snap = {
    v: 1, platform: "aes",
    event_name: event?.Name || prev?.event_name || null,
    event_url: eventUrl, team_url: teamUrl,
    division: String(standing?.Division?.Name || next?.TeamDivision?.Name || prev?.division || "").trim() || null,
    team_text: standing?.TeamText || next?.TeamText || prev?.team_text || null,
    record, pool, last_pool: lastPool, finish,
    matches, work: workList, paths,
    next: { play: platNext || matches.find((m) => !m.final) || null, work: workList.find((w) => !w.final && pendingWork.has(w.id)) || null, live: null },
    days: snapshotDays(event?.StartDate, event?.EndDate, matches, workList),
    stamp: stamp || null,
    done,
  };
  return snap;
}

// Which pool's /poolsheet to fetch for aesTeamSnapshot: the current play if
// it's a pool, else the most recent pool in past. Null if none (bracket-only).
export function aesPoolPlayId({ past = null, current = null } = {}) {
  const cur = (Array.isArray(current) ? current : []).map((r) => r?.Play).find((p) => p && Number(p.Type) === 0);
  if (cur) return cur.PlayId;
  const last = [...(Array.isArray(past) ? past : [])].filter((r) => r?.Play && Number(r.Play.Type) === 0).sort((a, b) => String(a.Match?.ScheduledStartDateTime).localeCompare(String(b.Match?.ScheduledStartDateTime))).pop();
  return last ? last.Play.PlayId : null;
}

// ---------- OTTO ----------

// OTTO match codes are R{round}[D{div}]P{pool}M{match} / R1X2M1 (crossover).
// "R1P4" → "Pool 4", "R2D1P8" → "Round 2 Div 1 Pool 8", others stay as given.
export function ottoRoundName(code) {
  if (!code) return null;
  const c = String(code).trim();
  const m = /^R(\d+)(?:D(\d+))?([PX])(\d+)$/i.exec(c);
  if (!m) return c;
  const parts = [];
  if (+m[1] > 1) parts.push(`Round ${m[1]}`);
  if (m[2]) parts.push(`Div ${m[2]}`);
  parts.push((m[3].toUpperCase() === "P" ? "Pool " : "Crossover ") + m[4]);
  return parts.join(" ");
}
const ottoCode = (matchName) => { const s = String(matchName || ""); const m = /^(.*?)M(\d+)$/.exec(s); return m ? { round: m[1] || null, label: "M" + m[2] } : { round: s || null, label: null }; };
const parseSet = (s) => { const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(s || "")); return m ? [Number(m[1]), Number(m[2])] : null; };
const PLAY_DONE = /tournament play complete/i;

// fav = one item of favoriteTeams (see api/_lib/tournament-sources.js FAVORITE_TEAMS);
// event = eventEsw (or null). Optional prev (stored snapshot), stamp, and
// pools = ottoDivisionPools(...) for the team's division — favoriteTeams
// forgets a pool the moment the team leaves it (ongoing_pool_bracket moves on
// or goes null), so this is the only way to name a finished pool's places
// (pool, and last_pool when the team has gone on to another pool). nowLocal:
// the venue clock, as for aesTeamSnapshot.
export function ottoTeamSnapshot({ event = null, eventUrl = null, teamUrl = null, fav = null, prev = null, stamp = null, pools = null, nowLocal = null } = {}) {
  const f = fav || {};
  const tid = String(f.team_id ?? "");
  const ongoing = f.ongoing_pool_bracket || null;
  const roundOf = (m) => {
    const code = ottoCode(m.match_name).round;
    const uuid = m.external?.pool_bracket_info?.uuid || m.pool_bracket_id;
    if (ongoing && uuid && uuid === ongoing.uuid && Number(ongoing.is_pool) === 0) return ongoing.name || ongoing.display_name || ottoRoundName(code);
    return ottoRoundName(code);
  };
  const toMatch = (m, final) => {
    const us1 = String(m.team_id) === tid;
    const ex = m.external || {};
    const sets = final ? (m.results?.sets || []).map(parseSet).filter(Boolean).map(([a, b]) => (us1 ? [a, b] : [b, a])) : [];
    let won = null;
    if (final) {
      const w = String(m.results?.winner ?? "");
      if (w === "1" || w === "2") won = us1 ? w === "1" : w === "2";
      else if (m.results?.winner_team?.roster_team_id != null) won = String(m.results.winner_team.roster_team_id) === tid;
      else { const a = sets.filter(([x, y]) => x > y).length, b = sets.filter(([x, y]) => y > x).length; won = a === b ? null : a > b; }
    }
    const start = ottoLocal(m.secs_start);
    return {
      id: String(m.match_id),
      round: roundOf(m),
      label: ottoCode(m.match_name).label,
      start,
      end: ottoLocal(m.secs_end) || (start ? addMinutes(start, 60) : null),
      court: ex.court_info?.short_name || null,
      opponent: (us1 ? ex.opponent_display_name : ex.team_display_name) || null,
      opponent_club: null,
      work_team: ex.ref_team_display_name || null,
      sets, won, final,
    };
  };
  const byId = new Map();
  for (const m of Array.isArray(f.upcoming_matches) ? f.upcoming_matches : []) if (m) byId.set(String(m.match_id), toMatch(m, false));
  for (const m of Array.isArray(f.finished_matches) ? f.finished_matches : []) if (m) byId.set(String(m.match_id), toMatch(m, true));
  const matches = [...byId.values()].sort(byStart);

  // OTTO drops a ref match from upcoming_ref_matches as soon as it is scored.
  const work = carryWork((Array.isArray(f.upcoming_ref_matches) ? f.upcoming_ref_matches : []).filter(Boolean).map((m) => {
    const ex = m.external || {};
    const start = ottoLocal(m.secs_start);
    return {
      id: String(m.match_id), round: roundOf(m), label: ottoCode(m.match_name).label,
      start, end: ottoLocal(m.secs_end) || (start ? addMinutes(start, 60) : null),
      court: ex.court_info?.short_name || null,
      teams: ex.team_display_name && ex.opponent_display_name ? `${ex.team_display_name} vs ${ex.opponent_display_name}` : null,
      final: false,
    };
  }).sort(byStart), prev, matches, nowLocal, true);

  // A finished pool's places come from `pools` (ottoDivisionPools), by uuid.
  const poolUuid = (m) => m.external?.pool_bracket_info?.uuid || m.pool_bracket_id || null;
  const finishedPoolMatches = (Array.isArray(f.finished_matches) ? f.finished_matches : []).filter((m) => m && Number(m.external?.pool_bracket_info?.is_pool) === 1).sort((a, b) => Number(a.secs_start) - Number(b.secs_start));
  const poolFromMatch = (m) => {
    const p = { name: ottoRoundName(ottoCode(m.match_name).round), rank: null, rank_text: null, teams: null };
    const pb = Array.isArray(pools) ? pools.find((x) => x && x.uuid === poolUuid(m)) : null;
    if (pb) {
      const fins = Array.isArray(pb.pb_finishes) ? pb.pb_finishes : [];
      const idx = fins.findIndex((x) => x && String(x.team_id) === tid);
      p.teams = (Array.isArray(pb.pb_stats) && pb.pb_stats.length) || fins.length || null;
      if (idx >= 0) { p.rank = idx + 1; p.rank_text = ordinal(idx + 1); }
    }
    return p;
  };
  // One "if" path from a pb_finishes / finishes entry. "Pending reseed" (no
  // time yet) is still a place that goes on; "tournament play complete" isn't.
  const finishPath = (iff, nm, nr) => {
    if (!nm || PLAY_DONE.test(nm.display_name || "")) return null;
    if (!otto1904Local(nm.secs_start)) return /pending reseed/i.test(nm.display_name || "") ? reseedPath(iff) : null;
    const ref = nr && !PLAY_DONE.test(nr.display_name || "") ? nr : null;
    return { if: iff, round: ottoRoundName(ottoCode(nm.display_name).round), start: otto1904Local(nm.secs_start), court: nm.court || null, work_start: ref ? otto1904Local(ref.secs_start) : null, work_court: ref?.court || null };
  };

  // Pool: the ongoing pool. OTTO fills pb_finishes[i].team_id only once the
  // pool is decided, so our index there is our finishing place; before that
  // the live pb rank is provisional and not shown.
  let pool = null, paths = [], curUuid = null;
  if (ongoing && Number(ongoing.is_pool) === 1) {
    const fins = Array.isArray(ongoing.pb_finishes) ? ongoing.pb_finishes : [];
    const name = ottoRoundName(ongoing.display_name) || ongoing.name || null;
    const idx = fins.findIndex((x) => x && String(x.team_id) === tid);
    pool = { name, rank: idx >= 0 ? idx + 1 : null, rank_text: idx >= 0 ? ordinal(idx + 1) : null, teams: fins.length || null };
    curUuid = ongoing.uuid || null;
    if (idx < 0) paths = fins.map((x, i) => finishPath(`${ordinal(i + 1)} in ${name}`, x?.next_match, x?.next_ref)).filter(Boolean);
  } else {
    // In a bracket or done: the last pool we played in — its places from
    // `pools` when given, else from prev if a poll caught it decided.
    const lastPoolMatch = finishedPoolMatches[finishedPoolMatches.length - 1];
    if (lastPoolMatch) { pool = poolFromMatch(lastPoolMatch); curUuid = poolUuid(lastPoolMatch); }
  }
  pool = carryPool(pool, prev);
  // The pool before that, in pool-to-pool rounds (R1D1P6 → R2D1P6). OTTO
  // seeds round 2 the moment round 1 is decided, so a poll rarely sees the
  // round-1 place in ongoing_pool_bracket; `pools` or an earlier poll has it.
  const prevPoolMatch = finishedPoolMatches.filter((m) => poolUuid(m) !== curUuid).pop();
  const lastPool = carryLastPool(prevPoolMatch ? poolFromMatch(prevPoolMatch) : null, pool, prev);
  // Bracket: "if we win / lose" from the next match's finishes.
  if (!paths.length) {
    const nextUp = (Array.isArray(f.upcoming_matches) ? f.upcoming_matches : []).filter(Boolean).sort((a, b) => Number(a.secs_start) - Number(b.secs_start))[0];
    const fin = nextUp?.finishes;
    if (fin) {
      const lab = ottoCode(nextUp.match_name).label || "next match";
      for (const [k, word] of [["winner", "Win"], ["looser", "Lose"]]) {
        const p = finishPath(`${word} ${lab}`, fin[k]?.next_match, fin[k]?.next_ref);
        if (p) paths.push(p);
      }
    }
  }

  const ds = f.division_standing || null;
  const record = ds && (Number(ds.matches_won) + Number(ds.matches_lost) > 0 || !matches.some((m) => m.final))
    ? { mw: Number(ds.matches_won) || 0, ml: Number(ds.matches_lost) || 0, sw: Number(ds.sets_won) || 0, sl: Number(ds.sets_lost) || 0, pr: Number(ds.sets_won) + Number(ds.sets_lost) > 0 ? round3(ds.points_ratio) : null }
    : recordFromMatches(matches);
  const upcomingCount = (f.upcoming_matches || []).length, refCount = (f.upcoming_ref_matches || []).length;
  // division_standing.rank is 0 until OTTO ranks the division at the end. It
  // is a tied rank within a heading (every "Gold 1" pool winner of SoCal Cup
  // 16s is rank 1), so a finish with a heading is not called "overall".
  const heading = ds && ds.heading && !/^none$/i.test(ds.heading) ? String(ds.heading) : null;
  const finish = ds && Number(ds.rank) > 0 && !upcomingCount
    ? { rank: Number(ds.rank), text: ordinal(ds.rank) + (heading ? ` (${heading})` : ""), overall: !heading }
    : (prev?.finish || null);
  const done = !!finish || (matches.some((m) => m.final) && !upcomingCount && !refCount && !ongoing);

  return {
    v: 1, platform: "otto",
    event_name: event?.long_name || prev?.event_name || null,
    event_url: eventUrl, team_url: teamUrl,
    division: f.division_name ? String(f.division_name).trim() : prev?.division || null,
    team_text: f.team_name || prev?.team_text || null,
    record, pool, last_pool: lastPool, finish,
    matches, work, paths,
    next: { play: matches.find((m) => !m.final) || null, work: work.find((w) => (f.upcoming_ref_matches || []).some((r) => r && String(r.match_id) === w.id)) || null, live: null },
    days: snapshotDays(ottoLocal(event?.date_start), ottoLocal(event?.date_end), matches, work),
    stamp: stamp || null,
    done,
  };
}

// ---------- "now" ----------

// The NEXT card, judged at the venue's wall clock (nowLocal from localNow(tz)).
//   live: the earliest of today's play matches that has started and has no
//         score yet. Courts run an hour or two behind and AES/OTTO post the
//         score only when the match is over, so it stays live until scored —
//         at most LIVE_MAX_MIN after its start, and not once a later match of
//         ours is final (then it was played and just never scored)
//   play: the first non-final play match after the live one; with nothing
//         live, the first starting at or after now - 15 min
//   work: first work duty not yet scored whose end is after now
const LIVE_MAX_MIN = 240;
export function withNext(snapshot, nowLocal) {
  if (!snapshot) return snapshot;
  const now = String(nowLocal || "");
  const ms = Array.isArray(snapshot.matches) ? snapshot.matches : [];
  const soonest = addMinutes(now, -15);
  const today = now.slice(0, 10);
  const lastFinal = ms.filter((m) => m.final && m.start).map((m) => m.start).sort().pop() || "";
  const liveAt = ms.findIndex((m) => !m.final && m.start && m.start <= now && m.start.slice(0, 10) === today && m.start > lastFinal && now < addMinutes(m.start, LIVE_MAX_MIN));
  const live = liveAt >= 0 ? ms[liveAt] : null;
  const play = (live ? ms.slice(liveAt + 1) : ms).find((m) => !m.final && m.start && (live || m.start >= soonest)) || null;
  const work = (Array.isArray(snapshot.work) ? snapshot.work : []).find((w) => {
    const end = w.end || (w.start ? addMinutes(w.start, 60) : null);
    return !w.final && end && end > now;
  }) || null;
  return { ...snapshot, next: { play, work, live } };
}

// ---------- alerts ----------

const courtText = (c) => (c == null ? "" : /^\d+$/.test(String(c).trim()) ? `Court ${String(c).trim()}` : String(c).trim());
const setsText = (sets) => sets.map(([a, b]) => `${a}-${b}`).join(", ");

// What a parent should hear about now, as state-based facts so each goes out
// once however often the sync runs:
//   published  key 'published'                    schedule (first match) posted
//   next       key `${start}|${court}|${opponent}` next match (re-sent if time/court/opponent change)
//   final      key match id                       a result (a 1-1 split in two-set pool play too)
//   pool       key `${play_id or pool name}|${rank}` pool finishing place (last_pool's, then pool's)
//   finish     key finish text                    final placing ("overall" only when finish.overall)
// sentKeys: Set/array of `${kind}|${key}` (bare keys are honoured too) from
// hub_alerts_sent for this tournament + team. eventDays: the venue's event
// dates (default snapshot.days); off an event day only 'published' is
// returned (pass eventDays: null to skip that rule). The caller owns quiet
// hours, recording and sending.
export function alertsFor({ snapshot, teamName, nowLocal, eventDays, sentKeys } = {}) {
  if (!snapshot) return [];
  const sent = sentKeys instanceof Set ? sentKeys : new Set(Array.isArray(sentKeys) ? sentKeys : []);
  const was = (kind, key) => sent.has(`${kind}|${key}`) || sent.has(key);
  const title = `DS Elite ${teamName || ""}`.trim();
  const now = nowLocal ? String(nowLocal) : null;
  const today = now ? now.slice(0, 10) : null;
  const days = eventDays === undefined ? snapshot.days : eventDays;
  const onEventDay = !days || !today || (Array.isArray(days) && days.includes(today));
  const snap = now ? withNext(snapshot, now) : snapshot;
  const ms = Array.isArray(snap.matches) ? snap.matches : [];
  const out = [];
  const push = (kind, key, body) => { if (key != null && !was(kind, String(key))) out.push({ kind, key: String(key), title, body }); };
  const when = (local) => (today && String(local || "").slice(0, 10) === today ? fmtTime(local) : `${fmtDay(local)} ${fmtTime(local)}`);
  const vs = (m) => [courtText(m.court), m.opponent ? `vs ${m.opponent}` : null].filter(Boolean).join(" ");

  const first = ms.find((m) => m.start) || null;
  if (first) push("published", "published", `Schedule posted${snap.event_name ? ` for ${snap.event_name}` : ""}. First match ${fmtDay(first.start)} ${fmtTime(first.start)} · ${vs(first)}`.trim());
  if (!onEventDay) return out;

  // Results, oldest first, with the running record in that round (AES: that
  // play — LSC has a "Pool 1" in every round). Two-set pool play can end 1-1:
  // no winner, still a result.
  const sameRound = (a, b) => (a.play_id ?? a.round) === (b.play_id ?? b.round);
  const scored = (x) => x.final && (x.won != null || (Array.isArray(x.sets) && x.sets.length > 0));
  for (const m of ms) {
    if (!scored(m)) continue;
    const inRound = ms.filter((x) => scored(x) && sameRound(x, m) && String(x.start) <= String(m.start));
    const w = inRound.filter((x) => x.won === true).length, l = inRound.filter((x) => x.won === false).length, t = inRound.length - w - l;
    const sets = m.sets.length ? ` ${setsText(m.sets)}` : "";
    const verb = m.won === true ? "Won" : m.won === false ? "Lost" : "Split";
    push("final", m.id, `${verb}${sets}${m.opponent ? ` vs ${m.opponent}` : ""}${m.round ? ` (${w}-${l}${t ? `, ${t} split` : ""} in ${m.round})` : ""}`);
  }
  for (const pl of [snap.last_pool, snap.pool]) {
    if (pl && pl.rank != null && pl.name) push("pool", `${pl.play_id ?? pl.name}|${pl.rank}`, `Finished ${pl.rank_text || ordinal(pl.rank)} in ${pl.name}`);
  }
  if (snap.finish && snap.finish.text) push("finish", snap.finish.text, snap.finish.overall === true ? `Finished ${snap.finish.text} overall` : `Finished ${snap.finish.text}`);

  // The next match. While one of ours has started and has no score (live,
  // which lasts until it's scored) it is that one — normally already sent
  // before it began, so this only fires when the previous result came in
  // after its start — never the one after it: the parent wants that result
  // first, and a bracket opponent may hinge on it.
  const p = (snap.next && (snap.next.live || snap.next.play)) || null;
  if (p && p.start) {
    const wk = snap.next.work && snap.next.work.start && String(snap.next.work.start).slice(0, 10) === String(p.start).slice(0, 10) ? snap.next.work : null;
    const wkText = wk ? `${wk.start < p.start ? "work first at" : "work"} ${fmtTime(wk.start)} ${courtText(wk.court)}`.trimEnd() : null;
    const head = now && p.start <= now ? `Next: ${vs(p)} (set for ${when(p.start)})` : `Next: ${when(p.start)} · ${vs(p)}`;
    push("next", `${p.start}|${p.court || ""}|${p.opponent || ""}`, `${head}${wkText ? ` · ${wkText}` : ""}`);
  }
  return out;
}

// ---------- change detection ----------

// Short stable hash of a snapshot's data (not next / stamp), for "did
// anything change" without storing or diffing whole snapshots.
export function snapshotHash(snapshot) {
  const stable = (v) => {
    if (v == null || typeof v !== "object") return JSON.stringify(v ?? null);
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    return "{" + Object.keys(v).filter((k) => k !== "next" && k !== "stamp").sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  };
  const s = stable(snapshot || null);
  // cyrb53
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const ch = s.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
