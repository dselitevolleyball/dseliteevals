// Pull everything Anna needs, in one shot, as JSON.
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
// The app's own key function — normalising school names a second way here is
// how "Dripping Springs High School" and "dripping springs high" become two
// different schools and every matchup disappears.
import { schoolKey } from "./shared/school-schedule.js";
const env = {};
for (const l of readFileSync("C:/Users/drewr/DS Elite Evals/dseliteevals/.env","utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g,"");
}
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const TERMINAL = ["declined","not_invited","opted_out"];

const [pl, pt, ta, tn, sr, sg] = await Promise.all([
  sb.from("players").select("id,first_name,last_name,team_assignment,jersey_number,usav_div,roster_status,season,offer_status,reg_position"),
  sb.from("practice_teams").select("team_name,head_coach,assistant_coach,third_coach,age_div,level"),
  sb.from("tournament_assignments").select("team_id,tournament_id,status,asst_override,head_override"),
  sb.from("tournaments").select("id,name,start_date,end_date,location,cancelled"),
  sb.from("school_team_reports").select("player_id,school,grade,team_level,made_team"),
  sb.from("school_games").select("*"),
]);
for (const [n,r] of [["players",pl],["teams",pt],["tassign",ta],["tourn",tn],["school",sr],["games",sg]])
  if (r.error) { console.error(n, r.error.message); process.exit(1); }

const roster = pl.data.filter(p => p.roster_status==="active" && (p.season||"2026-27")==="2026-27"
  && String(p.team_assignment||"").trim() && !TERMINAL.includes(p.offer_status||""));
const tById = new Map(tn.data.map(t => [t.id, t]));
const schoolBy = new Map(sr.data.map(r => [r.player_id, r]));

// A. Teams
const teams = pt.data
  .filter(t => roster.some(p => p.team_assignment === t.team_name))
  .sort((a,b) => a.team_name.localeCompare(b.team_name))
  .map(t => ({
    team: t.team_name, level: t.level, div: t.age_div,
    coaches: [t.head_coach, t.assistant_coach, t.third_coach].filter(Boolean)
      .filter(c => !/assistant coach$|^tbd$|^tba$/i.test(String(c).trim())),
    head: t.head_coach || null,
    players: roster.filter(p => p.team_assignment === t.team_name)
      .sort((a,b) => (a.jersey_number ?? 999) - (b.jersey_number ?? 999))
      .map(p => ({ n: p.jersey_number, name: p.first_name + " " + p.last_name, pos: p.reg_position || null })),
    tournaments: ta.data.filter(a => a.team_id === t.team_name)
      .map(a => tById.get(a.tournament_id)).filter(t2 => t2 && !t2.cancelled)
      .sort((a,b) => String(a.start_date).localeCompare(String(b.start_date)))
      .map(t2 => ({ name: t2.name.trim(), start: t2.start_date, end: t2.end_date, loc: t2.location })),
  }));

// B. School rosters — by school, then by the school team she's on.
const schools = new Map();
for (const p of roster) {
  const r = schoolBy.get(p.id);
  if (!r || r.made_team === false || !String(r.school||"").trim()) continue;
  const key = String(r.school).trim();
  if (!schools.has(key)) schools.set(key, new Map());
  const lvl = String(r.team_level||"Not given").trim() || "Not given";
  if (!schools.get(key).has(lvl)) schools.get(key).set(lvl, []);
  schools.get(key).get(lvl).push({
    name: p.first_name + " " + p.last_name, club: p.team_assignment,
    grade: r.grade || null, n: p.jersey_number,
  });
}
const schoolList = [...schools.entries()]
  .map(([school, lvls]) => ({
    school,
    total: [...lvls.values()].reduce((n,a) => n + a.length, 0),
    levels: [...lvls.entries()].sort((a,b) => a[0].localeCompare(b[0]))
      .map(([level, players]) => ({ level, players: players.sort((a,b) => a.name.localeCompare(b.name)) })),
  }))
  .sort((a,b) => b.total - a.total);

// C. Game day — a school we have girls at, playing another school we have girls at.
const byKey = new Map();
for (const p of roster) {
  const r = schoolBy.get(p.id);
  if (!r || r.made_team === false || !String(r.school||"").trim()) continue;
  const k = schoolKey(r.school);
  if (!byKey.has(k)) byKey.set(k, { name: String(r.school).trim(), players: [] });
  byKey.get(k).players.push({ name: p.first_name+" "+p.last_name, club: p.team_assignment, level: r.team_level||null });
}
const norm = (s) => schoolKey(s);
const seen = new Set();
const matchups = [];
for (const g of sg.data) {
  if (g.is_game === false) continue;
  const a = byKey.get(norm(g.school_key)) || byKey.get(norm(g.school_name));
  const b = g.opponent_key ? (byKey.get(norm(g.opponent_key)) || byKey.get(norm(g.opponent))) : null;
  if (!a || !b || a.name === b.name) continue;
  // Only the girls whose school-team level matches this fixture, when we know it.
  const side = (grp) => grp.players.filter(x => !g.level || !x.level || x.level === g.level);
  const ours = side(a), theirs = side(b);
  if (!ours.length || !theirs.length) continue;
  const key = [g.game_date, [a.name,b.name].sort().join("|"), g.level||""].join("::");
  if (seen.has(key)) continue;
  seen.add(key);
  matchups.push({
    date: g.game_date, level: g.level || null, venue: g.venue || null,
    home: a.name, away: b.name, ours, theirs, total: ours.length + theirs.length,
  });
}
// Only games still to come — a game-day post about last Thursday is no use.
const TODAY = process.argv[3] || new Date().toISOString().slice(0,10);
const upcoming = matchups.filter(m => String(m.date) >= TODAY);
upcoming.sort((x,y) => y.total - x.total || String(x.date).localeCompare(String(y.date)));
const top12 = upcoming.slice(0, 12).sort((x,y) => String(x.date).localeCompare(String(y.date)));

writeFileSync(process.argv[2], JSON.stringify({ teams, schoolList, matchups: top12, allUpcoming: upcoming.length }, null, 2));
console.log(`teams ${teams.length} · schools ${schoolList.length} · upcoming matchups ${upcoming.length}, taking 12`);
console.log("top matchups:");
top12.forEach(m => console.log(`  ${m.date} ${String(m.level||"—").padEnd(9)} ${m.home} vs ${m.away}  (${m.ours.length} + ${m.theirs.length} = ${m.total})`));
