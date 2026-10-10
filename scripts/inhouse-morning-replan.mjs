// In-house tournament (Sun Nov 29, 2026) - Drew, Oct 10: leave the Rise teams
// out. The 2pm session (14s-16s) is untouched; the morning is re-planned for
// the 7 teams left on Courts 1 and 2:
//   13 Diamond / Emerald / Ruby / Sapphire  - round robin (3 matches each)
//   11 Diamond / 12 Diamond / 12 Ruby       - double round robin (4 each)
// One match of each group per hour, 8am-1pm starts (60 min). The 13s match is
// worked by the free younger team, the younger match by a free 13s team
// (spread evenly). Picks the ordering with the fewest 3-in-a-row runs.
//   node scripts/inhouse-morning-replan.mjs            # dry run
//   node scripts/inhouse-morning-replan.mjs --write

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const write = process.argv.includes("--write");
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DATE = "2026-11-29";
const HOURS = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00"];
const T13 = ["13 Diamond", "13 Emerald", "13 Ruby", "13 Sapphire"];
const YNG = ["11 Diamond", "12 Diamond", "12 Ruby"];
const rr13 = []; for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) rr13.push([T13[i], T13[j]]);
const rrY = [[YNG[0], YNG[1]], [YNG[0], YNG[2]], [YNG[1], YNG[2]]];
const perms = (a) => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]));

let best = null;
for (const p13 of perms(rr13)) for (const pY of perms([...rrY, ...rrY])) {
  // no identical young pairing in consecutive hours
  if (pY.some((m, i) => i && m[0] === pY[i - 1][0] && m[1] === pY[i - 1][1])) continue;
  const plays = (t, h) => p13[h].includes(t) || pY[h].includes(t);
  let cost = 0;
  for (const t of [...T13, ...YNG]) { let run = 0; for (let h = 0; h < 6; h++) { run = plays(t, h) ? run + 1 : 0; if (run >= 3) cost += 10; if (run === 2) cost += 1; } }
  // the 13s team working the young match: free 13s team with fewest works so far
  const works = Object.fromEntries([...T13, ...YNG].map(t => [t, 0])); const wk = [];
  for (let h = 0; h < 6; h++) {
    const freeY = YNG.find(t => !pY[h].includes(t));
    const free13 = T13.filter(t => !p13[h].includes(t)).sort((a, b) => works[a] - works[b]);
    const w13 = freeY, wY = free13[0];
    works[w13]++; works[wY]++; wk.push({ w13, wY });
    // don't work right after (or before) your own match two hours running
  }
  const spread = Math.max(...Object.values(works)) - Math.min(...Object.values(works));
  cost += spread * 2;
  if (!best || cost < best.cost) best = { cost, p13, pY, wk, works };
}

const rows = [];
const add = (team, title, h, court, desc) => rows.push({ team_name: team, title, event_date: DATE, start_time: HOURS[h], duration_min: 60, location: court, description: desc });
for (let h = 0; h < 6; h++) {
  const [ya, yb] = best.pY[h], [ta, tb] = best.p13[h], { w13, wY } = best.wk[h];
  for (const [a, b, court, w] of [[ya, yb, "Court 1", wY], [ta, tb, "Court 2", w13]]) {
    add(a, "Tournament — vs " + b, h, court, `DS Elite in-house tournament. ${a} vs ${b} on ${court}.`);
    add(b, "Tournament — vs " + a, h, court, `DS Elite in-house tournament. ${b} vs ${a} on ${court}.`);
    add(w, "Tournament — WORK " + court, h, court, `Officiating duty: ${a} vs ${b} on ${court}. Ref, score, and lines.`);
  }
  console.log(`${HOURS[h]}  Court 1: ${ya} v ${yb} [work ${wY}]   |   Court 2: ${ta} v ${tb} [work ${w13}]`);
}
const cnt = {}; for (const r of rows) { const k = r.team_name; cnt[k] = cnt[k] || { play: 0, work: 0 }; /WORK/.test(r.title) ? cnt[k].work++ : cnt[k].play++; }
console.log("\n" + Object.entries(cnt).sort().map(([t, c]) => `${t}: ${c.play} matches, ${c.work} work`).join("\n"));

const { data: old } = await sb.from("team_events").select("id, team_name, start_time").eq("event_date", DATE).ilike("title", "Tournament%").lt("start_time", "14:00");
console.log(`\nReplaces ${old.length} morning rows (incl. ${old.filter(r => /Rise/.test(r.team_name)).length} Rise rows) with ${rows.length}. Afternoon untouched.`);
if (!write) { console.log("DRY RUN"); process.exit(0); }
const { error: e1 } = await sb.from("team_events").delete().in("id", old.map(r => r.id));
if (e1) throw e1;
const { error: e2 } = await sb.from("team_events").insert(rows);
if (e2) throw e2;
console.log("written");
