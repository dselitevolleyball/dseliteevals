// Which upcoming DS Elite tournament entries are short of coaches?
//
// For every non-dropped assignment on a tournament that hasn't ended:
//   staff = head (head_override or team head) + assistant (asst_override or
//           team assistant) + sub_coach, minus placeholders ("TBD", "15-2
//           Assistant Coach"), minus anyone with an approved weekend-off request
//           that weekend, minus anyone already on a DIFFERENT tournament with
//           another team that overlaps (double-booked; listed, not removed —
//           the first team alphabetically keeps her).
//   short  = fewer than 2 coaches. Pending weekend-off requests are flagged.
// Austin-area tournaments are listed too (same rules), marked "local".
//
//   node scripts/tournament-coverage.mjs [--all]   (--all lists covered ones too)

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { isPlaceholderPerson } from "../shared/dssc-clinics.js";
import { isAustinArea } from "../shared/austin-area.js";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const today = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);

const [{ data: asg }, { data: tns }, { data: pts }, { data: reqs }] = await Promise.all([
  sb.from("tournament_assignments").select("*"),
  sb.from("tournaments").select("id, name, start_date, end_date, location, cancelled").gte("end_date", today),
  sb.from("practice_teams").select("team_name, head_coach, assistant_coach"),
  sb.from("coach_requests").select("coach_name, type, request_date, status").eq("type", "weekend"),
]);
const tnBy = new Map(tns.filter(t => !t.cancelled).map(t => [t.id, t]));
const ptBy = new Map(pts.map(p => [p.team_name, p]));
const n = (s) => String(s || "").trim().toLowerCase().replace(/^coach\s+/, "").replace(/\s+/g, " ");
const real = (s) => { const v = String(s || "").trim(); return v && !isPlaceholderPerson(v) ? v : null; };
const dropped = (a) => /drop|withdraw|cancel/i.test(a.status || "");

// Fri-Sun window around a weekend request date.
const wkOf = (iso) => { const d = new Date(iso + "T12:00:00Z"), dow = d.getUTCDay(); const fri = new Date(d); fri.setUTCDate(d.getUTCDate() - ((dow + 2) % 7)); const sun = new Date(fri); sun.setUTCDate(fri.getUTCDate() + 2); return [fri.toISOString().slice(0, 10), sun.toISOString().slice(0, 10)]; };
const offOn = (coach, tn, statusRe) => reqs.some(r => statusRe.test(r.status || "") && n(r.coach_name) === n(coach) && (([f, s]) => f <= tn.end_date && s >= tn.start_date)(wkOf(r.request_date)));

const rows = asg.filter(a => tnBy.has(a.tournament_id) && !dropped(a)).map(a => {
  const tn = tnBy.get(a.tournament_id), pt = ptBy.get(a.team_id) || {};
  // An override that is set wins even when it says "TBD": the director cleared that seat.
  const pick = (ov, base) => String(ov || "").trim() ? real(ov) : real(base);
  const head = pick(a.head_override, pt.head_coach), asst = pick(a.asst_override, pt.assistant_coach), sub = real(a.sub_coach);
  return { a, tn, head, asst, sub, raw: { head: String(a.head_override||"").trim() || pt.head_coach, asst: String(a.asst_override||"").trim() || pt.assistant_coach, sub: a.sub_coach } };
});
// Double-booking: same coach, overlapping tournaments, different tournament.
const busy = (coach, row) => rows.filter(o => o !== row && o.tn.id !== row.tn.id && o.tn.start_date <= row.tn.end_date && o.tn.end_date >= row.tn.start_date
  && [o.head, o.asst, o.sub].some(x => x && n(x) === n(coach)));

const out = [];
for (const r of rows) {
  const issues = [], staff = [];
  for (const [role, who] of [["head", r.head], ["asst", r.asst], ["sub", r.sub]]) {
    if (!who) { if (role !== "sub") issues.push(`${role} ${r.raw[role] ? `"${r.raw[role]}"` : "empty"}`); continue; }
    if (offOn(who, r.tn, /approv/i)) { issues.push(`${who} has the weekend off (approved)`); continue; }
    const clash = busy(who, r).filter(o => o.a.team_id !== r.a.team_id);
    if (clash.length && [r.a.team_id, ...clash.map(o => o.a.team_id)].sort()[0] !== r.a.team_id) {
      issues.push(`${who} is at ${clash[0].tn.name.trim()} with ${clash[0].a.team_id}`); continue;
    }
    if (offOn(who, r.tn, /pend/i)) issues.push(`${who} asked for the weekend off (pending)`);
    staff.push(who);
  }
  const short = Math.max(0, 2 - staff.length);
  if (short || process.argv.includes("--all") || issues.some(i => /pending/.test(i))) out.push({ ...r, staff, short, issues });
}
out.sort((x, y) => x.tn.start_date.localeCompare(y.tn.start_date) || x.a.team_id.localeCompare(y.a.team_id));
for (const r of out) console.log([r.tn.start_date, r.tn.end_date, r.tn.name.trim(), r.tn.location || "", isAustinArea(r.tn) ? "local" : "", r.a.team_id, r.a.status || "", `short ${r.short}`, `has: ${r.staff.join(", ") || "-"}`, r.issues.join("; ")].join(" | "));
console.log(`\n${out.filter(r => r.short).length} entries short (${out.filter(r => r.short && !isAustinArea(r.tn)).length} out of town), ${out.reduce((s, r) => s + r.short, 0)} coach slots`);
