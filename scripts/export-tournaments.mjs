// Every upcoming DS Elite tournament with its teams and coaches, as a workbook
// (Drew, Oct 11 2026). Four tabs:
//   By tournament - one row per tournament: dates, place, our teams, all coaches
//   By team       - one row per team entry: head / assistant / sub, issues
//   Shared        - tournaments two or more of our teams are entered in
//   By coach      - each coach's tournament weekends
// Coaches resolve the same way as scripts/tournament-coverage.mjs: an override
// on the entry wins (even "TBD" - the director cleared that seat), else the
// team's practice_teams head / assistant; placeholders ("TBD") are dropped.
// Includes the in-house tournament (team_events titled "Tournament...").
// Dropped/withdrawn entries and cancelled tournaments are left out.
//   node scripts/export-tournaments.mjs [--all] [--out file.xlsx]   (--all includes past tournaments)

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import { isPlaceholderPerson } from "../shared/dssc-clinics.js";
import { isAustinArea } from "../shared/austin-area.js";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const argv = process.argv.slice(2);
const val = (k) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : null; };
const today = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
const OUT = val("out") || fileURLToPath(new URL("../exports/DS Elite Tournaments + Coaches " + today + ".xlsx", import.meta.url));

const [{ data: asg }, { data: tns }, { data: pts }, { data: reqs }, { data: evs }] = await Promise.all([
  sb.from("tournament_assignments").select("*"),
  sb.from("tournaments").select("*"),
  sb.from("practice_teams").select("team_name, head_coach, assistant_coach, third_coach, level"),
  sb.from("coach_requests").select("coach_name, type, request_date, status").eq("type", "weekend"),
  sb.from("team_events").select("team_name, title, event_date, start_time, location").ilike("title", "Tournament%"),
]);
const tnBy = new Map(tns.filter(t => !t.cancelled && t.start_date && (argv.includes("--all") || (t.end_date || t.start_date) >= today)).map(t => [t.id, t]));
const ptBy = new Map(pts.map(p => [p.team_name, p]));
const n = (s) => String(s || "").trim().toLowerCase().replace(/^coach\s+/, "").replace(/\s+/g, " ");
const real = (s) => { const v = String(s || "").trim(); return v && !isPlaceholderPerson(v) ? v : null; };
const pick = (ov, base) => (String(ov || "").trim() ? real(ov) : real(base));
const dropped = (a) => /drop|withdraw|cancel/i.test(a.status || "");
const teamSort = (a, b) => (parseInt(a) || 99) - (parseInt(b) || 99) || a.localeCompare(b);
const fmtD = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const span = (s, e) => (!e || e === s ? fmtD(s) : fmtD(s) + " - " + fmtD(e));
const wkOf = (iso) => { const d = new Date(iso + "T12:00:00Z"), dow = d.getUTCDay(); const fri = new Date(d); fri.setUTCDate(d.getUTCDate() - ((dow + 2) % 7)); const sun = new Date(fri); sun.setUTCDate(fri.getUTCDate() + 2); return [fri.toISOString().slice(0, 10), sun.toISOString().slice(0, 10)]; };
const offOn = (coach, tn, re) => (reqs || []).some(r => re.test(r.status || "") && n(r.coach_name) === n(coach) && (([f, s]) => f <= (tn.end_date || tn.start_date) && s >= tn.start_date)(wkOf(r.request_date)));

