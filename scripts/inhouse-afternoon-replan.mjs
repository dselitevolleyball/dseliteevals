// In-house tournament (Sun Nov 29, 2026) - the 14s-16s session, Drew's
// matchups (Oct 10): 2 matches per team, 4pm start on Courts 1-3.
//   16 Diamond - 15 Diamond, 15 Ruby          15 Diamond - 16 Diamond, 15 Ruby
//   14 Diamond - 14 Ruby, 15 Sapphire         15 Sapphire - 14 Diamond, 15 Emerald
//   15 Emerald - 15 Sapphire, 14 Ruby         14 Ruby - 14 Diamond, 15 Emerald
//   14 Sapphire, 14 Emerald, 14 Topaz - round robin
// Every match is worked by a team that's free that hour; the search keeps
// back-to-backs to a minimum and spreads the work.
//   node scripts/inhouse-afternoon-replan.mjs            # dry run
//   node scripts/inhouse-afternoon-replan.mjs --write

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const write = process.argv.includes("--write");
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DATE = "2026-11-29";
const HOURS = ["16:00", "17:00", "18:00", "19:00"];
const COURTS = ["Court 1", "Court 2", "Court 3"];
const MATCHES = [
  ["16 Diamond", "15 Diamond"], ["16 Diamond", "15 Ruby"], ["15 Diamond", "15 Ruby"],
  ["14 Diamond", "14 Ruby"], ["14 Diamond", "15 Sapphire"], ["15 Sapphire", "15 Emerald"], ["15 Emerald", "14 Ruby"],
  ["14 Sapphire", "14 Emerald"], ["14 Sapphire", "14 Topaz"], ["14 Emerald", "14 Topaz"],
];
const T = [...new Set(MATCHES.flat())];
for (const t of T) if (MATCHES.filter(m => m.includes(t)).length !== 2) throw new Error(t + " doesn't have 2 matches");

let best = null;
const slots = HOURS.map(() => []);
const score = () => {
  const plays = (t, h) => !!slots[h] && slots[h].some(m => m.includes(t));
  let cost = 0;
  for (const t of T) for (let h = 1; h < HOURS.length; h++) if (plays(t, h) && plays(t, h - 1)) cost += 10;
  const works = Object.fromEntries(T.map(t => [t, 0])); const crew = [];
  for (let h = 0; h < HOURS.length; h++) {
    const busy = new Set(slots[h].flat()); const used = new Set();
    for (const m of slots[h]) {
      // prefer a crew that isn't playing right before or after
      const free = T.filter(t => !busy.has(t) && !used.has(t)).sort((a, b) => works[a] - works[b] || ((plays(a, h - 1) || plays(a, h + 1)) - (plays(b, h - 1) || plays(b, h + 1))));
      if (!free.length) return null;
      used.add(free[0]); works[free[0]]++; crew.push({ h, m, w: free[0] });
    }
  }
  const v = Object.values(works); cost += (Math.max(...v) - Math.min(...v)) * 5;
  return { cost, crew, works };
};
const place = (i) => {
  if (i === MATCHES.length) { const s = score(); if (s && (!best || s.cost < best.cost)) best = { ...s, plan: slots.map(x => x.slice()) }; return; }
  const m = MATCHES[i];
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
    add(a, "Tournament — vs " + b, h, court, `DS Elite in-house tournament. ${a} vs ${b} on ${court}. Coaches arrive by 3:00pm.`);
    add(b, "Tournament — vs " + a, h, court, `DS Elite in-house tournament. ${b} vs ${a} on ${court}. Coaches arrive by 3:00pm.`);
    add(w, "Tournament — WORK " + court, h, court, `Officiating duty: ${a} vs ${b} on ${court}. Ref, score, and lines. Coaches arrive by 3:00pm.`);
    line.push(`${court}: ${a} v ${b} [work ${w}]`);
  });
  console.log(`${HOURS[h]}  ${line.join("   |   ") || "(free)"}`);
}
console.log("\nback-to-back cost " + best.cost + "\n" + T.sort().map(t => `${t}: plays ${best.plan.flatMap((s, h) => s.filter(m => m.includes(t)).map(() => HOURS[h])).join(", ")} · works ${best.works[t]}`).join("\n"));

const { data: old } = await sb.from("team_events").select("id").eq("event_date", DATE).ilike("title", "Tournament%").gte("start_time", "16:00");
console.log(`\nReplaces ${old.length} afternoon rows with ${rows.length}. Younger group untouched.`);
if (!write) { console.log("DRY RUN"); process.exit(0); }
const { error: e1 } = await sb.from("team_events").delete().in("id", old.map(r => r.id)); if (e1) throw e1;
const { error: e2 } = await sb.from("team_events").insert(rows); if (e2) throw e2;
console.log("written");
