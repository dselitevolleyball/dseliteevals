// Rebuild school_games from what families pasted into the school-team form.
//
// Wholesale rebuild, not a merge: the parse is a pure function of the text, so
// the way to fix a wrong game is to fix the family's answer (or the parser) and
// run this again. Merging would leave yesterday's misreadings behind forever.
//
// Two inputs, same parser: what families pasted, and what
// scripts/fetch-school-schedules.mjs pulled off the links they sent instead.
//
// Games are keyed to the SCHOOL. One parent pasting the Sycamore Springs
// schedule covers every DS Elite girl at Sycamore Springs, which is what turns
// a handful of readable schedules into coverage for much of the club.
//
// Prints a summary by default and writes nothing until --write.
//
// Usage:
//   node scripts/parse-school-schedules.mjs           # summary only
//   node scripts/parse-school-schedules.mjs --write   # rebuild the table
//   node scripts/parse-school-schedules.mjs --links   # list the link-only ones
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseSchedule, schoolKey, expandAbbrev, tierForLevel, opponentKey } from "../shared/school-schedule.js";

function loadEnv() {
  let raw = "";
  try { raw = readFileSync(new URL("../.env", import.meta.url), "utf8"); }
  catch { console.error("Missing .env next to package.json."); process.exit(1); }
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const showLinks = args.includes("--links");

const env = loadEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const [{ data: reports }, { data: players }, { data: sources }] = await Promise.all([
  supabase.from("school_team_reports").select("*"),
  supabase.from("players").select("id,first_name,last_name,team_assignment,roster_status,season,offer_status"),
  supabase.from("school_schedule_sources").select("*").eq("status", "ok"),
]);

// Which schools we actually have girls at — the only ones a head-to-head can
// involve.
const ours = new Map(); // schoolKey -> { name, players: [] }
const TERMINAL = ["declined", "not_invited", "opted_out"];
const active = new Map((players || []).filter(p =>
  p.roster_status === "active" && (p.season || "2026-27") === "2026-27" &&
  (p.team_assignment || "").trim() && !TERMINAL.includes(p.offer_status || "")
).map(p => [p.id, p]));
for (const r of reports || []) {
  const p = active.get(r.player_id);
  if (!p || !(r.school || "").trim()) continue;
  const k = schoolKey(r.school);
  if (!ours.has(k)) ours.set(k, { name: r.school.trim(), players: [] });
  ours.get(k).players.push(p);
}

const rows = [];
const linkOnly = [];
let parsedCount = 0, sourceCount = 0;

const addGames = (school, games, reportId) => {
  const key = schoolKey(school);
  for (const g of games) {
    const oppName = g.opponent || null;
    // A middle-school schedule saying "Dripping Springs" means the middle
    // school. Resolving the opponent inside the tier of the schedule it came
    // from is what keeps 7th graders off the varsity board.
    const tier = tierForLevel(g.level)
      || (key.endsWith(" high") ? "high" : key.endsWith(" middle") ? "middle" : null);
    const oppKey = oppName ? opponentKey(oppName, tier) : null;
    rows.push({
      school_key: key,
      school_name: school,
      game_date: g.game_date,
      end_date: g.multi_day_end || null,
      opponent: oppName,
      // An opponent may be written only as an abbreviation in the site column
      // ("@DSMS") when the opponent cell is blank.
      opponent_key: oppKey || (g.venue ? schoolKey(expandAbbrev(g.venue) || "") || null : null),
      note: g.note || null,
      is_game: g.is_game,
      home: g.home,
      venue: g.venue || null,
      times: g.times || [],
      level: g.level || null,
      raw: g.raw || null,
      source_report_id: reportId,
    });
  }
};

for (const r of reports || []) {
  const text = (r.schedule || "").trim();
  if (text.length < 5) continue;
  const { games, links, parsed } = parseSchedule(text, { level: r.team_level });
  if (!parsed) { if (links.length) linkOnly.push({ r, links }); continue; }
  parsedCount++;
  addGames((r.school || "").trim() || "(school not given)", games, r.id);
}

// The links we fetched ourselves. No level: a school-wide schedule off the
// district's own page belongs to every team at that school.
for (const src of sources || []) {
  if (!src.text) continue;
  const { games } = parseSchedule(src.text, { level: null });
  const keep = games.filter(g => g.opponent || (g.times || []).length);
  if (!keep.length) continue;
  sourceCount++;
  addGames(src.school_name, keep, null);
}

// Same school, same date, same opponent, same level from two different parents
// is one game — the unique index would reject the second anyway.
const seen = new Set();
let deduped = rows.filter(r => {
  const k = [r.school_key, r.game_date, r.opponent || "", r.level || ""].join("|");
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

// A school-wide fetch has no level on it, so it doesn't collide with the same
// game pasted by a 7th B parent — and the board showed one fixture four times.
// Where a levelled row already exists for that school, date and opponent, the
// unlevelled copy is the same game with less information.
const levelled = new Set(deduped.filter(r => r.level)
  .map(r => [r.school_key, r.game_date, r.opponent || ""].join("|")));
deduped = deduped.filter(r =>
  r.level || !levelled.has([r.school_key, r.game_date, r.opponent || ""].join("|")));

const schools = new Set(deduped.map(r => r.school_key));
const coveredPlayers = new Set();
for (const k of schools) (ours.get(k)?.players || []).forEach(p => coveredPlayers.add(p.id));

// The payoff: our school playing another school where we also have girls.
const headToHead = deduped.filter(r =>
  r.is_game && r.opponent_key && ours.has(r.opponent_key) && ours.has(r.school_key) &&
  r.opponent_key !== r.school_key);

console.log(`${parsedCount} pasted schedules + ${sourceCount} fetched links → ${deduped.length} dated rows across ${schools.size} schools`);
console.log(`${coveredPlayers.size} of ${active.size} rostered players are at a school we now have dates for`);
const coveredKeys = new Set(deduped.map(r => r.school_key));
const stillStuck = linkOnly.filter(({ r }) => !coveredKeys.has(schoolKey(r.school || "")));
console.log(`${linkOnly.length} answers were a link — ${linkOnly.length - stillStuck.length} of them are now covered by a fetch, ${stillStuck.length} still need a human`);
console.log(`\n${headToHead.length} DS Elite vs DS Elite matchups:`);
for (const g of headToHead.sort((a, b) => a.game_date.localeCompare(b.game_date))) {
  const a = ours.get(g.school_key), b = ours.get(g.opponent_key);
  console.log(`   ${g.game_date}  ${a.name} (${a.players.length}) vs ${b.name} (${b.players.length})` +
    `${g.level ? " · " + g.level : ""}${g.times?.length ? " · " + g.times.join("/") : ""}`);
}

if (showLinks) {
  console.log("\nStill just a link:");
  for (const { r, links } of stillStuck) {
    const p = active.get(r.player_id);
    console.log(`   ${(r.school || "?").padEnd(34)} ${(r.team_level || "").padEnd(9)} ${p ? p.first_name + " " + p.last_name : "?"}`);
    links.forEach(l => console.log(`      ${l.slice(0, 110)}`));
  }
}

if (!write) {
  console.log("\nDRY RUN — school_games not touched. Re-run with --write to rebuild it.");
  process.exit(0);
}

const { error: delErr } = await supabase.from("school_games").delete().gte("id", 0);
if (delErr) { console.error("Clear failed:", delErr.message); process.exit(1); }
for (let i = 0; i < deduped.length; i += 200) {
  const { error } = await supabase.from("school_games").insert(deduped.slice(i, i + 200));
  if (error) { console.error("Insert failed:", error.message); process.exit(1); }
}
console.log(`\nRebuilt school_games — ${deduped.length} rows.`);