// One entry per team per tournament.
const entries = asg.filter(a => tnBy.has(a.tournament_id) && !dropped(a)).map(a => {
  const tn = tnBy.get(a.tournament_id), pt = ptBy.get(a.team_id) || {};
  return { tn, team: a.team_id, status: a.status || "", division: a.division || "", notes: a.notes || "",
    head: pick(a.head_override, pt.head_coach), asst: pick(a.asst_override, pt.assistant_coach), sub: real(a.sub_coach),
    headOv: !!String(a.head_override || "").trim(), asstOv: !!String(a.asst_override || "").trim(), local: isAustinArea(tn) };
});
// The in-house tournament lives in team_events, one row per match / work shift.
const inhouse = new Map();
for (const e of evs || []) if (argv.includes("--all") || e.event_date >= today) {
  if (!inhouse.has(e.event_date)) inhouse.set(e.event_date, new Set());
  inhouse.get(e.event_date).add(e.team_name);
}
for (const [date, teams] of inhouse) {
  const tn = { id: "inhouse-" + date, name: "DS Elite In-House Tournament", start_date: date, end_date: date, location: "Dripping Springs, TX", venue: "DSSC Warehouse", inhouse: true };
  for (const team of teams) { const pt = ptBy.get(team) || {}; entries.push({ tn, team, status: "club event", division: "", notes: "", head: real(pt.head_coach), asst: real(pt.assistant_coach), sub: null, headOv: false, asstOv: false, local: true }); }
}

// Issues: weekend off, and the same coach at a different tournament that overlaps.
const coachesOf = (e) => [e.head, e.asst, e.sub].filter(Boolean);
for (const e of entries) {
  const issues = [];
  for (const who of coachesOf(e)) {
    if (offOn(who, e.tn, /approv/i)) issues.push(`${who} has the weekend off (approved)`);
    else if (offOn(who, e.tn, /pend/i)) issues.push(`${who} asked for the weekend off (pending)`);
    const clash = entries.find(o => o !== e && o.tn.id !== e.tn.id && o.tn.start_date <= (e.tn.end_date || e.tn.start_date) && (o.tn.end_date || o.tn.start_date) >= e.tn.start_date && coachesOf(o).some(x => n(x) === n(who)));
    if (clash) issues.push(`${who} is also at ${clash.tn.name.trim()} with ${clash.team}`);
  }
  const staff = coachesOf(e).length;
  if (staff < 2) issues.unshift(staff ? "only 1 coach" : "no coaches");
  e.issues = issues;
}

// Tournaments in date order, with their entries.
const byTn = new Map();
for (const e of entries) { if (!byTn.has(e.tn.id)) byTn.set(e.tn.id, { tn: e.tn, list: [] }); byTn.get(e.tn.id).list.push(e); }
const tournaments = [...byTn.values()].sort((a, b) => a.tn.start_date.localeCompare(b.tn.start_date) || a.tn.name.localeCompare(b.tn.name));
for (const t of tournaments) t.list.sort((a, b) => teamSort(a.team, b.team));
const where = (tn) => [tn.venue && !String(tn.location || "").toLowerCase().includes(String(tn.venue).toLowerCase()) ? tn.venue : "", tn.location || ""].filter(Boolean).join(", ");
const uniq = (arr) => [...new Map(arr.filter(Boolean).map(x => [n(x), x])).values()];

