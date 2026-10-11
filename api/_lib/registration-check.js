// Daily registration check (Drew, 11 Oct 2026: "Fix HQ now — do a daily check
// as well"). Reads what AES and OTTO (the renamed SportWrench) say about every
// DS Elite team's tournament entries, keeps a copy in tournament_registrations,
// brings HQ's tournament_assignments statuses up to what the platform says
// (registered → accepted when AES has accepted the team; planned → registered
// when the team is entered), and raises registration_flags for what a person
// has to look at. Drew gets one plain email when something is new.
//
// runRegistrationCheck(sb, opts) is the whole job; api/registration-check.js
// (daily cron + "Run check now" in HQ) is the HTTP wrapper.
//
// One run (today = Central date):
//  1. AES. Every practice team with an aes_team_id → its season events
//     (ranking API; lists pending and dropped entries too), end >= today - 1,
//     plus the AES source event of every HQ tournament with teams on it and
//     every event we already hold live rows for. Per event: the full landing
//     teams list (/teams: every entry with its status, Dropped included —
//     AES serves it whatever the page's visibility setting; /teams/accepted
//     only when that can't be read on an 'accepted' event), DS Elite rows
//     (clubId 32611) mapped to HQ team names. A team the ranking API lists but
//     the list read doesn't → 'Entered', hidden: the ranking list keeps drops
//     and has no status, so a hidden row never moves HQ, never says HQ's
//     "dropped" is wrong and never raises unknown_event.
//  2. OTTO (registration presence only — OTTO has no per-team status). Events
//     in [today, today + 300 d]: (a) every event whose dates (±1 day) and name
//     match an HQ tournament with teams on it that isn't an AES row, (c) events
//     we hold live rows for, (b) every Texas event. At most 250 probes, 4 at
//     a time: paginatedClubs("DSELI") → DS Elite teams → 'Entered'. A probe
//     that fails (GraphQL down and no REST route for a registration-only id)
//     leaves that event unchecked: the run says OTTO was partial, and nothing
//     about an unchecked event marks a row gone or raises/resolves a flag.
//     Without the whole event list (REST list down: none, or the GraphQL
//     fallback's first few weeks) OTTO is partial too, and no not_on_platform
//     / not_found about a tournament that isn't an AES row is raised or
//     resolved (an OTTO event never seen might be its match).
//  3. Match each platform event to HQ tournaments: source_url ends with the
//     AES eventId ('source_url'); tournament_feeds has the event ('feed'); or
//     start within a day and the names alike ('name+date'). A row that is
//     itself another AES event never matches by name, nor does an AES row match
//     an OTTO event. Per team the row where that team is assigned wins, then a
//     row with any DS Elite team, then the source_url row (HQ has duplicates —
//     #222 Round Rock Rumble by hand and #327 from AES — and splits a Lone Star
//     Classic weekend into one row per site).
//  4. Upsert tournament_registrations; rows of a fully checked event whose team
//     is no longer listed get gone_at (cleared if it comes back).
//  5. Auto-updates (the only writes to tournament_assignments, each logged to
//     change_log as "Registration check"): platform Accepted & HQ planned /
//     in_progress / registered → accepted; platform Pending / Entered (or
//     Waitlist / Ok To Pay / Incomplete) & HQ planned / in_progress →
//     registered. Never a demotion, never locked / rostered / need_to_drop /
//     dropped, never a new assignment, never from a hidden 'Entered'. Each
//     becomes an 'auto_updated' flag (resolved at once, emailed once — by the
//     next run that emails, if this run's email didn't go out).
//  6. Flags (open while true; resolved when not; a dismissed flag stays
//     dismissed): dropped_on_platform, not_on_platform, not_found, not_in_hq,
//     unknown_event — see computeFlags().
//  7. Email Drew when there are flags or auto-updates not yet emailed — only
//     through opts.send (the handler passes the real sender; tests and dry runs
//     don't, so they can't email). Event teams (14 Crystal) are flagged for HQ
//     but never put in the email.
//  8. One registration_check_runs row per run.
//
// opts: { dry (no writes at all; returns what it would do), now (Date),
//         send(subject, body, recipients) → Promise, applyUpdates (default
//         true; false = auto-updates are reported but tournament_assignments
//         and change_log are not touched), maxMs (budget, default 250 s),
//         appOrigin (link base for the email), recipients }

import * as S from "./tournament-sources.js";
import { nameSim, stateOf } from "./tournament-sync-core.js";
import { dseTeamName, localNow } from "../../shared/tournament-feed.js";
import { isEventTeam } from "../../shared/event-teams.js";
import { PROD_ORIGIN } from "../../shared/app-origin.js";

export const DSE_AES_CLUB_ID = 32611;
export const DREW = "drew@dselitevolleyball.com";
const ACTOR = "Registration check";
const OTTO_DAYS = 300;
const OTTO_PROBE_CAP = 250;
const CONCURRENCY = 4;
const NOT_FOUND_DAYS = 75;
const BUDGET_MS = 250000;

// HQ assignment statuses.
const NOT_GOING = new Set(["dropped", "need_to_drop"]);
const COUNTED_IN = new Set(["registered", "accepted", "locked", "rostered"]); // HQ thinks the team is entered
const SURE_IN = new Set(["accepted", "locked", "rostered"]);
const UP_TO_ACCEPTED = new Set(["planned", "in_progress", "registered"]);
const UP_TO_REGISTERED = new Set(["planned", "in_progress"]);
// Platform statuses.
const isDroppedStatus = (s) => /drop|withdr|declin|cancel|reject|remov/i.test(String(s || ""));
const isAcceptedStatus = (s) => /^accepted$/i.test(String(s || "").trim());
// Entered but not (yet) accepted. Waitlist / Ok To Pay / Incomplete are
// AES's in-between states: the entry is in, so HQ's "registered" is right.
const isEnteredStatus = (s) => /^(pending|entered|wait ?list(ed)?|ok to pay|incomplete)$/i.test(String(s || "").trim());

// ---------- small helpers ----------

