// Privacy + correctness check for the public website payload (api/site-data.js).
//
// Builds the payload with the service role exactly as the endpoint does (or,
// with --url, fetches a deployed one) and fails loudly if anything that must
// never be public could be in it:
//   - every object has exactly the keys of the website contract (no stray
//     field from a DB row), and no key anywhere looks like private data
//     (dob, parent, email, phone, notes, scores, tokens, offer/roster status...)
//   - no email address or phone number in any text value
//   - teams are public teams only: no event team (14 Crystal) anywhere
//   - rosters = accepted/locked, current season, not site_hidden — counted per
//     team with independent SQL and each listed girl matched back to her row
//   - no dropped assignment, cancelled or finished tournament
//   - no placeholder coach (TBD, floater)
//   - no parentheses in any published name ("(Legal) Preferred" is published as "Preferred");
//     grad years come from the CURRENT season's reports; sessions carry kind court|sa and
//     Speed & Agility matches sa_sessions; current_phase is never null while a phase is still to come
//   - counts: tournaments = events with a CONFIRMED public entry, planned_tournaments = the rest;
//     a link-less tournament has no twin row that carries a link
//   - no calendar_index link; a bio never names a team its coach isn't on
//   - with --url (live): any query string answers 400, the calendar index leaves out event teams,
//     a team ICS says Status: Confirmed/Tentative, and the form endpoints refuse a wrong test token
//     (and, when SITE_TEST_TOKEN is set, accept the right one without saving anything)
//
// Usage:
//   node scripts/site-data-check.mjs                     # build locally (service role)
//   node scripts/site-data-check.mjs --url https://dseliteevals.vercel.app/api/site-data
//
// Env (.env): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN (for the SQL counts);
// SITE_TEST_TOKEN (optional, env or .env) for the live form test-mode check.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { isPlaceholder, PRESEASON_DATES, PHASE_RANGES, span } from "../shared/day-schedule.js";
import { isEventTeam } from "../shared/event-teams.js";

function loadEnv() {
  const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const env = loadEnv();
for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) if (!process.env[k]) process.env[k] = env[k];
const { publicName } = await import("../api/site-data.js");
const args = process.argv.slice(2);
const urlArg = (() => { const i = args.indexOf("--url"); return i >= 0 ? args[i + 1] : null; })();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data || []; };

// Read-only SQL through the Management API — independent of the builder's PostgREST filters.
async function sql(query) {
  const ref = new URL(env.SUPABASE_URL).hostname.split(".")[0];
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `set default_transaction_read_only = on; ${query}` }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error("SQL failed: " + text.slice(0, 300));
  return JSON.parse(text);
}

const fails = [];
const fail = (msg) => fails.push(msg);
const ok = (cond, msg) => { if (!cond) fail(msg); };

// ---- 1. the payload ---------------------------------------------------------------
let data;
if (urlArg) {
  const r = await fetch(urlArg, { headers: { "cache-control": "no-cache" } });
  ok(r.status === 200, `GET ${urlArg} → HTTP ${r.status}`);
  ok(r.headers.get("access-control-allow-origin") === "*", "missing Access-Control-Allow-Origin: *");
  ok(/noindex/i.test(r.headers.get("x-robots-tag") || ""), "missing X-Robots-Tag noindex");
  data = await r.json();
  console.log(`Fetched ${urlArg} (${JSON.stringify(data).length} bytes, cache-control: ${r.headers.get("cache-control")})`);
} else {
  const { buildSiteData } = await import("../api/site-data.js");
  data = await buildSiteData(sb, { now: new Date() });
  console.log(`Built locally (${JSON.stringify(data).length} bytes)`);
}
ok(data && data.ok === true, "ok is not true");