const sheet1 = tournaments.map(({ tn, list }) => ({
  "Start": tn.start_date, "End": tn.end_date || tn.start_date, "Dates": span(tn.start_date, tn.end_date),
  "Tournament": tn.name.trim(), "Where": where(tn), "Local / travel": list[0].local ? "Local" : "Travel",
  "Qualifier": tn.is_qualifier ? (tn.qualifier_type || "Yes") : "",
  "# of our teams": list.length,
  "Our teams": list.map(e => e.team + (e.status && e.status !== "registered" ? " (" + e.status + ")" : "")).join(", "),
  "Coaches": uniq(list.flatMap(coachesOf)).join(", "),
  "Teams short a coach": list.filter(e => coachesOf(e).length < 2).map(e => e.team).join(", "),
}));
const sheet2 = tournaments.flatMap(({ tn, list }) => list.map(e => ({
  "Team": e.team, "Start": tn.start_date, "Dates": span(tn.start_date, tn.end_date), "Tournament": tn.name.trim(), "Where": where(tn),
  "Local / travel": e.local ? "Local" : "Travel", "Status": e.status, "Division": e.division,
  "Head coach": (e.head || "") + (e.headOv ? " (override)" : ""), "Assistant coach": (e.asst || "") + (e.asstOv ? " (override)" : ""), "Sub coach": e.sub || "",
  "# coaches": coachesOf(e).length,
  "Other DS Elite teams there": list.filter(o => o !== e).map(o => o.team).join(", "),
  "Issues": e.issues.join("; "),
}))).sort((a, b) => teamSort(a.Team, b.Team) || a.Start.localeCompare(b.Start));
const sheet3 = tournaments.filter(t => t.list.length >= 2).map(({ tn, list }) => {
  const cnt = {}; for (const e of list) for (const c of coachesOf(e)) cnt[n(c)] = (cnt[n(c)] || 0) + 1;
  return {
    "Start": tn.start_date, "Dates": span(tn.start_date, tn.end_date), "Tournament": tn.name.trim(), "Where": where(tn),
    "Local / travel": list[0].local ? "Local" : "Travel", "# of our teams": list.length,
    "Teams and coaches": list.map(e => `${e.team}: ${coachesOf(e).join(", ") || "no coaches"}`).join("\n"),
    "Coaches on 2+ teams here": uniq(list.flatMap(coachesOf)).filter(c => cnt[n(c)] > 1).join(", "),
    "All coaches": uniq(list.flatMap(coachesOf)).join(", "),
  };
});
const byCoach = new Map();
for (const e of entries) for (const [role, who] of [["Head", e.head], ["Assistant", e.asst], ["Sub", e.sub]]) if (who) {
  const k = n(who); if (!byCoach.has(k)) byCoach.set(k, { name: who, rows: [] });
  byCoach.get(k).rows.push({ e, role });
}
const sheet4 = [...byCoach.values()].sort((a, b) => a.name.localeCompare(b.name)).flatMap(c => c.rows
  .sort((x, y) => x.e.tn.start_date.localeCompare(y.e.tn.start_date))
  .map((r, i) => ({ "Coach": i === 0 ? c.name : "", "Weekends": i === 0 ? new Set(c.rows.map(x => x.e.tn.start_date)).size : "", "Start": r.e.tn.start_date, "Dates": span(r.e.tn.start_date, r.e.tn.end_date),
    "Tournament": r.e.tn.name.trim(), "Where": where(r.e.tn), "Local / travel": r.e.local ? "Local" : "Travel", "Team": r.e.team, "Role": r.role, "Status": r.e.status })));

const wb = XLSX.utils.book_new();
const add = (name, rows, widths) => { const ws = XLSX.utils.json_to_sheet(rows); ws["!cols"] = widths.map(w => ({ wch: w })); if (rows.length) ws["!autofilter"] = { ref: ws["!ref"] }; ws["!freeze"] = { xSplit: 0, ySplit: 1 }; XLSX.utils.book_append_sheet(wb, ws, name); };
add("By tournament", sheet1, [11, 11, 26, 40, 34, 9, 10, 8, 60, 70, 24]);
add("By team", sheet2, [12, 11, 26, 40, 34, 9, 11, 10, 24, 24, 18, 6, 34, 60]);
add("Shared", sheet3, [11, 26, 40, 34, 9, 8, 70, 30, 70]);
add("By coach", sheet4, [22, 9, 11, 26, 40, 34, 9, 12, 10, 11]);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

const travel = tournaments.filter(t => !t.list[0].local).length;
console.log(`${tournaments.length} tournaments (${travel} travel, ${tournaments.length - travel} local), ${entries.length} team entries, ${sheet3.length} shared by 2+ teams, ${byCoach.size} coaches`);
console.log(`${entries.filter(e => coachesOf(e).length < 2).length} entries short a coach, ${entries.filter(e => e.issues.some(i => /also at|weekend off/.test(i))).length} with a conflict`);
console.log("Wrote " + OUT);