const ymd = (d) => String(d || "").slice(0, 10);
const addDays = (iso, n) => { const t = Date.parse(ymd(iso) + "T12:00:00Z"); return Number.isFinite(t) ? new Date(t + n * 86400000).toISOString().slice(0, 10) : null; };
const dayDiff = (a, b) => (Date.parse(ymd(a) + "T12:00:00Z") - Date.parse(ymd(b) + "T12:00:00Z")) / 86400000;
const trunc = (s, n = 240) => { const t = String(s ?? ""); return t.length > n ? t.slice(0, n - 3) + "..." : t; };
const errMsg = (e) => trunc(e?.message || String(e));
const place = (city, st) => [city, st].filter(Boolean).join(", ") || null;
const platformLabel = (p) => (p === "aes" ? "AES" : "OTTO");
const fmtDay = (d) => { const t = Date.parse(ymd(d) + "T12:00:00Z"); return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : ""; };
const byName = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const isRise = (team) => /\brise\b/i.test(String(team || ""));
// AES eventId at the end of a tournaments.source_url ("…advancedeventsystems.com/47248").
export const aesIdOfUrl = (u) => { const m = /advancedeventsystems\.com\/(?:[^?#]*\/)?(\d{4,7})\/?(?:[?#].*)?$/i.exec(String(u || "")); return m ? m[1] : null; };
const isAesRow = (t) => /^AES/i.test(String(t.source || "")) || /advancedeventsystems\.com/i.test(String(t.source_url || ""));

// Name likeness for matching a platform event to an HQ tournament. nameSim
// (tournament-sync-core) scores against the longer name, so a platform title
// stuffed with divisions ("2027 Girls West Coast W1 (11-14,15-16A/L,17A,18s)"
// vs HQ's "2027 West Coast Juniors National Qualifier Weekend 1") scores 0.2.
// The overlap score counts shared words against the SHORTER name (at least two
// shared, numbers "#2" / "Weekend 2" / "W2" must not disagree).
const NOISE = new Set(["the", "and", "of", "a", "an", "at", "in", "for", "girls", "boys", "girl", "boy", "adidas", "nike", "usav", "usa", "volleyball", "vb", "tournament", "event", "presented", "by", "club", "jr", "junior", "juniors", "national", "qualifier", "weekend", "nq", "jnq", "aau"]);
const words = (s) => [...new Set(String(s || "").toLowerCase()
  .replace(/\([^)]*\d+\/\d+[^)]*\)/g, " ")
  .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ")
  .replace(/[^a-z0-9 ]/g, " ")
  .split(/\s+/).filter((w) => w.length > 1 && !NOISE.has(w) && !/^(19|20)\d\d$/.test(w) && !/^\d+$/.test(w)))];
const nums = (s) => new Set((String(s || "").match(/(?:#|weekend\s*|wk\s*|\bw|no\.\s*)\s*(\d+)\b/gi) || []).map((x) => x.replace(/\D/g, "")));
function overlapSim(a, b) {
  const A = words(a), B = new Set(words(b));
  if (A.length < 2 || B.size < 2) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  if (shared < 2) return 0;
  const na = nums(a), nb = nums(b);
  if (na.size && nb.size && ![...na].some((x) => nb.has(x))) return 0;
  return Math.round((shared / Math.min(A.length, B.size)) * 100) / 100;
}
// Both scores need a real word in common: nameSim alone gives "CTPL #1" ~
// "Star Sports Series #1" 0.5 on the "1"/"#1" match. One shared word is
// enough only when the numbers agree too ("CTPL #2" ~ "2027 CTPL #2") or one
// name is that word ("Showcase" ~ "2027 ATX Showcase" is not, it has two).
export function matchSim(a, b) {
  const A = words(a), B = new Set(words(b));
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  if (!shared) return 0;
  if (shared === 1 && Math.min(A.length, B.size) > 1) {
    const na = nums(a), nb = nums(b);
    if (!(na.size && nb.size && [...na].some((x) => nb.has(x)))) return 0;
  }
  return Math.max(nameSim(a, b), overlapSim(a, b));
}

// A platform event and an HQ tournament are the same weekend and look alike:
// start within a day, names alike (across states only with a strong nameSim).
// A row that is itself another AES event never matches an AES event by name,
// and an AES row never matches an OTTO event. → the likeness score, or 0.
export function nameDateFits(E, t) {
  if (!E.start || !t.start_date || Math.abs(dayDiff(E.start, t.start_date)) > 1) return 0;
  const aesId = aesIdOfUrl(t.source_url);
  if (E.platform === "aes" && aesId && aesId !== E.ref) return 0;
  if (E.platform === "otto" && isAesRow(t)) return 0;
  const sim = Math.max(0, ...E.names.map((n) => matchSim(n, t.name)));
  if (sim < 0.34) return 0;
  const ts = stateOf(t.location) || stateOf(t.venue), es = E.state ? String(E.state).toUpperCase() : null;
  if (ts && es && ts !== es && Math.max(0, ...E.names.map((n) => nameSim(n, t.name))) < 0.5) return 0;
  return sim;
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

const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
async function selectAll(build, what) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = must(await build().range(from, from + 999), what) || [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
async function chunked(rows, n, fn) { for (let i = 0; i < rows.length; i += n) await fn(rows.slice(i, i + n)); }

// ---------- the default sender (the handler passes this; tests never do) ----------

// The same internal path other crons use (api/playbook-calendar.js): POST
// /api/send-email with recipients and skipPush.
export function emailSender(origin = PROD_ORIGIN) {
  return async (subject, body, recipients) => {
    const r = await fetch(String(origin).replace(/\/+$/, "") + "/api/send-email", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skipPush: true, subject, body, recipients, sentBy: ACTOR, source: "registration-check" }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false || !(j.sent > 0)) throw new Error(`send-email ${r.status}: ${trunc(j.error || JSON.stringify(j), 160)}`);
    return j;
  };
}

// ---------- the job ----------

export async function runRegistrationCheck(sb, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : opts.now ? new Date(opts.now) : new Date();
  const nowIso = now.toISOString();
  const today = localNow("America/Chicago", now).slice(0, 10);
  const dry = !!opts.dry;
  const applyUpdates = opts.applyUpdates !== false;
  const budget = Number(opts.maxMs) || BUDGET_MS;
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const lim = limiter(CONCURRENCY);
  let calls = 0;
  const http = (fn) => lim(() => {
    if (elapsed() > budget) throw Object.assign(new Error("time budget"), { budget: true });
    calls++;
    return fn();
  });
  const out = { ok: true, dry, apply_updates: applyUpdates && !dry, now: nowIso, today, summary: null, events: [], registrations: null, auto_updates: [], flags: null, email: null, errors: [] };

  try {
    // ---- state ----
    const [teams, tns, asgs, feeds, regRows, flagRows] = await Promise.all([
      selectAll(() => sb.from("practice_teams").select("team_name, level, practices_per_week, aes_team_id, otto_master_team_id").order("team_name"), "practice_teams"),
      selectAll(() => sb.from("tournaments").select("id, name, start_date, end_date, location, venue, source, source_url, registration_platform, cancelled").gte("start_date", addDays(today, -14)).order("id"), "tournaments"),
      selectAll(() => sb.from("tournament_assignments").select("id, tournament_id, team_id, status").order("id"), "tournament_assignments"),
      selectAll(() => sb.from("tournament_feeds").select("tournament_id, platform, event_ref, event_key").order("id"), "tournament_feeds"),
      selectAll(() => sb.from("tournament_registrations").select("*").or(`event_end.gte.${addDays(today, -60)},event_end.is.null`).order("id"), "tournament_registrations"),
      selectAll(() => sb.from("registration_flags").select("*").order("id"), "registration_flags"),
    ]);
    const teamBy = new Map(teams.map((t) => [t.team_name, t]));
    const known = teams.map((t) => t.team_name);
    const byAesId = new Map(teams.filter((t) => t.aes_team_id != null).map((t) => [String(t.aes_team_id), t.team_name]));
    const byMaster = new Map(teams.filter((t) => t.otto_master_team_id != null).map((t) => [String(t.otto_master_team_id), t.team_name]));
    // Tournaments still ahead (or under way); cancelled rows never match.
    const live = tns.filter((t) => !t.cancelled && t.start_date && ymd(t.end_date || t.start_date) >= addDays(today, -1));
    const tnBy = new Map(tns.map((t) => [t.id, t]));
    const liveIds = new Set(live.map((t) => t.id));
    const asgBy = new Map();
    const asgOf = new Map(); // tid → [assignment]
    for (const a of asgs) {
      if (!liveIds.has(a.tournament_id)) continue;
      asgBy.set(`${a.tournament_id}|${a.team_id}`, a);
      if (!asgOf.has(a.tournament_id)) asgOf.set(a.tournament_id, []);
      asgOf.get(a.tournament_id).push(a);
    }
    const going = (a) => a && !NOT_GOING.has(String(a.status || "").toLowerCase());
    const hasDse = (tid) => (asgOf.get(tid) || []).some(going);
    const withTeams = live.filter((t) => (asgOf.get(t.id) || []).length);

    const events = new Map(); // `${platform}|${ref}` → E
    const newEvent = (platform, ref, meta = {}) => ({
      platform, ref: String(ref), list_id: String(ref), name: null, names: [], start: null, end: null, city: null, state: null, location: null,
      visibility: null, published: null, sources: new Set(), ranking: new Set(), teams: new Map(), unmapped: [], checked: false, probed: false, error: null, cands: [], ...meta,
    });

    // ================= 1. AES =================
    const aes = { teams: 0, ranking_ok: 0, ranking_errors: [], events: 0, checked: 0, partial: false, errors: [], hidden: 0, no_full_list: 0 };
    const aesTeams = teams.filter((t) => t.aes_team_id != null);
    aes.teams = aesTeams.length;
    const rankings = await Promise.all(aesTeams.map((t) => http(() => S.aesTeamEvents(t.aes_team_id)).then((evs) => ({ t, evs }), (e) => ({ t, err: e }))));
    const aesEv = (id) => { const k = `aes|${id}`; if (!events.has(k)) events.set(k, newEvent("aes", id)); return events.get(k); };
    for (const r of rankings) {
      if (r.err) { aes.ranking_errors.push(`${r.t.team_name}: ${errMsg(r.err)}`); continue; }
      aes.ranking_ok++;
      for (const e of r.evs || []) {
        if (!e?.eventId || ymd(e.endDate || e.startDate) < addDays(today, -1)) continue;
        const E = aesEv(e.eventId);
        E.sources.add("ranking");
        E.ranking.add(r.t.team_name);
        if (!E.name) Object.assign(E, {
          name: String(e.name || "").trim() || null, start: ymd(e.startDate) || null, end: ymd(e.endDate || e.startDate) || null,
          city: e.address?.city || null, state: e.address?.state?.abbreviation || null, location: place(e.address?.city, e.address?.state?.abbreviation),
          visibility: e.eventTeamVisibilityType?.code || null,
        });
      }
    }
    const rankingComplete = aes.ranking_errors.length === 0;
    // HQ tournaments' own AES events, and events we already hold live rows for.
    for (const t of withTeams) { const id = aesIdOfUrl(t.source_url); if (id) aesEv(id).sources.add("source_url"); }
    for (const r of regRows) if (r.platform === "aes" && !r.gone_at && ymd(r.event_end || r.event_start) >= addDays(today, -1)) aesEv(r.event_ref).sources.add("existing");
    await Promise.all([...events.values()].filter((E) => E.platform === "aes").map(async (E) => {
      try {
        if (!E.name || !E.visibility) {
          const l = await http(() => S.aesLanding(E.ref));
          if (!l) { E.error = "AES landing not readable"; return; }
          Object.assign(E, {
            name: String(l.name || E.name || "").trim() || null, start: ymd(l.startDate) || E.start, end: ymd(l.endDate || l.startDate) || E.end,
            city: l.address?.city || E.city, state: l.address?.state?.abbreviation || E.state, location: place(l.address?.city, l.address?.state?.abbreviation) || E.location,
            visibility: l.eventTeamVisibilityType?.code || E.visibility || "all",
          });
        }
        if (ymd(E.end || E.start) < addDays(today, -1)) { E.past = true; return; }
        // The full list (/teams) first, whatever the page shows: it carries
        // every entry's status, Dropped included, and AES serves it for
        // 'accepted' and 'none' events too. /teams/accepted leaves drops out —
        // and the ranking list below has no status — so a drop read from it
        // would come out 'Entered'. It's only the fallback for an 'accepted'
        // event whose full list can't be read; 'none' with no readable list
        // has nothing public.
        let list = null, why = null;
        try { list = await http(() => S.aesLandingTeams(E.ref, "all")); } catch (e) { if (e.budget) throw e; why = errMsg(e); }
        E.full_list = list != null;
        if (list == null && E.visibility === "accepted") list = await http(() => S.aesLandingTeams(E.ref, "accepted"));
        if (list == null && E.visibility !== "none") { E.error = "AES teams list not readable" + (why ? ` (${why})` : ""); return; }
        E.probed = true;
        for (const row of (list || []).filter((x) => Number(x?.clubId) === DSE_AES_CLUB_ID)) {
          const team = byAesId.get(String(row.teamId)) || dseTeamName(row.name, known);
          if (!team) { E.unmapped.push(String(row.name || row.teamId)); continue; }
          const status = String(row.acceptedType?.displayName || "Entered").trim();
          const prev = E.teams.get(team);
          // Two rows for one team (re-entered after a drop): the live one wins.
          if (prev && !isDroppedStatus(prev.status) && isDroppedStatus(status)) continue;
          E.teams.set(team, { status, platform_team_id: row.teamId != null ? String(row.teamId) : null, division: row.divisionDescription || null });
        }
        // On the team's own season list but not in the public list (only the
        // accepted list, or none could be read; or the full list leaves it
        // out): 'Entered', hidden. The season list also keeps events a team
        // was DROPPED from and has no status, so a hidden row may be a drop —
        // it never moves HQ (step 5) and never says HQ's "dropped" is wrong or
        // that HQ is missing an event (computeFlags).
        for (const team of E.ranking) if (!E.teams.has(team)) { E.teams.set(team, { status: "Entered", platform_team_id: String(teamBy.get(team)?.aes_team_id ?? "") || null, division: null, hidden: true }); aes.hidden++; }
        E.checked = rankingComplete;
      } catch (e) { E.error = errMsg(e); }
    }));
    for (const E of events.values()) if (E.platform === "aes") {
      E.names = [E.name].filter(Boolean);
      if (!E.past) aes.events++;
      if (E.checked) aes.checked++;
      if (E.probed && !E.full_list) aes.no_full_list++;
      if (E.error) aes.errors.push(`${E.ref} ${E.name || ""}: ${E.error}`);
    }
    aes.partial = !rankingComplete || aes.errors.length > 0;

    // ================= 2. OTTO =================
    const otto = { list_events: 0, candidates: { hq_match: 0, existing: 0, texas: 0 }, probed: 0, checked: 0, with_dse: 0, skipped_cap: 0, partial: false, partial_reasons: [], errors: [], graphql: null };
    let ottoList = null;
    try { ottoList = await http(() => S.ottoEvents({ start: today, end: addDays(today, OTTO_DAYS) })); }
    catch (e) { otto.partial = true; otto.partial_reasons.push("OTTO event list: " + errMsg(e)); }
    // The list served from the GraphQL fallback (REST list down) is only the
    // first few weeks of the window: its events are still probed, but the
    // run treats it like no list — an OTTO event it left out could be the one
    // a tournament matches, so no tournament-level flag (not_on_platform /
    // not_found) is raised or resolved from it (computeFlags).
    const ottoListOk = !!ottoList && ottoList.complete !== false;
    if (ottoList && !ottoListOk) { otto.partial = true; otto.partial_reasons.push(`OTTO event list incomplete (GraphQL fallback, ${ottoList.length} events${ottoList.truncated ? ", cut at 10 pages" : ""}; REST: ${trunc(ottoList.why || "?", 120)})`); }
    otto.list_complete = ottoListOk;
    const ottoEvents = new Map(); // list id → E (keyed by final ref after probing)
    const queue = [];
    const enqueue = (E, why) => {
      if (!ottoEvents.has(E.list_id)) { ottoEvents.set(E.list_id, E); queue.push(E); }
      ottoEvents.get(E.list_id).sources.add(why);
    };
    const fromList = (r) => newEvent("otto", r.event_id, {
      name: r.long_name || r.name, names: [...new Set([r.long_name, r.name].filter(Boolean))], start: r.date_start, end: r.date_end || r.date_start,
      city: r.city, state: r.state ? String(r.state).toUpperCase() : null, location: place(r.city, r.state), published: !!r.schedule_published,
    });
    if (ottoList) {
      const listRows = ottoList.filter((r) => r.date_start && ymd(r.date_end || r.date_start) >= today);
      otto.list_events = listRows.length;
      // (a) events whose dates and names match an HQ tournament with teams on it (not an AES row).
      const hqForOtto = withTeams.filter((t) => !isAesRow(t) && ymd(t.end_date || t.start_date) >= today);
      for (const r of listRows) {
        const E = fromList(r);
        if (hqForOtto.some((t) => nameDateFits(E, t))) { enqueue(E, "hq_match"); otto.candidates.hq_match++; }
      }
      // (c) events we hold live rows for (by numeric ref; a published event's list id is hex now).
      const listById = new Map(listRows.map((r) => [String(r.event_id), r]));
      for (const r of regRows) {
        if (r.platform !== "otto" || r.gone_at || ymd(r.event_end || r.event_start) < today) continue;
        if (ottoEvents.has(String(r.event_ref))) { ottoEvents.get(String(r.event_ref)).sources.add("existing"); continue; }
        const lr = listById.get(String(r.event_ref));
        const E = lr ? fromList(lr) : newEvent("otto", r.event_ref, { name: r.event_name, names: [r.event_name].filter(Boolean), start: ymd(r.event_start), end: ymd(r.event_end), location: r.event_location, state: stateOf(r.event_location) });
        enqueue(E, "existing"); otto.candidates.existing++;
      }
      // (b) every Texas event (DS Elite's region), soonest first.
      for (const r of [...listRows].sort((a, b) => String(a.date_start).localeCompare(String(b.date_start)))) {
        if (String(r.state || "").toUpperCase() !== "TX") continue;
        if (ottoEvents.has(String(r.event_id))) { ottoEvents.get(String(r.event_id)).sources.add("texas"); continue; }
        enqueue(fromList(r), "texas"); otto.candidates.texas++;
      }
    } else {
      // No list: still re-check the events we hold rows for, by ref.
      for (const r of regRows) {
        if (r.platform !== "otto" || r.gone_at || ymd(r.event_end || r.event_start) < today) continue;
        if (!ottoEvents.has(String(r.event_ref))) enqueue(newEvent("otto", r.event_ref, { name: r.event_name, names: [r.event_name].filter(Boolean), start: ymd(r.event_start), end: ymd(r.event_end), location: r.event_location, state: stateOf(r.event_location) }), "existing");
      }
    }
    const toProbe = queue.slice(0, OTTO_PROBE_CAP);
    otto.skipped_cap = Math.max(0, queue.length - toProbe.length);
    if (otto.skipped_cap) { otto.partial = true; otto.partial_reasons.push(`probe cap: ${otto.skipped_cap} events not probed`); }
    await Promise.all(toProbe.map(async (E) => {
      if (elapsed() > budget * 0.85) { E.error = "time budget"; return; }
      try {
        const clubs = await http(() => S.ottoClubs(E.list_id, "DSELI"));
        E.probed = true;
        for (const c of clubs || []) {
          if (!(String(c.club_code || "").toUpperCase() === "DSELI" || /\bds elite\b|dripping/i.test(String(c.club_name || "")))) continue;
          for (const tm of c.teams || []) {
            const team = byMaster.get(String(tm.master_team_id)) || dseTeamName(tm.team_name, known);
            if (!team) { E.unmapped.push(String(tm.team_name || tm.team_id)); continue; }
            if (!E.teams.has(team)) E.teams.set(team, { status: "Entered", platform_team_id: tm.team_id != null ? String(tm.team_id) : null, division: String(tm.division_name || "").trim() || null });
          }
        }
        E.checked = true;
        // A published event's list id is its hex esw id; rows and tournament_feeds
        // key OTTO events by the numeric id, which doesn't change on publishing.
        // (Registration-only ids are 5-6 digits; some esw ids are 9 digits.)
        if (!/^\d{1,8}$/.test(E.list_id) && (E.teams.size || E.sources.has("hq_match"))) {
          try { const info = await http(() => S.ottoEventEsw(E.list_id)); if (info?.event_id) { E.ref = String(info.event_id); E.hex = E.list_id; } } catch { /* keep the hex ref */ }
        }
      } catch (e) { E.error = errMsg(e); }
    }));
    for (const E of queue) {
      if (E.probed) otto.probed++;
      if (E.checked) otto.checked++;
      if (E.teams.size) otto.with_dse++;
      if (E.error && E.error !== "time budget") otto.errors.push(`${E.list_id} ${trunc(E.name, 60)}: ${E.error}`);
    }
    const failed = toProbe.filter((E) => !E.checked).length;
    if (failed) { otto.partial = true; otto.partial_reasons.push(`${failed} of ${toProbe.length} OTTO probes failed or ran out of time`); }
    otto.graphql = S.ottoGqlState();
    // Merge (a numeric-ref entry and its now-published hex entry are one event).
    for (const E of queue) {
      const k = `otto|${E.ref}`;
      const cur = events.get(k);
      if (!cur || (!cur.checked && E.checked)) events.set(k, E);
    }

    // ================= 3. match =================
    const feedBy = new Map();
    for (const f of feeds) {
      for (const ref of [f.event_ref, f.platform === "otto" ? f.event_key : null].filter(Boolean)) {
        const k = `${f.platform}|${ref}`;
        if (!feedBy.has(k)) feedBy.set(k, []);
        feedBy.get(k).push(f.tournament_id);
      }
    }
    for (const E of events.values()) {
      const c = new Map();
      const add = (t, how, sim = 1) => { if (!t || !liveIds.has(t.id)) return; const had = c.get(t.id); const rank = { source_url: 3, feed: 2, "name+date": 1 }[how]; if (!had || rank > had.rank) c.set(t.id, { tid: t.id, how, sim, rank }); };
      if (E.platform === "aes") for (const t of live) if (aesIdOfUrl(t.source_url) === E.ref) add(t, "source_url");
      for (const tid of [...(feedBy.get(`${E.platform}|${E.ref}`) || []), ...(E.hex ? feedBy.get(`${E.platform}|${E.hex}`) || [] : [])]) add(tnBy.get(tid), "feed");
      for (const t of live) { const s = nameDateFits(E, t); if (s) add(t, "name+date", s); }
      // A name+date candidate far behind the best one for this event is a
      // namesake ("Lone Star Regionals 11s" next to "Lone Star Classic #4").
      const best = Math.max(0, ...[...c.values()].filter((x) => x.how === "name+date").map((x) => x.sim));
      E.cands = [...c.values()].filter((x) => x.how !== "name+date" || x.sim >= best - 0.4);
    }
    const placeBonus = (E, t) => {
      const ts = stateOf(t.location) || stateOf(t.venue), es = E.state ? String(E.state).toUpperCase() : null;
      let b = ts && es && ts === es ? 0.5 : 0;
      const city = String(E.city || "").toLowerCase().trim();
      if (city && `${t.name} ${t.location || ""} ${t.venue || ""}`.toLowerCase().includes(city)) b += 0.3;
      return b;
    };
    const chooseFor = (E, team) => {
      if (!E.cands.length) return null;
      const score = (c) => {
        const a = asgBy.get(`${c.tid}|${team}`);
        const t = tnBy.get(c.tid);
        return (a ? (going(a) ? 1000 : 900) : 0) + (hasDse(c.tid) ? 100 : 0) + (c.how === "source_url" ? 50 : c.how === "feed" ? 40 : 0)
          + c.sim * 10 + placeBonus(E, t) + (ymd(t.start_date) === E.start ? 0.2 : 0);
      };
      return [...E.cands].sort((x, y) => score(y) - score(x) || x.tid - y.tid)[0];
    };

    // ================= 4. registrations =================
    const regBy = new Map(regRows.map((r) => [`${r.platform}|${r.event_ref}|${r.team_name}`, r]));
    const seen = new Map();
    const hiddenSeen = new Set(); // keys of seen rows that are hidden AES 'Entered' (status not public; may be a drop)
    for (const E of events.values()) {
      if (!E.probed || E.past) continue;
      for (const [team, x] of E.teams) {
        const ch = chooseFor(E, team);
        x.tournament_id = ch?.tid ?? null;
        x.match_how = ch?.how ?? null;
        if (x.hidden) hiddenSeen.add(`${E.platform}|${E.ref}|${team}`);
        seen.set(`${E.platform}|${E.ref}|${team}`, {
          platform: E.platform, event_ref: E.ref, event_name: E.name, event_start: E.start || null, event_end: E.end || E.start || null, event_location: E.location || null,
          team_name: team, platform_team_id: x.platform_team_id || null, division: x.division || null, status: x.status,
          tournament_id: x.tournament_id, match_how: x.match_how,
        });
      }
    }
    const upserts = [], statusChanges = [];
    let inserted = 0, updated = 0, unchanged = 0;
    for (const [k, r] of seen) {
      const cur = regBy.get(k);
      const statusChanged = !cur || cur.status !== r.status;
      if (cur && statusChanged) statusChanges.push({ platform: r.platform, event: r.event_name, team: r.team_name, from: cur.status, to: r.status });
      const same = cur && !statusChanged && !cur.gone_at && ["event_name", "event_start", "event_end", "event_location", "platform_team_id", "division", "tournament_id", "match_how"].every((f) => String(cur[f] ?? "") === String(r[f] ?? ""));
      if (!cur) inserted++; else if (same) unchanged++; else updated++;
      upserts.push({ ...r, first_seen_at: cur?.first_seen_at || nowIso, status_changed_at: statusChanged ? nowIso : cur.status_changed_at, last_seen_at: nowIso, gone_at: null });
    }
    // Gone: a live row of a fully checked event whose team isn't listed any more.
    const gone = [];
    for (const r of regRows) {
      if (r.gone_at) continue;
      const E = events.get(`${r.platform}|${r.event_ref}`);
      if (!E || !E.checked || E.past) continue;
      if (!seen.has(`${r.platform}|${r.event_ref}|${r.team_name}`)) gone.push(r);
    }

    // ================= 5. auto-updates =================
    // Per (tournament, team): the best live platform word across events.
    const perTT = new Map();
    for (const r of seen.values()) {
      if (r.tournament_id == null) continue;
      const k = `${r.tournament_id}|${r.team_name}`;
      if (!perTT.has(k)) perTT.set(k, []);
      perTT.get(k).push(r);
    }
    const autoUpdates = [];
    for (const [k, all] of perTT) {
      const a = asgBy.get(k);
      if (!a) continue;
      if (all.some((r) => isDroppedStatus(r.status))) continue; // conflicting word: leave it to a person
      // Never promote HQ from a status nobody can see: a hidden AES 'Entered'
      // (the team's season list, no public status) may be a drop.
      const rows = all.filter((r) => !hiddenSeen.has(`${r.platform}|${r.event_ref}|${r.team_name}`));
      if (!rows.length) continue;
      const cur = String(a.status || "").toLowerCase();
      const acc = rows.find((r) => isAcceptedStatus(r.status));
      const ent = rows.find((r) => isEnteredStatus(r.status));
      let to = null, src = null;
      if (acc && UP_TO_ACCEPTED.has(cur)) { to = "accepted"; src = acc; }
      else if (!acc && ent && UP_TO_REGISTERED.has(cur)) { to = "registered"; src = ent; }
      if (!to) continue;
      const t = tnBy.get(a.tournament_id);
      autoUpdates.push({
        assignment_id: a.id, tournament_id: a.tournament_id, tournament: t?.name, start: ymd(t?.start_date), team: a.team_id, from: cur, to,
        platform: src.platform, event_ref: src.event_ref, event_name: src.event_name, platform_status: src.status, match_how: src.match_how,
        why: `${src.status} on ${platformLabel(src.platform)} (${src.event_name}${src.event_ref ? ", " + platformLabel(src.platform) + " " + src.event_ref : ""}); registration check ${today}`,
      });
    }
    const applied = [];
    if (!dry && applyUpdates) {
      for (const u of autoUpdates) {
        // Only if HQ still says what we read (someone may have changed it since).
        const r = await sb.from("tournament_assignments").update({ status: u.to }).eq("id", u.assignment_id).eq("status", u.from).select("id");
        if (r.error) { out.errors.push(`auto-update ${u.team} @ #${u.tournament_id}: ${r.error.message}`); continue; }
        if (!(r.data || []).length) { u.skipped = "changed in HQ meanwhile"; continue; }
        u.applied = true;
        applied.push(u);
        asgBy.get(`${u.tournament_id}|${u.team}`).status = u.to;
        const l = await sb.from("change_log").insert({
          player_id: null, table_name: "tournament_assignments", action: "update",
          field_changes: { tournament_id: u.tournament_id, team_id: u.team, status: { old: u.from, new: u.to }, why: u.why },
          actor_email: null, actor_name: ACTOR,
        });
        if (l.error) out.errors.push(`change_log ${u.team} @ #${u.tournament_id}: ${l.error.message}`);
      }
    }

    // ================= 6. flags =================
    const { current, conclusive } = computeFlags({ events, live, asgOf, asgBy, teamBy, tnBy, today, aes, otto, rankingComplete, ottoListOk });
    const flagMsg = (kind, d) => flagMessage(kind, d);
    const wantFlags = new Map();
    for (const f of current) wantFlags.set(f.key, { ...f, message: flagMsg(f.kind, f.detail) });
    const autoKey = (u) => `auto_updated|${u.platform}|${u.event_ref}|${u.team}|${u.to}`;
    const madeUpdates = dry ? (applyUpdates ? autoUpdates : []) : applied;
    const autoFlags = madeUpdates.map((u) => ({
      key: autoKey(u), kind: "auto_updated", tournament_id: u.tournament_id, team_name: u.team,
      detail: { platform: u.platform, event_ref: u.event_ref, event_name: u.event_name, tournament: u.tournament, start: u.start, from: u.from, to: u.to, platform_status: u.platform_status, match_how: u.match_how },
    })).map((f) => ({ ...f, message: flagMsg("auto_updated", f.detail) }));
    const flagBy = new Map(flagRows.map((f) => [f.key, f]));
    const flagWrites = [];
    const fl = { new: [], reopened: [], still_open: [], resolved: [], dismissed_still_true: [], auto_updated: [] };
    for (const f of wantFlags.values()) {
      const cur = flagBy.get(f.key);
      const base = { key: f.key, kind: f.kind, tournament_id: f.tournament_id ?? null, team_name: f.team_name ?? null, message: f.message, detail: f.detail ?? null, last_seen_at: nowIso };
      if (!cur) { flagWrites.push({ ...base, first_flagged_at: nowIso, resolved_at: null, emailed_at: null, dismissed_at: null, dismissed_by: null }); fl.new.push(f); continue; }
      if (cur.dismissed_at) { flagWrites.push({ ...base, first_flagged_at: cur.first_flagged_at, resolved_at: null, emailed_at: cur.emailed_at, dismissed_at: cur.dismissed_at, dismissed_by: cur.dismissed_by }); fl.dismissed_still_true.push(f); continue; }
      if (cur.resolved_at) { flagWrites.push({ ...base, first_flagged_at: nowIso, resolved_at: null, emailed_at: null, dismissed_at: null, dismissed_by: null }); fl.reopened.push(f); continue; }
      flagWrites.push({ ...base, first_flagged_at: cur.first_flagged_at, resolved_at: null, emailed_at: cur.emailed_at, dismissed_at: null, dismissed_by: null });
      fl.still_open.push({ ...f, emailed_at: cur.emailed_at });
    }
    for (const f of autoFlags) {
      const cur = flagBy.get(f.key);
      if (cur && !cur.resolved_at) continue;
      // An auto-update is done the moment it's made: resolved now, emailed once.
      flagWrites.push({ key: f.key, kind: f.kind, tournament_id: f.tournament_id, team_name: f.team_name, message: f.message, detail: f.detail, last_seen_at: nowIso, first_flagged_at: nowIso, resolved_at: nowIso, emailed_at: null, dismissed_at: null, dismissed_by: null });
      fl.auto_updated.push(f);
    }
    // Resolve open flags that are no longer true — only where this run could
    // tell. The rest are held open as they were (an unreadable event).
    fl.held = [];
    for (const f of flagRows) {
      if (f.resolved_at || f.kind === "auto_updated" || wantFlags.has(f.key)) continue;
      if (!conclusive(f)) { if (!f.dismissed_at) fl.held.push(f); continue; }
      flagWrites.push({ ...f, id: undefined, resolved_at: nowIso });
      fl.resolved.push({ key: f.key, kind: f.kind, team_name: f.team_name, message: f.message });
    }

    // ================= 7. email =================
    const mailable = (f) => !isEventTeam(teamBy.get(f.team_name)) && !f.dismissed_at;
    // Auto-updates resolve the moment they're made, so a run whose email
    // failed (or ?email=0, or a sender that didn't deliver) would otherwise
    // never mail them: earlier ones not yet emailed (last 14 days) go out with
    // this run's and get their emailed_at below.
    const autoNow = new Set(fl.auto_updated.map((f) => f.key));
    const autoSince = now.getTime() - 14 * 86400000;
    const pendingAuto = flagRows.filter((f) => f.kind === "auto_updated" && !f.emailed_at && !f.dismissed_at && !autoNow.has(f.key) && Date.parse(f.first_flagged_at) >= autoSince);
    fl.auto_pending = pendingAuto;
    const toEmail = [
      ...fl.auto_updated.filter(mailable),
      ...pendingAuto.filter(mailable),
      ...[...fl.new, ...fl.reopened].filter(mailable),
      ...fl.still_open.filter((f) => !f.emailed_at && mailable(f)),
    ];
    const olderOpen = [...fl.still_open, ...fl.held].filter((f) => f.emailed_at && mailable(f)).length;
    const appUrl = String(opts.appOrigin || PROD_ORIGIN).replace(/\/+$/, "") + "/?view=tournaments";
    const recipients = Array.isArray(opts.recipients) && opts.recipients.length ? opts.recipients : [DREW];
    const partialNote = [aes.partial ? "AES" : null, otto.partial ? "OTTO" : null].filter(Boolean);
    const mail = toEmail.length ? buildEmail(toEmail, { today, olderOpen, appUrl, partial: partialNote }) : null;
    out.email = { would_send: !!mail, recipients, subject: mail?.subject || null, body: mail?.body || null, sent: false, error: null, items: toEmail.length };
    let emailedKeys = [];
    if (mail && !dry && typeof opts.send === "function") {
      // A sender that answers { delivered: false } (a preview / test stub) sent
      // nothing: the flags stay un-emailed, so the next real run still mails them.
      try {
        const r = await opts.send(mail.subject, mail.body, recipients);
        if (r && r.delivered === false) out.email.error = "sender did not deliver (" + trunc(r.why || "preview", 80) + ")";
        else { out.email.sent = true; emailedKeys = toEmail.map((f) => f.key); }
      } catch (e) { out.email.error = errMsg(e); out.errors.push("email: " + errMsg(e)); }
    } else if (mail && !dry) out.email.error = "no sender given (email off)";
    if (emailedKeys.length) { const ks = new Set(emailedKeys); for (const w of flagWrites) if (ks.has(w.key)) w.emailed_at = nowIso; }
    // An emailed flag with no other change this run still needs its emailed_at.
    const writeKeys = new Set(flagWrites.map((w) => w.key));
    for (const k of emailedKeys) if (!writeKeys.has(k)) { const cur = flagBy.get(k); if (cur) flagWrites.push({ ...cur, id: undefined, emailed_at: nowIso }); }

    // ================= writes =================
    if (!dry) {
      await chunked(upserts, 300, async (rows) => must(await sb.from("tournament_registrations").upsert(rows, { onConflict: "platform,event_ref,team_name" }), "upsert registrations"));
      await chunked(gone.map((r) => r.id), 200, async (ids) => must(await sb.from("tournament_registrations").update({ gone_at: nowIso }).in("id", ids), "gone registrations"));
      // A Dismiss (or Undo) clicked in HQ while this run was working must win
      // over the dismissal state read at the start. Re-read it for the keys
      // about to be written and carry it over — every row in a batch keeps
      // the same columns, since PostgREST nulls columns missing from some rows.
      const fresh = new Map();
      await chunked(flagWrites.map((w) => w.key).filter((k) => flagBy.has(k)), 150, async (keys) => {
        const { data } = await sb.from("registration_flags").select("key, dismissed_at, dismissed_by").in("key", keys);
        for (const r of data || []) fresh.set(r.key, r);
      });
      for (const w of flagWrites) {
        const was = flagBy.get(w.key), now = fresh.get(w.key);
        if (!was || !now) continue;
        if ((was.dismissed_at || null) !== (now.dismissed_at || null)) { w.dismissed_at = now.dismissed_at; w.dismissed_by = now.dismissed_by; }
      }
      const clean = flagWrites.map(({ id, ...w }) => w); // eslint-disable-line no-unused-vars
      await chunked(clean, 300, async (rows) => must(await sb.from("registration_flags").upsert(rows, { onConflict: "key" }), "upsert flags"));
    }

    // ================= report =================
    const tnLabel = (tid) => { const t = tnBy.get(tid); return t ? `#${t.id} ${t.name} (${ymd(t.start_date)})` : null; };
    out.events = [...events.values()].filter((E) => !E.past && (E.teams.size || E.cands.length || E.platform === "aes" || E.error))
      .sort((a, b) => String(a.start).localeCompare(String(b.start)) || a.platform.localeCompare(b.platform))
      .map((E) => ({
        platform: E.platform, ref: E.ref, ...(E.hex ? { hex: E.hex } : {}), name: E.name, start: E.start, end: E.end, location: E.location,
        ...(E.platform === "aes" ? { visibility: E.visibility } : {}), checked: E.checked, error: E.error || undefined, sources: [...E.sources],
        candidates: E.cands.map((c) => ({ tournament: tnLabel(c.tid), how: c.how, sim: Math.round(c.sim * 100) / 100 })),
        teams: [...E.teams].sort((a, b) => byName(a[0], b[0])).map(([team, x]) => ({ team, status: x.status, ...(x.hidden ? { hidden: true } : {}), tournament: x.tournament_id != null ? tnLabel(x.tournament_id) : null, how: x.match_how, hq_status: x.tournament_id != null ? asgBy.get(`${x.tournament_id}|${team}`)?.status ?? null : null })),
        unmapped: E.unmapped.length ? E.unmapped : undefined,
      }));
    out.auto_updates = autoUpdates;
    out.registrations = { inserted, updated, unchanged, status_changes: statusChanges, gone: gone.map((r) => ({ platform: r.platform, event_ref: r.event_ref, event: r.event_name, team: r.team_name, was: r.status })), ...(dry ? { rows: upserts } : {}) };
    const openNow = [...fl.new, ...fl.reopened, ...fl.still_open, ...fl.held];
    const byKind = {};
    for (const f of openNow) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
    out.flags = {
      new: fl.new.map(slim), reopened: fl.reopened.map(slim), still_open: fl.still_open.map(slim), resolved: fl.resolved,
      dismissed_still_true: fl.dismissed_still_true.map(slim), auto_updated: fl.auto_updated.map(slim), held: fl.held.map(slim),
      auto_unemailed_earlier: fl.auto_pending.map(slim),
    };
    out.summary = {
      aes: { teams: aes.teams, ranking_ok: aes.ranking_ok, ranking_errors: aes.ranking_errors, events: aes.events, checked: aes.checked, partial: aes.partial, errors: aes.errors.slice(0, 20), hidden_rows: aes.hidden, no_full_list: aes.no_full_list },
      otto: { list_events: otto.list_events, list_complete: otto.list_complete, candidates: otto.candidates, probed: otto.probed, checked: otto.checked, with_dse: otto.with_dse, skipped_cap: otto.skipped_cap, partial: otto.partial, partial_reasons: otto.partial_reasons, errors: otto.errors.slice(0, 20), graphql: otto.graphql },
      rows: { seen: seen.size, inserted, updated, unchanged, status_changed: statusChanges.length, gone: gone.length },
      auto_updates: { found: autoUpdates.length, applied: applied.length, skipped: !dry && !applyUpdates ? autoUpdates.length : 0 },
      flags: { new: fl.new.length, reopened: fl.reopened.length, open: openNow.length, held: fl.held.length, resolved: fl.resolved.length, dismissed_still_true: fl.dismissed_still_true.length, by_kind: byKind },
      emailed: out.email.sent, email_items: toEmail.length, calls, ms: elapsed(),
    };
    out.ok = out.errors.length === 0;
  } catch (e) {
    out.ok = false;
    out.error = errMsg(e);
  }
  if (!dry) {
    const r = await sb.from("registration_check_runs").insert({ run_at: nowIso, ok: out.ok, summary: out.summary, error: out.error || (out.errors.length ? out.errors.join(" | ").slice(0, 2000) : null) });
    if (r.error) out.errors.push("run row: " + r.error.message);
  }
  return out;
}

const slim = (f) => ({ key: f.key, kind: f.kind, tournament_id: f.tournament_id ?? null, team: f.team_name, message: f.message });

// ---------- flags ----------

// What is true right now → [{ key, kind, tournament_id, team_name, detail }],
// plus conclusive(flagRow): could this run tell whether an older flag still
// holds? (An event we couldn't read says nothing either way.)
function computeFlags({ events, live, asgOf, asgBy, teamBy, tnBy, today, aes, otto, rankingComplete, ottoListOk }) {
  const out = [];
  const add = (kind, platform, refOrTid, team, tournament_id, detail) => out.push({ key: `${kind}|${platform}|${refOrTid}|${team}`, kind, tournament_id: tournament_id ?? null, team_name: team, detail });
  const live2 = new Set(live.map((t) => t.id));
  const evs = [...events.values()].filter((E) => E.probed && !E.past);

  // Event-based: dropped_on_platform, not_in_hq, unknown_event.
  for (const E of evs) {
    for (const [team, x] of E.teams) {
      const base = { platform: E.platform, event_ref: E.ref, event_name: E.name, event_start: E.start, event_location: E.location, platform_status: x.status, match_how: x.match_how, ...(x.hidden ? { hidden: true } : {}) };
      const t = x.tournament_id != null ? tnBy.get(x.tournament_id) : null;
      const a = t ? asgBy.get(`${t.id}|${team}`) : null;
      if (isDroppedStatus(x.status)) {
        if (a && !NOT_GOING.has(String(a.status || "").toLowerCase())) add("dropped_on_platform", E.platform, E.ref, team, t.id, { ...base, tournament: t.name, start: ymd(t.start_date), hq_status: a.status });
        continue;
      }
      // A hidden AES 'Entered' (season list only, status not public) may be a
      // drop: it never says HQ lacks the event, nor that HQ's "dropped" is wrong.
      if (!t) { if (!x.hidden) add("unknown_event", E.platform, E.ref, team, null, base); continue; }
      // HQ "need to drop" is still entered on purpose — only "dropped" disagrees.
      if (!a || (!x.hidden && String(a.status || "").toLowerCase() === "dropped")) add("not_in_hq", E.platform, E.ref, team, t.id, { ...base, tournament: t.name, start: ymd(t.start_date), hq_status: a?.status ?? null });
    }
  }

  // Tournament-based: not_on_platform, not_found.
  const inconclusiveT = new Set();
  const matchedOf = new Map(); // tid → [E]
  for (const E of [...events.values()].filter((x) => !x.past)) for (const c of E.cands) {
    if (!matchedOf.has(c.tid)) matchedOf.set(c.tid, []);
    matchedOf.get(c.tid).push(E);
  }
  for (const t of live) {
    const start = ymd(t.start_date);
    if (start < today) continue; // under way: too late to matter
    const asg = (asgOf.get(t.id) || []).filter((a) => COUNTED_IN.has(String(a.status || "").toLowerCase()));
    if (!asg.length) continue;
    const M = matchedOf.get(t.id) || [];
    if (M.some((E) => !E.checked)) { inconclusiveT.add(t.id); continue; }
    // M is complete only when every team's AES season list loaded and the
    // whole OTTO event list did (an unprobed OTTO event that matches would be
    // in M). Without the OTTO list — missing, or the GraphQL fallback's first
    // few weeks — any row that isn't an AES row might match an OTTO event we
    // never saw (Red Rock Rave W3 lists no DS Elite team, so we hold no rows
    // for it): nothing about such a tournament is raised or resolved. An AES
    // row never matches an OTTO event by name.
    if (!rankingComplete || (!ottoListOk && !isAesRow(t))) { inconclusiveT.add(t.id); continue; }
    const ownAes = M.find((E) => E.platform === "aes" && aesIdOfUrl(t.source_url) === E.ref);
    for (const a of asg) {
      const team = a.team_id, hq = String(a.status).toLowerCase();
      const pt = teamBy.get(team);
      if (!M.length) {
        if (isEventTeam(pt) || (isRise(team) && hq === "planned")) continue;
        if (dayDiff(start, today) > NOT_FOUND_DAYS) continue;
        add("not_found", "any", t.id, team, t.id, { tournament: t.name, start, location: t.location, hq_status: a.status, registration_platform: t.registration_platform || null });
        continue;
      }
      if (M.some((E) => E.teams.has(team))) continue; // listed somewhere (dropped is its own flag)
      // Could this event have shown the team? AES hides pending entries when
      // only accepted teams are public, and shows nothing with 'none'.
      // A team with an AES id is never hidden from us: its own season list
      // shows every entry, pending included (those rows are 'Entered').
      const canSee = (E) => E.platform === "otto" || !E.visibility || E.visibility === "all" || pt?.aes_team_id != null || (E.visibility === "accepted" && SURE_IN.has(hq));
      const evidence = [];
      for (const E of M) {
        if (!canSee(E)) continue;
        const others = [...E.teams.keys()].filter((n) => n !== team);
        if (others.length) evidence.push({ E, why: "others", others });
        else if (E === ownAes) evidence.push({ E, why: "own_aes" });
      }
      const ottoM = M.filter((E) => E.platform === "otto");
      if (!evidence.length && ottoM.length && M.every((E) => E.teams.size === 0) && ottoM.some(canSee)) evidence.push({ E: ottoM[0], why: "no_dse" });
      if (!evidence.length) continue;
      const ev = evidence.find((x) => x.E.platform === "aes") || evidence[0];
      add("not_on_platform", ev.E.platform, t.id, team, t.id, {
        tournament: t.name, start, hq_status: a.status, platform: ev.E.platform, event_ref: ev.E.ref, event_name: ev.E.name, event_start: ev.E.start, why: ev.why,
        others: ev.others ? ev.others.slice(0, 12) : undefined, events: M.map((E) => `${E.platform} ${E.ref}`),
      });
    }
  }

  const evByRef = new Map([...events.values()].map((E) => [`${E.platform}|${E.ref}`, E]));
  const conclusive = (f) => {
    const [kind, platform, ref] = String(f.key).split("|");
    if (kind === "not_on_platform" || kind === "not_found") {
      const tid = Number(ref);
      if (!live2.has(tid)) return true;                 // cancelled / over / gone
      const t = tnBy.get(tid);
      if (t && ymd(t.start_date) < today) return true;  // under way or past
      // An OTTO / "anywhere" answer needs the whole OTTO event list.
      if (!ottoListOk && (platform === "otto" || platform === "any")) return false;
      return !inconclusiveT.has(tid) && (kind !== "not_found" || (rankingComplete && ottoListOk));
    }
    const E = evByRef.get(`${platform}|${ref}`);
    if (E) return E.checked || !!E.past;
    // Not looked at this run: AES / OTTO had no reason to (no DS Elite team
    // lists it any more and we hold no live row) — unless that pass was partial.
    return platform === "aes" ? !aes.partial : !otto.partial;
  };
  return { current: out, conclusive };
}

// One line per flag: "13 Diamond · Round Rock Rumble (Mar 13): accepted on AES but not in HQ".
const said = (status, platform) => {
  const s = String(status || "").trim();
  if (/^entered$/i.test(s)) return `entered on ${platformLabel(platform)}`;
  if (/^wait/i.test(s)) return `waitlisted on ${platformLabel(platform)}`;
  return `${s.toLowerCase()} on ${platformLabel(platform)}`;
};
export function flagMessage(kind, d = {}) {
  const tn = d.tournament ? `${d.tournament} (${fmtDay(d.start)})` : `${d.event_name} (${fmtDay(d.event_start)}${d.event_location ? ", " + d.event_location : ""})`;
  switch (kind) {
    case "auto_updated": return `${tn}: HQ ${d.from} → ${d.to} (${said(d.platform_status, d.platform)})`;
    case "dropped_on_platform": return `${tn}: dropped on ${platformLabel(d.platform)} but HQ says ${d.hq_status}`;
    case "not_in_hq": return `${tn}: ${d.hidden ? `listed on ${platformLabel(d.platform)} (status not public)` : said(d.platform_status, d.platform)} but ${d.hq_status ? "HQ says " + d.hq_status : "not in HQ"}`;
    case "unknown_event": return `${tn}: ${said(d.platform_status, d.platform)}, and HQ has no tournament for it`;
    case "not_on_platform": return d.why === "no_dse"
      ? `${tn}: HQ says ${d.hq_status}, but ${platformLabel(d.platform)}'s "${trunc(d.event_name, 60)}" lists no DS Elite team`
      : `${tn}: HQ says ${d.hq_status}, but ${platformLabel(d.platform)}'s "${trunc(d.event_name, 60)}" doesn't list this team`;
    case "not_found": return `${tn}: HQ says ${d.hq_status}, but no matching event on AES or OTTO`;
    default: return tn;
  }
}

const KIND_TITLES = [
  ["auto_updated", "Updated in HQ automatically"],
  ["dropped_on_platform", "Dropped on the platform, still going in HQ"],
  ["not_on_platform", "In HQ, but the platform doesn't list them"],
  ["not_found", "In HQ, but not on AES or OTTO at all"],
  ["not_in_hq", "Entered on the platform, missing from HQ"],
  ["unknown_event", "Entered in an event HQ doesn't have"],
];
export function buildEmail(items, { today, olderOpen = 0, appUrl, partial = [] }) {
  const auto = items.filter((f) => f.kind === "auto_updated").length;
  const look = items.length - auto;
  const subject = `Registration check: ${[look ? `${look} to look at` : null, auto ? `${auto} updated in HQ` : null].filter(Boolean).join(", ")}`;
  const lines = [`Daily registration check, ${fmtDay(today)} — AES and OTTO compared with HQ.`, ""];
  for (const [kind, title] of KIND_TITLES) {
    const xs = items.filter((f) => f.kind === kind).sort((a, b) => String(a.detail?.start || a.detail?.event_start).localeCompare(String(b.detail?.start || b.detail?.event_start)) || byName(a.team_name, b.team_name));
    if (!xs.length) continue;
    lines.push(`${title} (${xs.length})`);
    for (const f of xs) lines.push(`  • ${f.team_name} · ${f.message}`);
    lines.push("");
  }
  if (olderOpen) lines.push(`Still open from earlier emails: ${olderOpen}.`, "");
  if (partial.length) lines.push(`${partial.join(" and ")} only partly answered today; the events it couldn't read are checked again tomorrow.`, "");
  lines.push(`Tournaments in HQ: ${appUrl}`);
  return { subject, body: lines.join("\n") };
}