// ---- 2. exact keys (the contract) + private-looking keys -------------------------------
const S = {
  root: ["ok", "generated_at", "season", "today", "counts", "venues", "teams", "staff", "tournaments", "this_weekend", "links", "training"],
  counts: ["teams", "athletes", "coaches", "tournaments", "planned_tournaments", "travel_tournaments", "qualifiers", "states"],
  venues: ["warehouse", "flex"],
  venue: ["key", "name", "address", "map_url"],
  team: ["slug", "name", "age", "age_div", "gem", "level", "practices_per_week", "coaches", "roster", "roster_count", "practice", "tournaments", "next_tournament", "live", "links"],
  person: ["slug", "name", "role"],
  player: ["number", "first_name", "last_name", "name", "position", "pos_code", "grad_year"],
  practice: ["current_phase", "phases"],
  phase: ["id", "label", "from", "to", "sessions", "note"],
  session: ["day", "day_label", "start", "end", "label", "kind", "venue", "from", "to"],
  teamTn: ["id", "kind", "name", "start", "end", "city", "venue", "division", "status", "qualifier", "qualifier_type", "travel", "url", "session"],
  live: ["tournament", "status", "record", "finish", "next", "updated_at"],
  teamLinks: ["hub", "calendar_ics", "calendar_webcal", "calendar_google"],
  tn: ["id", "kind", "name", "start", "end", "city", "venue", "qualifier", "qualifier_type", "travel", "url", "teams"],
  tnTeam: ["slug", "name", "division", "status"],
  staff: ["slug", "name", "title", "bio", "photo_url", "leadership", "sort_order", "teams"],
  weekend: ["label", "start", "end", "tournaments"],
  links: ["hq", "hub"],
  training: ["programs", "links"],
  trainingProgram: ["name", "kind", "ages", "next_dates", "start_time", "end_time", "sessions_left", "venue", "register_url"],
  trainingLinks: ["volleyball", "pods", "reach", "calendar"],
};
const OPTIONAL = { root: new Set(["training"]), live: new Set(["record", "finish", "next", "updated_at"]), phase: new Set(["note"]), session: new Set(["from", "to"]) };
function keys(obj, type, where) {
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) { fail(`${where}: expected an object`); return; }
  const allowed = S[type];
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) fail(`${where}: unexpected key "${k}"`);
  for (const k of allowed) if (!(k in obj) && !(OPTIONAL[type] && OPTIONAL[type].has(k))) fail(`${where}: missing key "${k}"`);
}
keys(data, "root", "root");
keys(data.counts, "counts", "counts");
keys(data.venues, "venues", "venues");
for (const v of ["warehouse", "flex"]) keys(data.venues[v], "venue", "venues." + v);
keys(data.links, "links", "links");
data.teams.forEach((t, i) => {
  const w = `teams[${i}] ${t.name}`;
  keys(t, "team", w);
  t.coaches.forEach((c, j) => keys(c, "person", `${w}.coaches[${j}]`));
  t.roster.forEach((p, j) => keys(p, "player", `${w}.roster[${j}]`));
  keys(t.practice, "practice", w + ".practice");
  t.practice.phases.forEach((p, j) => { keys(p, "phase", `${w}.phases[${j}]`); p.sessions.forEach((s, k) => keys(s, "session", `${w}.phases[${j}].sessions[${k}]`)); });
  t.tournaments.forEach((x, j) => keys(x, "teamTn", `${w}.tournaments[${j}]`));
  if (t.next_tournament) keys(t.next_tournament, "teamTn", w + ".next_tournament");
  if (t.live) keys(t.live, "live", w + ".live");
  keys(t.links, "teamLinks", w + ".links");
});
data.staff.forEach((s, i) => { keys(s, "staff", `staff[${i}] ${s.name}`); s.teams.forEach((x, j) => keys(x, "person", `staff[${i}].teams[${j}]`)); });
data.tournaments.forEach((t, i) => { keys(t, "tn", `tournaments[${i}]`); t.teams.forEach((x, j) => keys(x, "tnTeam", `tournaments[${i}].teams[${j}]`)); });
if (data.this_weekend) { keys(data.this_weekend, "weekend", "this_weekend"); data.this_weekend.tournaments.forEach((t, i) => keys(t, "tn", `this_weekend.tournaments[${i}]`)); }

