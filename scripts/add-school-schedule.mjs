// Store a schedule somebody handed us by hand.
//
// For the schools whose site is a PDF, a JS-rendered page, or four separate
// links behind a menu — where fetch-school-schedules.mjs can't help and a human
// has to copy the thing out. What they paste goes in as a schedule SOURCE, not
// as a family's answer: it's school-wide, and it shouldn't overwrite what a
// parent wrote in their own form.
//
// Input is one game per line, tab separated, in the order the parser reads:
//   DATE <tab> OPPONENT <tab> LOCATION <tab> TIME
// A copy out of a spreadsheet is already in that shape.
//
// Usage:
//   node scripts/add-school-schedule.mjs --school "Westlake High School" --file sched.txt
//   node scripts/add-school-schedule.mjs --school "…" --file … --level Flex
//   node scripts/add-school-schedule.mjs --school "…" --file … --write
//
// A --level tags every row, for when the paste is one team's schedule. Leave it
// off for a school-wide one.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseSchedule, schoolKey } from "../shared/school-schedule.js";

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
const arg = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const write = args.includes("--write");
const school = arg("school");
const file = arg("file");
const level = arg("level");
if (!school || !file) {
  console.error('Need --school "Name" and --file path.txt');
  process.exit(1);
}

const text = readFileSync(file, "utf8");
const { games } = parseSchedule(text, { level: level || null });
const real = games.filter(g => g.is_game);

console.log(`${school}${level ? " · " + level : ""} — ${real.length} games read from ${file}\n`);
for (const g of real) {
  console.log(`   ${g.game_date}  ${(g.opponent || "?").padEnd(30).slice(0, 30)} ` +
    `${g.home === true ? "home" : g.home === false ? "away" : g.venue ? "@" + g.venue : "    "}  ${(g.times || []).join("/")}`);
}
if (games.length !== real.length) {
  console.log(`\n(${games.length - real.length} rows read as something other than a game — meetings, byes, pictures)`);
}

if (!write) { console.log("\nDRY RUN — nothing stored. Re-run with --write."); process.exit(0); }

const env = loadEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// A synthetic url, because the table is keyed on one and this didn't come from
// a page. Re-running with the same school and level replaces it rather than
// stacking a second copy.
const url = `paste://${schoolKey(school).replace(/\s+/g, "-")}${level ? "-" + level.toLowerCase().replace(/\s+/g, "-") : ""}`;
const { error } = await supabase.from("school_schedule_sources").upsert({
  school_key: schoolKey(school), school_name: school,
  url, fetch_url: null, kind: "paste",
  status: real.length ? "ok" : "no-dates", http_status: null, level: level || null,
  text: text.slice(0, 100000), games_found: real.length,
  note: level ? "pasted by hand · " + level : "pasted by hand",
  fetched_at: new Date().toISOString(),
}, { onConflict: "url" });
if (error) { console.error("Store failed:", error.message); process.exit(1); }

console.log(`\nStored as ${url}. Now run: node scripts/parse-school-schedules.mjs --write`);
