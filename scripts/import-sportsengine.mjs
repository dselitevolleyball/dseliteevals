// Import SportsEngine's member export: every player it matches is marked
// SportsEngine-registered (with her SportsEngine ID and profile status), and
// the roster players it does NOT contain are listed — they are the chase list.
// The Tracker tab's upload button does the same thing.
//
//   node scripts/import-sportsengine.mjs "C:/Users/drewr/Downloads/ds_elite_volleyball_20260925125536.csv"
//   node scripts/import-sportsengine.mjs file.csv --dry
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { createClient } from "@supabase/supabase-js";
import { parseSportsEngineRows, matchMembersToPlayers, playerPatchFor } from "../shared/sportsengine.js";
import { PLAYER_MATCH_COLUMNS } from "../shared/name-match.js";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith("--"));
const dry = args.includes("--dry");
if (!file) { console.error("Need the CSV path."); process.exit(1); }

const rows = Papa.parse(readFileSync(file, "utf8"), { header: true, skipEmptyLines: true }).data;
const members = parseSportsEngineRows(rows);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: players } = await sb.from("players").select(PLAYER_MATCH_COLUMNS + ", sportsengine_registered");
const { matched, unmatched } = matchMembersToPlayers(members, players || []);

console.log(`${members.length} SportsEngine profiles · ${matched} matched to players · ${unmatched.length} not players (coaches/parents/unknown)`);
const iffy = members.filter(m => m.player_id && m.match_note);
if (iffy.length) { console.log(`\nMatched with a note (${iffy.length}):`); iffy.forEach(m => console.log("  " + m.name + " — " + m.match_note)); }
console.log(`\nNot matched to a player (${unmatched.length}):`);
unmatched.forEach(m => console.log(`  ${m.name.padEnd(28)} ${m.email || ""}  — ${m.match_note}`));

const matchedIds = new Set(members.filter(m => m.player_id).map(m => m.player_id));
const live = (players || []).filter(p => p.team_assignment && (p.roster_status || "active") === "active" && !["declined", "not_invited", "opted_out"].includes(p.offer_status || ""));
const missing = live.filter(p => !matchedIds.has(p.id)).sort((a, b) => a.team_assignment.localeCompare(b.team_assignment) || a.last_name.localeCompare(b.last_name));
console.log(`\nRostered players NOT in the export (${missing.length}):`);
let t = null;
for (const p of missing) { if (p.team_assignment !== t) { t = p.team_assignment; console.log("  " + t); } console.log(`    ${p.first_name} ${p.last_name}${p.sportsengine_registered ? "  (box was ticked by hand)" : ""}`); }

if (dry) { console.log("\nDRY RUN — nothing written."); process.exit(0); }
const stamp = new Date().toISOString();
let n = 0;
for (const m of members) {
  if (!m.player_id) continue;
  const { error } = await sb.from("players").update(playerPatchFor(m, stamp)).eq("id", m.player_id);
  if (error) console.error("update " + m.name + ": " + error.message); else n++;
}
console.log(`\nMarked ${n} players SportsEngine-registered.`);