const PRIVATE_KEY = /dob|birth|parent|email|phone|address|zip|note|comment|score|token|offer|roster_status|scholar|medical|allerg|tryout|eval|reg_position|kickoff|cost|housing|registration/i;
const ALLOWED_PATH = [/^venues\.(warehouse|flex)\.address$/, /^teams\.practice\.phases\.note$/];   // the club's buildings, public on the website; the Speed & Agility "select dates" line
const URL_KEYS = new Set(["url", "photo_url", "map_url", "hub", "hq", "calendar_ics", "calendar_webcal", "calendar_google"]);
const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i;
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
let nKeys = 0;
(function walk(v, path) {
  if (Array.isArray(v)) return v.forEach((x, i) => walk(x, path + "[]"));
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      nKeys++;
      const p = path ? path + "." + k : k;
      if (PRIVATE_KEY.test(k) && !ALLOWED_PATH.some((re) => re.test(p.replace(/\[\]/g, "")))) fail(`private-looking key: ${p}`);
      if (typeof x === "string" && !URL_KEYS.has(k) && !/^(generated_at|updated_at)$/.test(k)) {
        if (EMAIL.test(x)) fail(`email address in ${p}`);
        if (PHONE.test(x)) fail(`phone number in ${p}`);
      }
      walk(x, p);
    }
  }
})(data, "");

// ---- 3. teams: public only -------------------------------------------------------------
const pt = must(await sb.from("practice_teams").select("team_name, practices_per_week, head_coach, assistant_coach, third_coach"), "practice_teams");
const eventTeams = pt.filter(isEventTeam).map((t) => t.team_name.trim());
const publicTeams = pt.filter((t) => !isEventTeam(t)).map((t) => t.team_name.trim());
ok(eventTeams.includes("14 Crystal") || !pt.some((t) => t.team_name === "14 Crystal"), "expected 14 Crystal to be an event team");
const blob = JSON.stringify(data);
for (const n of eventTeams) ok(!blob.includes(`"${n}"`), `event team ${n} appears in the payload`);
ok(!/14 Crystal/i.test(blob), "14 Crystal appears in the payload");
ok(data.teams.length === publicTeams.length, `teams: ${data.teams.length} in payload vs ${publicTeams.length} public teams`);
for (const t of data.teams) ok(publicTeams.includes(t.name), `${t.name} isn't a public team`);

// ---- 4. rosters --------------------------------------------------------------------------
const season = data.season;
const counts = await sql(`select team_assignment as team, count(*)::int as n from public.players
  where coalesce(team_assignment,'') <> '' and offer_status in ('accepted','locked') and season = '${season.replace(/'/g, "''")}' and not site_hidden
  group by 1`);
const countBy = new Map(counts.map((r) => [String(r.team).trim(), r.n]));
for (const t of data.teams) {
  ok(t.roster_count === t.roster.length, `${t.name}: roster_count ${t.roster_count} ≠ roster length ${t.roster.length}`);
  ok(t.roster_count === (countBy.get(t.name) || 0), `${t.name}: ${t.roster_count} on the site vs ${countBy.get(t.name) || 0} accepted/locked (SQL)`);
}
const all = must(await sb.from("players").select("id, team_assignment, first_name, last_name, offer_status, season, site_hidden").in("team_assignment", data.teams.map((t) => t.name)), "players");
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
let matched = 0;
for (const t of data.teams) for (const p of t.roster) {
  for (const k of ["first_name", "last_name", "name"]) ok(!/[()]/.test(p[k]), `${t.name}: parentheses in a published player ${k}: "${p[k]}"`);
  // the published name is the text outside any parentheses ("(Legal) Preferred" → "Preferred")
  const rows = all.filter((r) => norm(r.team_assignment) === norm(t.name) && norm(publicName(r.first_name)) === norm(p.first_name) && norm(publicName(r.last_name)) === norm(p.last_name));
  const good = rows.filter((r) => ["accepted", "locked"].includes(r.offer_status) && r.season === season && !r.site_hidden);
  if (good.length) matched++; else fail(`${t.name}: a listed player doesn't match an accepted/locked, visible row`);
}
const total = data.teams.reduce((n, t) => n + t.roster.length, 0);
ok(data.counts.athletes === total, `counts.athletes ${data.counts.athletes} ≠ ${total}`);
const hiddenN = all.filter((r) => r.site_hidden).length;
const parenRows = all.filter((r) => /[()]/.test(r.first_name + r.last_name) && ["accepted", "locked"].includes(r.offer_status) && r.season === season && !r.site_hidden);

