// DS Elite practice schedules -> one Excel workbook (Drew, Oct 9 2026).
//   Weekly   - every team's standing schedule per phase (day, time, venue, coaches)
//   By date  - every practice from today to the end of the season, built with the
//              same rules as the Day Schedule (shared/day-schedule.js): one-day
//              moves, cancellations, tournament weekends, subs.
//
//   node scripts/export-practice-schedules.mjs [--from 2026-10-09] [--to 2027-06-15] [--out file.xlsx]

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import { daySchedule, fmtSpan, isPlaceholder } from "../shared/day-schedule.js";
import { isEventTeam } from "../shared/event-teams.js";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const today = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
const FROM = val("from") || today, TO = val("to") || "2027-06-15";
const OUT = val("out") || fileURLToPath(new URL("../exports/DS Elite Practice Schedules " + today + ".xlsx", import.meta.url));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PHASES = [
  ["summer", "Summer", "Sundays Jul 12 - Sep 6, 2026"],
  ["fall1", "Fall 1", "Sundays Sep 13 - Oct 11, 2026"],
  ["fall2", "Fall 2", "Sundays Oct 18 - Nov 15, 2026"],
  ["season", "Regular Season", "Nov 29, 2026 - May 6, 2027"],
  ["postseason", "Post Season", "May 7 - Jun 15, 2027"],
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const teamSort = (a, b) => (parseInt(a) || 99) - (parseInt(b) || 99) || a.localeCompare(b);
const slotStart = (s) => { const m = /^(\d{1,2})/.exec(s || ""); if (!m) return 99; const h = +m[1]; return h === 12 ? 12 : h < 8 ? h + 12 : h; };
const real = (n) => (n && !isPlaceholder(n) ? n : "");

// ── Weekly ────────────────────────────────────────────────────────────────
const [{ data: teams }, { data: assigns }] = await Promise.all([
  sb.from("practice_teams").select("team_name, level, head_coach, assistant_coach, third_coach, practices_per_week"),
  sb.from("practice_assignments").select("team_name, phase, day, slot, court, venue"),
]);
const teamBy = new Map(teams.map(t => [t.team_name, t]));
const weekly = [];
for (const [ph, label, dates] of PHASES) {
  const rows = assigns.filter(a => (a.phase || "fall1") === ph && !isEventTeam(teamBy.get(a.team_name)));
  rows.sort((a, b) => teamSort(a.team_name, b.team_name) || DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || slotStart(a.slot) - slotStart(b.slot));
  for (const a of rows) {
    const t = teamBy.get(a.team_name) || {};
    weekly.push({ Phase: label, "Phase dates": dates, Team: a.team_name, Level: t.level || "", Day: a.day, Time: a.slot,
      Venue: a.venue || "", Court: a.court ?? "", "Head coach": real(t.head_coach), "Assistant coach": real(t.assistant_coach), "3rd coach": real(t.third_coach) });
  }
}

// ── By date ───────────────────────────────────────────────────────────────
const byDate = [];
const dates = [];
for (let d = new Date(FROM + "T12:00:00Z"); d.toISOString().slice(0, 10) <= TO; d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
let done = 0;
for (const date of dates) {
  let day = null;
  for (let tries = 0; !day; tries++) { try { day = await daySchedule(sb, date); } catch (e) { if (tries >= 3) throw e; await new Promise(r => setTimeout(r, 1500)); } }
  done++; if (done % 30 === 0) process.stdout.write(`  ${done}/${dates.length} days\n`);
  if (!day.practiceDay) continue;
  const base = { Date: date, Day: day.weekday, Phase: day.phaseLabel };
  if (day.cancelled) { byDate.push({ ...base, Team: "ALL", Time: "", Status: "Cancelled", Venue: "", Court: "", Coaches: "", Notes: day.cancelled }); continue; }
  for (const t of day.teams) {
    const coaches = t.floor.map(p => p.role === "Sub" ? `${p.name} (sub for ${p.forWhom})` : p.name).join(", ");
    const out = (t.coaches || []).filter(c => c.status !== "on").map(c => c.status === "open" ? `${c.role} coach open` : `${c.name} ${c.status === "away" ? "away " + (c.why || "") : "out" + (c.why ? " (" + c.why + ")" : "")}`.trim());
    byDate.push({ ...base, Team: t.team, Time: t.blocks.map(([s, e]) => fmtSpan(s, e)).join(", "), Status: t.movedFrom ? "Moved (this date only)" : "Practice",
      Venue: t.venue || "", Court: t.court ?? "", Coaches: coaches,
      Notes: [t.movedFrom ? "Usually " + t.movedFrom.map(([s, e]) => fmtSpan(s, e)).join(", ") : "", ...out, t.combined ? "Combined with " + t.combined : ""].filter(Boolean).join("; ") });
  }
  for (const o of day.offTeams) byDate.push({ ...base, Team: o.team, Time: "", Status: /^At /.test(o.why) ? "No practice - tournament" : "Cancelled", Venue: "", Court: "", Coaches: "", Notes: o.why });
}
byDate.sort((a, b) => a.Date.localeCompare(b.Date) || teamSort(a.Team, b.Team));

// ── Write ─────────────────────────────────────────────────────────────────
const sheet = (rows, widths) => { const ws = XLSX.utils.json_to_sheet(rows); ws["!cols"] = widths.map(w => ({ wch: w })); ws["!autofilter"] = { ref: ws["!ref"] }; ws["!freeze"] = { xSplit: 0, ySplit: 1 }; return ws; };
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, sheet(byDate, [11, 5, 15, 12, 14, 22, 18, 6, 46, 60]), "By date");
XLSX.utils.book_append_sheet(wb, sheet(weekly, [15, 30, 12, 10, 5, 9, 18, 6, 22, 22, 18]), "Weekly");
mkdirSync(new URL("../exports/", import.meta.url), { recursive: true });
writeFileSync(OUT, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
console.log(`Wrote ${OUT}\n  By date: ${byDate.length} rows (${FROM} to ${TO})\n  Weekly:  ${weekly.length} rows`);
