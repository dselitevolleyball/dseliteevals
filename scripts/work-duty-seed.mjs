// Deal 50 generic work assignments (#1-#50) for every team that has none yet,
// fair and balanced (shared/work-duty.js). Skips event teams.
//   node scripts/work-duty-seed.mjs            # dry run
//   node scripts/work-duty-seed.mjs --write

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { dealAssignments, tally } from "../shared/work-duty.js";
import { isEventTeam } from "../shared/event-teams.js";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const write = process.argv.includes("--write");
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [{ data: players }, { data: teams }, { data: have }] = await Promise.all([
  sb.from("players").select("id, first_name, team_assignment, offer_status").eq("season", "2026-27").neq("team_assignment", ""),
  sb.from("practice_teams").select("team_name, practices_per_week"),
  sb.from("work_duty_matches").select("team_name"),
]);
const done = new Set((have || []).map(r => r.team_name));
const teamBy = new Map(teams.map(t => [t.team_name, t]));
const byTeam = new Map();
for (const p of players) { if (["declined", "not_invited", "opted_out"].includes(p.offer_status || "")) continue; if (!byTeam.has(p.team_assignment)) byTeam.set(p.team_assignment, []); byTeam.get(p.team_assignment).push(p); }
for (const [team, roster] of [...byTeam.entries()].sort((a, b) => (parseInt(a[0]) || 99) - (parseInt(b[0]) || 99) || a[0].localeCompare(b[0]))) {
  if (isEventTeam(teamBy.get(team))) { console.log(`skip ${team} (event team)`); continue; }
  if (done.has(team)) { console.log(`skip ${team} (already has assignments)`); continue; }
  const dealt = dealAssignments(roster, 50, { sets: 3, computer: false });
  const t = tally(dealt.map(a => ({ assignments: a })));
  const span = (k) => { const v = roster.map(p => (t[String(p.id)] || {})[k] || 0); return `${Math.min(...v)}-${Math.max(...v)}`; };
  console.log(`${team.padEnd(12)} ${String(roster.length).padStart(2)} players | book ${span("book")} libero ${span("libero")} line ${span("line")} flip ${span("flip")} total ${span("total")}`);
  if (write) {
    const { error } = await sb.from("work_duty_matches").insert(dealt.map((a, i) => ({ team_name: team, seq: i + 1, assignments: a, updated_by: "Drew Rose (seed)" })));
    if (error) console.log("  ERROR " + error.message);
  }
}
if (!write) console.log("\nDRY RUN - add --write");
