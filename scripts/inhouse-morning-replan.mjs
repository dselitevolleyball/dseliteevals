// In-house tournament (Sun Nov 29, 2026) - Drew, Oct 10: no Rise teams, and
// 2-3 matches per team at most. The 2pm session (14s-16s) is untouched; the
// morning is re-planned for the 7 teams left on Courts 1 and 2:
//   13 Diamond / Emerald / Ruby / Sapphire  - round robin (3 matches each)
//   11 Diamond / 12 Diamond / 12 Ruby       - round robin (2 matches each)
// 9 matches in 5 one-hour slots (10am-2pm starts; the 14s-16s start at 4pm). Every match is worked by a
// team that's free that hour; the search keeps anyone from playing 3 in a row
// and spreads the work evenly.
//   node scripts/inhouse-morning-replan.mjs            # dry run
//   node scripts/inhouse-morning-replan.mjs --write

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const write = process.argv.includes("--write");
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DATE = "2026-11-29";
const HOURS = ["10:00", "11:00", "12:00", "13:00"];   // 10am-1pm starts (Drew, Oct 10)
const COURTS = ["Court 1", "Court 2"];
// 9 matches don't fit 4 hours x 2 courts, so one 13s match is dropped: National 13 Diamond
// vs Regional 13 Sapphire (both still play 2; Emerald and Ruby play 3).
const DROP = ["13 Diamond", "13 Sapphire"];
const T13 = ["13 Diamond", "13 Emerald", "13 Ruby", "13 Sapphire"];
const YNG = ["11 Diamond", "12 Diamond", "12 Ruby"];
const ALL = [...YNG, ...T13];
const matches = [];
for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (!(T13[i] === DROP[0] && T13[j] === DROP[1])) matches.push([T13[i], T13[j]]);
for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) matches.push([YNG[i], YNG[j]]);

// Every way to put the 9 matches into 5 hours x 2 courts (no team twice an hour).
let best = null;
const slots = HOURS.map(() => []);
const score = () => {
  const plays = (t, h) => slots[h].some(m => m.includes(t));
  let cost = 0;
  for (const t of ALL) { let run = 0; for (let h = 0; h < HOURS.length; h++) { run = plays(t, h) ? run + 1 : 0; if (run >= 3) cost += 100; if (run === 2) cost += 2; } }
  // Work crews: a free team per match, fewest works first; same-age crew preferred.
  const works = Object.fromEntries(ALL.map(t => [t, 0])); const crew = [];
  for (let h = 0; h < HOURS.length; h++) {
    const busy = new Set(slots[h].flat()); const used = new Set();
    for (const m of slots[h]) {
      const young = YNG.includes(m[0]);
      const free = ALL.filter(t => !busy.has(t) && !used.has(t)).sort((a, b) => works[a] - works[b] || ((YNG.includes(a) === young) ? -1 : 1) - ((YNG.includes(b) === young) ? -1 : 1));
      if (!free.length) return null;
      used.add(free[0]); works[free[0]]++; crew.push({ h, m, w: free[0] });
    }
  }
  const v = Object.values(works); cost += (Math.max(...v) - Math.min(...v)) * 5;
  // finish early: an empty last hour is worth a lot
  if (!slots[HOURS.length - 1].length) cost -= 20;
  return { cost, crew, works };
};
const place = (i) => {
  if (i === matches.length) { const s = score(); if (s && (!best || s.cost < best.cost)) best = { ...s, plan: slots.map(x => x.slice()) }; return; }
  const m = matches[i];
  for (let h = 0; h < HOURS.length; h++) {
    if (slots[h].length >= COURTS.length || slots[h].some(x => x.includes(m[0]) || x.includes(m[1]))) continue;
    slots[h].push(m); place(i + 1); slots[h].pop();
  }
};
place(0);

const rows = [];
const add = (team, title, h, court, desc) => rows.push({ team_name: team, title, event_date: DATE, start_time: HOURS[h], duration_min: 60, location: court, description: desc });
for (let h = 0; h < HOURS.length; h++) {
  const line = [];
  best.plan[h].forEach((m, ci) => {
    const court = COURTS[ci], [a, b] = m, w = best.crew.find(c => c.h === h && c.m === m).w;
    add(a, "Tournament — vs " + b, h, court, `DS Elite in-house tournament. ${a} vs ${b} on ${court}.`);
    add(b, "Tournament — vs " + a, h, court, `DS Elite in-house tournament. ${b} vs ${a} on ${court}.`);
    add(w, "Tournament — WORK " + court, h, court, `Officiating duty: ${a} vs ${b} on ${court}. Ref, score, and lines.`);
    line.push(`${court}: ${a} v ${b} [work ${w}]`);
  });
  console.log(`${HOURS[h]}  ${line.join("   |   ") || "(free)"}`);
}
const cnt = {}; for (const r of rows) { const k = r.team_name; cnt[k] = cnt[k] || { play: 0, work: 0 }; /WORK/.test(r.title) ? cnt[k].work++ : cnt[k].play++; }
console.log("\n" + Object.entries(cnt).sort().map(([t, c]) => `${t}: ${c.play} matches, ${c.work} work`).join("\n"));

const { data: old } = await sb.from("team_events").select("id").eq("event_date", DATE).ilike("title", "Tournament%").lt("start_time", "16:00");
console.log(`\nReplaces ${old.length} morning rows with ${rows.length}. Afternoon untouched.`);
if (!write) { console.log("DRY RUN"); process.exit(0); }
const { error: e1 } = await sb.from("team_events").delete().in("id", old.map(r => r.id)); if (e1) throw e1;
const { error: e2 } = await sb.from("team_events").insert(rows); if (e2) throw e2;
console.log("written");
