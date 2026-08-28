// Rebuild school_games from what families pasted into the school-team form.
//
// Wholesale rebuild, not a merge: the parse is a pure function of the text, so
// the way to fix a wrong game is to fix the family's answer (or the parser) and
// run this again. Merging would leave yesterday's misreadings behind forever.
//
// Games are keyed to the SCHOOL. One parent pasting the Sycamore Springs
// schedule covers every DS Elite girl at Sycamore Springs, which is what turns
// 19 readable schedules into coverage for a useful share of the club.
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

const [{ data: reports }, { data: players }] = await Promise.all([
  supabase.from("school_team_reports").select("*"),
  supabase.from("players").select("id,first_name,last_name,team_assignment,roster_status,season,offer_status"),
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
let parsedCount = 0;
for (const r of reports || []) {
  const text = (r.schedule || "").trim();
  if (text.length < 5) continue;
  const { games, links, parsed } = parseSchedule(text, { level: r.team_level });
  if (!parsed) { if (links.length) linkOnly.push({ r, links }); continue; }
  parsedCount++;
  const school = (r.school || "").trim() || "(school not given)";
  for (const g of games) {
    // An opponent may be written as an abbreviation in the venue column
    // ("@DSMS") when the opponent cell says the same thing in words.
    const oppName = g.opponent || null;
    // A middle-school schedule saying "Dripping Springs" means the middle
    // school. Resolving the opponent inside the tier of the schedule it came
    // from is what keeps 7th graders off the varsity board.
    const tier = tierForLevel(g.level) || (schoolKey(school).endsWith(" high") ? "high" : schoolKey(school).endsWith(" middle") ? "middle" : null);
    const oppKey = oppName ? opponentKey(oppName, tier) : null;
    rows.push({
      school_key: schoolKey(school),
      school_name: school,
      game_date: g.game_date,
      end_date: g.multi_day_end || null,
      opponent: oppName,
      opponent_key: oppKey || (g.venue ? schoolKey(expandAbbrev(g.venue) || "") || null : null),
      note: g.note || null,
      is_game: g.is_game,
      home: g.home,
      venue: g.venue || null,
      times: g.times || [],
      level: g.level || null,
      raw: g.raw || null,
      source_report_id: r.id,
    });
  }
}

// Same school, same date, same opponent, same level from two different parents
// is one game — the unique index would reject the second anyway.
const seen = new Set();
const deduped = rows.filter(r => {
  const k = [r.school_key, r.game_date, r.opponent || "", r.level || ""].join("|");
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const schools = new Set(deduped.map(r => r.school_key));
const coveredPlayers = new Set();
for (const k of schools) (ours.get(k)?.players || []).forEach(p => coveredPlayers.add(p.id));

// The payoff: our school playing another school where we also have girls.
const headToHead = deduped.filter(r =>
  r.is_game && r.opponent_key && ours.has(r.opponent_key) && ours.has(r.school_key) &&
  r.opponent_key !== r.school_key);

console.log(`${parsedCount} schedules parsed → ${deduped.length} dated rows across ${schools.size} schools`);
console.log(`${coveredPlayers.size} of ${active.size} rostered players are at a school we now have dates for`);
console.log(`${linkOnly.length} schedules are a link only — nobody can parse a PDF on the district's asset host`);
console.log(`\n${headToHead.length} DS Elite vs DS Elite matchups:`);
for (const g of headToHead.sort((a, b) => a.game_date.localeCompare(b.game_date))) {
  const a = ours.get(g.school_key), b = ours.get(g.opponent_key);
  console.log(`   ${g.game_date}  ${a.name} (${a.players.length}) vs ${b.name} (${b.players.length})` +
    `${g.level ? " · " + g.level : ""}${g.times?.length ? " · " + g.times.join("/") : ""}`);
}

if (showLinks) {
  console.log("\nStill just a link:");
  for (const { r, links } of linkOnly) {
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