// grad year = season end year + (12 − grade), from the current season's reports (not the report's own date)
const seasonEnd = parseInt(season.slice(0, 4), 10) + 1;
const reps = must(await sb.from("school_team_reports").select("player_id, grade, updated_at, submitted_at").in("player_id", all.map((r) => r.id)), "school_team_reports");
const gradBy = new Map();
for (const r of reps) {
  const g = parseInt(r.grade, 10), at = r.updated_at || r.submitted_at || "", prev = gradBy.get(r.player_id);
  if (g >= 1 && g <= 12 && (!prev || at > prev.at)) gradBy.set(r.player_id, { g, at });
}
let gradChecked = 0;
for (const t of data.teams) {
  const want = all.filter((r) => norm(r.team_assignment) === norm(t.name) && ["accepted", "locked"].includes(r.offer_status) && r.season === season && !r.site_hidden)
    .map((r) => norm(publicName(r.first_name) + " " + publicName(r.last_name)) + "|" + (gradBy.has(r.id) ? seasonEnd + 12 - gradBy.get(r.id).g : null)).sort();
  const got = t.roster.map((p) => norm(p.name) + "|" + p.grad_year).sort();
  gradChecked += got.length;
  ok(JSON.stringify(want) === JSON.stringify(got), `${t.name}: roster names / grad years don't match the current-season reports`);
}

// ---- 5. tournaments ----------------------------------------------------------------------
const today = data.today;
const tnIds = [...new Set(data.tournaments.filter((t) => t.kind === "event").map((t) => Number(t.id)))];
const tnRows = tnIds.length ? must(await sb.from("tournaments").select("id, cancelled, start_date, end_date").in("id", tnIds), "tournaments") : [];
const asg = tnIds.length ? must(await sb.from("tournament_assignments").select("tournament_id, team_id, status").in("tournament_id", tnIds), "tournament_assignments") : [];
for (const t of data.tournaments) {
  ok(t.end >= today, `${t.name} ended ${t.end}`);
  ok(t.teams.length > 0, `${t.name} has no teams`);
  if (t.kind !== "event") continue;
  const row = tnRows.find((r) => String(r.id) === t.id);
  ok(row && !row.cancelled, `${t.name} (#${t.id}) is cancelled or missing`);
  for (const e of t.teams) {
    const a = asg.filter((x) => String(x.tournament_id) === t.id && x.team_id.trim() === e.name);
    ok(a.some((x) => x.status !== "dropped"), `${t.name}: ${e.name} is only listed as dropped`);
    const want = a.some((x) => ["locked", "registered", "accepted", "rostered", "need_to_drop"].includes(x.status)) ? "confirmed" : "tentative";
    ok(e.status === want, `${t.name}: ${e.name} status ${e.status}, expected ${want}`);
  }
}
for (const t of data.teams) for (const x of t.tournaments) ok(data.tournaments.some((y) => y.id === x.id && y.teams.some((e) => e.name === t.name)), `${t.name}: ${x.name} missing from the season list`);
const dropped = await sql(`select count(*)::int n from public.tournament_assignments where status = 'dropped'`);

// counts: tournaments / travel / qualifiers / states are over events with a CONFIRMED public entry; planned_tournaments = the rest
const going = data.tournaments.filter((t) => t.teams.some((e) => e.status === "confirmed"));
const plannedN = data.tournaments.filter((t) => t.teams.every((e) => e.status === "tentative")).length;
ok(data.counts.tournaments === going.length, `counts.tournaments ${data.counts.tournaments} ≠ ${going.length} events with a confirmed entry`);
ok(data.counts.planned_tournaments === plannedN, `counts.planned_tournaments ${data.counts.planned_tournaments} ≠ ${plannedN} events that are all tentative`);
ok(data.counts.tournaments + data.counts.planned_tournaments === data.tournaments.length, "tournaments + planned_tournaments ≠ the season list");
ok(data.counts.travel_tournaments === going.filter((t) => t.travel).length, "counts.travel_tournaments isn't over confirmed events");
ok(data.counts.qualifiers === going.filter((t) => t.qualifier).length, "counts.qualifiers isn't over confirmed events");
ok(data.tournaments.filter((t) => t.kind === "in_house").every((t) => going.includes(t)), "the in-house tournament isn't counted");

