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
//
// Usage:
//   node scripts/site-data-check.mjs                     # build locally (service role)
//   node scripts/site-data-check.mjs --url https://dseliteevals.vercel.app/api/site-data
//
// Env (.env): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN (for the SQL counts).

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { isPlaceholder } from "../shared/day-schedule.js";
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
  root: ["ok", "generated_at", "season", "today", "counts", "venues", "teams", "staff", "tournaments", "this_weekend", "links"],
  counts: ["teams", "athletes", "coaches", "tournaments", "travel_tournaments", "qualifiers", "states"],
  venues: ["warehouse", "flex"],
  venue: ["key", "name", "address", "map_url"],
  team: ["slug", "name", "age", "age_div", "gem", "level", "practices_per_week", "coaches", "roster", "roster_count", "practice", "tournaments", "next_tournament", "live", "links"],
  person: ["slug", "name", "role"],
  player: ["number", "first_name", "last_name", "name", "position", "pos_code", "grad_year"],
  practice: ["current_phase", "phases"],
  phase: ["id", "label", "from", "to", "sessions"],
  session: ["day", "day_label", "start", "end", "label", "venue"],
  teamTn: ["id", "kind", "name", "start", "end", "city", "venue", "division", "status", "qualifier", "qualifier_type", "travel", "url", "session"],
  live: ["tournament", "status", "record", "finish", "next", "updated_at"],
  teamLinks: ["hub", "calendar_ics", "calendar_webcal", "calendar_google"],
  tn: ["id", "kind", "name", "start", "end", "city", "venue", "qualifier", "qualifier_type", "travel", "url", "teams"],
  tnTeam: ["slug", "name", "division", "status"],
  staff: ["slug", "name", "title", "bio", "photo_url", "leadership", "sort_order", "teams"],
  weekend: ["label", "start", "end", "tournaments"],
  links: ["hq", "hub", "calendar_index"],
};
const OPTIONAL = { live: new Set(["record", "finish", "next", "updated_at"]) };
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
const ALLOWED_PATH = [/^venues\.(warehouse|flex)\.address$/];   // the club's buildings, public on the website
const URL_KEYS = new Set(["url", "photo_url", "map_url", "hub", "hq", "calendar_index", "calendar_ics", "calendar_webcal", "calendar_google"]);
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
const all = must(await sb.from("players").select("team_assignment, first_name, last_name, offer_status, season, site_hidden").in("team_assignment", data.teams.map((t) => t.name)), "players");
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
let matched = 0;
for (const t of data.teams) for (const p of t.roster) {
  const rows = all.filter((r) => norm(r.team_assignment) === norm(t.name) && norm(r.first_name) === norm(p.first_name) && norm(r.last_name) === norm(p.last_name));
  const good = rows.filter((r) => ["accepted", "locked"].includes(r.offer_status) && r.season === season && !r.site_hidden);
  if (good.length) matched++; else fail(`${t.name}: a listed player doesn't match an accepted/locked, visible row`);
}
const total = data.teams.reduce((n, t) => n + t.roster.length, 0);
ok(data.counts.athletes === total, `counts.athletes ${data.counts.athletes} ≠ ${total}`);
const hiddenN = all.filter((r) => r.site_hidden).length;

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

// ---- report -------------------------------------------------------------------------------
console.log(`teams ${data.teams.length} (public ${publicTeams.length}; event teams hidden: ${eventTeams.join(", ") || "none"})`);
console.log(`athletes ${total} (matched ${matched}/${total} to accepted rows; ${hiddenN} hidden by families)`);
console.log(`staff ${data.staff.length} (leadership ${data.staff.filter((s) => s.leadership).length}, with bio ${data.staff.filter((s) => s.bio).length}, with photo ${data.staff.filter((s) => s.photo_url).length})`);
console.log(`tournaments ${data.tournaments.length} (in-house ${data.tournaments.filter((t) => t.kind === "in_house").length}, travel ${data.counts.travel_tournaments}, qualifiers ${data.counts.qualifiers}, states ${data.counts.states}); dropped assignments in DB: ${dropped[0]?.n ?? "?"}`);
console.log(`this_weekend: ${data.this_weekend ? `${data.this_weekend.label} ${data.this_weekend.start} (${data.this_weekend.tournaments.map((t) => t.name).join(", ")})` : "null"}`);
console.log(`keys scanned: ${nKeys}`);
if (fails.length) {
  console.error(`\nFAIL — ${fails.length} problem(s):`);
  for (const f of fails.slice(0, 60)) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("\nPASS ✓ site-data is clean");