// a tournament with no link must not have a twin row (same name + first day) that has one
const twinNorm = (s) => String(s || "").replace(/\s+/g, " ").replace(/#\s+(?=\d)/g, "#").replace(/\s+--\s+/g, " — ").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const bare = data.tournaments.filter((t) => t.kind === "event" && !t.url);
if (bare.length) {
  const twins = must(await sb.from("tournaments").select("id, name, start_date, source_url").in("start_date", [...new Set(bare.map((t) => t.start))]), "tournaments (twins)");
  for (const t of bare) {
    const hit = twins.find((r) => String(r.id) !== t.id && twinNorm(r.name) === twinNorm(t.name) && String(r.start_date).slice(0, 10) === t.start && /^https?:\/\//i.test(String(r.source_url || "").trim()));
    ok(!hit, `${t.name} (#${t.id}) has no link but twin #${hit && hit.id} does`);
  }
}

// ---- 5b. practice: kinds, Speed & Agility, current_phase ---------------------------------------
const NOTE = "Speed & Agility sessions on select dates — see the team calendar.";
const teamNames = data.teams.map((t) => t.name);
const saDb = must(await sb.from("sa_sessions").select("team_name, session_date, slot").in("team_name", teamNames).gte("session_date", today), "sa_sessions");
const dow = (d) => new Date(d + "T12:00:00Z").getUTCDay();
const addD = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
let saSessions = 0, saNotes = 0, splitSessions = 0;
for (const t of data.teams) {
  const w = t.name + " practice";
  const phases = t.practice.phases;
  const cur = phases.find((p) => p.from <= today && today <= p.to) || phases.find((p) => p.from > today) || null;
  ok((t.practice.current_phase ?? null) === (cur ? cur.id : null), `${w}: current_phase ${t.practice.current_phase} but the phase running or next is ${cur ? cur.id : "none"}`);
  for (const p of phases) {
    ok(p.to >= today, `${w}: ${p.id} already ended`);
    ok(p.note === undefined || p.note === NOTE, `${w}: ${p.id} has an unexpected note`);
    const dated = PRESEASON_DATES[p.id];
    const range = PHASE_RANGES.find((r) => r[0] === p.id);
    ok(range && range[1] === p.from && range[2] === p.to, `${w}: ${p.id} dates ${p.from}..${p.to} aren't the phase's`);
    for (const s of p.sessions) {
      ok(s.kind === "court" || s.kind === "sa", `${w}: ${p.id} session kind "${s.kind}"`);
      ok(/^\d\d:\d\d$/.test(s.start) && /^\d\d:\d\d$/.test(s.end) && s.start < s.end, `${w}: ${p.id} session times ${s.start}-${s.end}`);
      ok(s.venue === "warehouse" || s.venue === "flex", `${w}: ${p.id} venue ${s.venue}`);
      ok(("from" in s) === ("to" in s), `${w}: ${p.id} session has only one of from/to`);
      if ("from" in s) {
        splitSessions++;
        ok(/^\d{4}-\d\d-\d\d$/.test(s.from) && /^\d{4}-\d\d-\d\d$/.test(s.to) && p.from <= s.from && s.from <= s.to && s.to <= p.to && !(s.from === p.from && s.to === p.to), `${w}: ${p.id} session from/to ${s.from}..${s.to} isn't a part of ${p.from}..${p.to}`);
      }
      if (s.kind === "sa") {
        saSessions++;
        ok(s.label === "Speed & Agility" && s.venue === "warehouse" && s.day === "Sun" && !("from" in s), `${w}: ${p.id} Speed & Agility session shape`);
      } else ok(/\d/.test(s.label) && /(am|pm)$/.test(s.label), `${w}: ${p.id} court label "${s.label}"`);
    }
    ok(p.sessions.length > 0, `${w}: ${p.id} has no sessions`);
    // Speed & Agility, worked out again from sa_sessions: a slot on EVERY remaining Sunday is a weekly session
    const from = p.from > today ? p.from : today;
    const required = dated ? dated.filter((d) => d >= from && d <= p.to) : (() => { const o = []; for (let d = addD(from, (7 - dow(from)) % 7); d <= p.to; d = addD(d, 7)) o.push(d); return o; })();
    const bySlot = new Map();
    for (const r of saDb.filter((r) => r.team_name === t.name && String(r.session_date).slice(0, 10) >= from && String(r.session_date).slice(0, 10) <= p.to)) {
      const k = String(r.slot).trim(); if (!bySlot.has(k)) bySlot.set(k, new Set()); bySlot.get(k).add(String(r.session_date).slice(0, 10));
    }
    let weekly = 0, partial = false;
    for (const [slot, ds] of bySlot) {
      const [a, b] = span(slot);
      const every = required.length && required.every((d) => ds.has(d)) && [...ds].every((d) => dow(d) === 0);
      if (every && a < 99 && b > a) weekly++; else partial = true;
    }
    const inPayload = p.sessions.filter((s) => s.kind === "sa");
    ok(weekly === 0 ? inPayload.length === 0 : inPayload.length >= 1 && inPayload.length <= weekly, `${w}: ${p.id} has ${inPayload.length} Speed & Agility session(s) but sa_sessions has ${weekly} weekly slot(s)`);
    ok(partial === (p.note === NOTE), `${w}: ${p.id} note ${p.note ? "present" : "missing"} but sa_sessions ${partial ? "has" : "has no"} patchy dates`);
    if (p.note) saNotes++;
  }
}

// ---- 6. coaches --------------------------------------------------------------------------
const names = [...data.teams.flatMap((t) => t.coaches.map((c) => c.name)), ...data.staff.map((s) => s.name)];
for (const n of names) ok(!isPlaceholder(n) && !/^(tbd|tba|n\/a|none|open|sub)$/i.test(n), `placeholder coach "${n}"`);
const rosterCoaches = new Set(pt.filter((t) => !isEventTeam(t)).flatMap((t) => [t.head_coach, t.assistant_coach, t.third_coach]).map((s) => String(s || "").trim()).filter((s) => s && !isPlaceholder(s)));
const staffRows = must(await sb.from("site_staff").select("name, show_on_site, leadership"), "site_staff");
for (const n of rosterCoaches) {
  const r = staffRows.find((x) => x.name === n);
  ok(r && r.show_on_site === false ? !data.staff.some((s) => s.name === n) : data.staff.some((s) => s.name === n), `coach ${n} listing doesn't match show_on_site`);
}
for (const s of data.staff) ok(rosterCoaches.has(s.name) || staffRows.some((r) => r.name === s.name && r.leadership), `${s.name} is on the staff list but not a coach or leader`);
// a bio that names a team ("14 Sapphire") must name one the coach is on, and never "next season"
const TEAM_IN_BIO = /\b\d{1,2}\s+(?:Diamond|Ruby|Emerald|Sapphire|Topaz|Crystal|Pearl|Opal|Onyx|Amethyst|Garnet|Jade|Rise)(?:\s+\d)?\b/gi;
let biosNamingTeams = 0;
for (const s of data.staff) {
  if (!s.bio) continue;
  ok(!/\bnext season\b/i.test(s.bio), `${s.name}'s bio says "next season"`);
  for (const m of s.bio.matchAll(TEAM_IN_BIO)) {
    biosNamingTeams++;
    ok(s.teams.some((x) => norm(x.name).startsWith(norm(m[0]))), `${s.name}'s bio names ${m[0]}, which isn't one of their teams (${s.teams.map((x) => x.name).join(", ") || "none"})`);
  }
}
for (const s of data.staff) ok(!/[()]/.test(s.name), `parentheses in staff name ${s.name}`);

// ---- 7. live only: the endpoint's edges, the calendar feed, the forms ---------------------------
const liveNotes = [];
if (urlArg) {
  const u = new URL(urlArg), base = u.origin, readText = async (r) => r.text();
  // any query string is refused (one URL, one cached copy)
  const q = new URL(urlArg); q.search = "?x=1";
  const qr = await fetch(q, { headers: { "cache-control": "no-cache" } });
  const qb = await qr.json().catch(() => ({}));
  const cc = qr.headers.get("cache-control") || "";
  ok(qr.status === 400 && qb.ok === false && qb.error === "no query parameters", `GET ${q.pathname}?x=1 → ${qr.status} ${JSON.stringify(qb)} (want 400 no query parameters)`);
  ok(/public/.test(cc) && /s-maxage=3600/.test(cc), `query-string 400 cache-control "${cc}" (want public, s-maxage=3600)`);
  liveNotes.push(`query string → ${qr.status} ${qb.error} (${cc})`);

  // the calendar index lists every public team and no event team
  const ix = await readText(await fetch(base + "/api/calendar"));
  for (const n of eventTeams) ok(!ix.includes(`team=${encodeURIComponent(n)}`) && !ix.includes(`>${n}<`), `calendar index still lists event team ${n}`);
  ok(!/14 Crystal/.test(ix), "calendar index still lists 14 Crystal");
  for (const n of publicTeams) ok(ix.includes(`team=${encodeURIComponent(n)}`), `calendar index is missing ${n}`);
  liveNotes.push(`calendar index: ${publicTeams.length} public teams, no event team`);

  // a team ICS words the status for parents
  for (const want of ["confirmed", "tentative"]) {
    const team = data.teams.find((t) => t.tournaments.some((x) => x.kind === "event" && x.status === want));
    if (!team) continue;
    const ics = await readText(await fetch(`${base}/api/calendar?team=${encodeURIComponent(team.name)}`));
    ok(ics.includes("Status: " + want[0].toUpperCase() + want.slice(1)), `${team.name} ICS has no "Status: ${want[0].toUpperCase() + want.slice(1)}"`);
    ok(!/Status: (planned|in_progress|locked|registered|accepted|rostered|need_to_drop)\b/.test(ics), `${team.name} ICS still prints a raw status`);
    liveNotes.push(`${team.name} ICS says Status: ${want[0].toUpperCase() + want.slice(1)}`);
  }

  // the form endpoints: a wrong test token is a 403 and does nothing; the right one validates without saving.
  // (Only against a deployment that has the token gate — before it, any x-site-test value was a test header,
  // and an old site-optin would have saved this request for real.)
  if (!("planned_tournaments" in data.counts)) liveNotes.push("form checks skipped: this deployment predates the test-token gate");
  else {
    const body = JSON.stringify({ first_name: "Check", last_name: "Script", phone: "(512) 555-0142", consent: true, consent_text: "check", name: "Check Script", email: "check@example.com", topic: "general", message: "check" });
    for (const ep of ["site-optin", "site-contact"]) {
      const r = await fetch(`${base}/api/${ep}`, { method: "POST", headers: { "content-type": "application/json", "x-site-test": "1" }, body });
      ok(r.status === 403, `${ep} with a wrong test token → ${r.status} (want 403)`);
      liveNotes.push(`${ep}: wrong test token → ${r.status}`);
    }
    const token = process.env.SITE_TEST_TOKEN || env.SITE_TEST_TOKEN;
    if (token) {
      const r = await fetch(`${base}/api/site-optin`, { method: "POST", headers: { "content-type": "application/json", "x-site-test": token }, body });
      const j = await r.json().catch(() => ({}));
      ok(r.status === 200 && JSON.stringify(j) === JSON.stringify({ ok: true, test: true }), `site-optin test mode → ${r.status} ${JSON.stringify(j)}`);
      liveNotes.push(`site-optin: test token → ${r.status} ${JSON.stringify(j)} (nothing written)`);
    } else liveNotes.push("site-optin test-mode check skipped (no SITE_TEST_TOKEN)");
  }
}

// ---- training: upcoming volleyball sessions only, whitelisted, Playbook links only ----------
if (data.training !== undefined) {
  const T = data.training;
  keys(T, "training", "training");
  keys(T.links, "trainingLinks", "training.links");
  const PB = "https://drippingsports.playbookapi.com/programs/";
  ok(T.links.volleyball === PB + "register/volleyball/" && T.links.pods === PB + "register/volleyball_pods/" && T.links.reach === PB + "register/reach_performance/" && T.links.calendar === PB + "calendar", "training.links are not the expected Playbook URLs");
  ok(Array.isArray(T.programs) && T.programs.length >= 1 && T.programs.length <= 12, "training.programs must hold 1-12 programs");
  const clin = must(await sb.from("dssc_clinics").select("name, sport, coach_name, assistants"), "dssc_clinics");
  const bball = new Set(clin.filter((c) => c.sport === "basketball").map((c) => String(c.name).trim().toLowerCase()));
  const people = new Set(clin.flatMap((c) => [c.coach_name, ...String(c.assistants || "").split(/[,;&]/)]).map((s) => String(s || "").trim().toLowerCase()).filter((s) => s.length > 3));
  const volley = new Set(clin.filter((c) => c.sport !== "basketball").map((c) => String(c.name).trim().toLowerCase()));
  const lo = data.today, hi = new Date(Date.parse(lo + "T12:00:00Z") + 75 * 86400000).toISOString().slice(0, 10);
  const seen = new Set();
  T.programs.forEach((p, i) => {
    const w = `training.programs[${i}] ${p.name}`;
    keys(p, "trainingProgram", w);
    ok(!seen.has(p.name.toLowerCase()), `${w}: duplicate program`); seen.add(p.name.toLowerCase());
    ok(p.name === p.name.trim() && p.name.length > 0, `${w}: name not trimmed`);
    ok(!bball.has(p.name.toLowerCase()) || volley.has(p.name.toLowerCase()), `${w}: basketball program`);
    ok(!/basketball/i.test(p.name), `${w}: basketball in name`);
    ok(["pod", "camp", "clinic", "program"].includes(p.kind), `${w}: bad kind ${p.kind}`);
    ok(p.venue === null || p.venue === "warehouse" || p.venue === "flex", `${w}: bad venue`);
    ok(Array.isArray(p.next_dates) && p.next_dates.length >= 1 && p.next_dates.length <= 4, `${w}: next_dates length`);
    ok(p.next_dates.every((d, j) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= lo && d <= hi && (!j || d > p.next_dates[j - 1])), `${w}: next_dates outside window or unsorted`);
    ok(p.sessions_left >= p.next_dates.length, `${w}: sessions_left < next_dates`);
    for (const t of [p.start_time, p.end_time]) ok(t === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(t), `${w}: bad time ${t}`);
    ok(p.ages === null || (typeof p.ages === "string" && p.ages.length < 40), `${w}: bad ages`);
    ok([T.links.volleyball, T.links.pods, T.links.reach].includes(p.register_url), `${w}: register_url isn't a Playbook register page`);
    ok(p.kind !== "pod" || p.register_url === T.links.pods, `${w}: pod not linked to PODs page`);
    const txt = JSON.stringify(p).toLowerCase();
    for (const who of people) ok(!txt.includes(who), `${w}: contains a coach name`);
  });
  for (let i = 1; i < T.programs.length; i++) ok(T.programs[i - 1].next_dates[0] <= T.programs[i].next_dates[0], "training.programs not sorted by next date");
  console.log(`training: ${T.programs.length} programs (${T.programs.map((p) => p.kind).join(",")})`);
} else console.log("training: omitted (nothing upcoming or query failed)");

// ---- report -------------------------------------------------------------------------------
console.log(`teams ${data.teams.length} (public ${publicTeams.length}; event teams hidden: ${eventTeams.join(", ") || "none"})`);
console.log(`athletes ${total} (matched ${matched}/${total} to accepted rows; ${hiddenN} hidden by families)`);
console.log(`staff ${data.staff.length} (leadership ${data.staff.filter((s) => s.leadership).length}, with bio ${data.staff.filter((s) => s.bio).length}, with photo ${data.staff.filter((s) => s.photo_url).length})`);
console.log(`tournaments listed ${data.tournaments.length} (counted ${data.counts.tournaments} + planned ${data.counts.planned_tournaments}; in-house ${data.tournaments.filter((t) => t.kind === "in_house").length}, travel ${data.counts.travel_tournaments}, qualifiers ${data.counts.qualifiers}, states ${data.counts.states}); dropped assignments in DB: ${dropped[0]?.n ?? "?"}`);
console.log(`this_weekend: ${data.this_weekend ? `${data.this_weekend.label} ${data.this_weekend.start} (${data.this_weekend.tournaments.map((t) => t.name).join(", ")})` : "null"}`);
console.log(`counts: ${JSON.stringify(data.counts)}`);
console.log(`names: ${parenRows.length} stored with parentheses, none published; grad years checked for ${gradChecked} players against the ${season} reports`);
console.log(`practice: ${saSessions} Speed & Agility sessions, ${saNotes} phases noted "select dates", ${splitSessions} sessions split by a venue window; current_phase set for ${data.teams.filter((t) => t.practice.current_phase).length}/${data.teams.length} teams`);
console.log(`bios naming a team: ${biosNamingTeams} (all on the coach's own teams)`);
for (const l of liveNotes) console.log(`live: ${l}`);
console.log(`keys scanned: ${nKeys}`);
if (fails.length) {
  console.error(`\nFAIL — ${fails.length} problem(s):`);
  for (const f of fails.slice(0, 60)) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("\nPASS ✓ site-data is clean");
