// Checks the Marketing Machine planner (shared/marketing-plan.js) against the
// LIVE programs feed, with the seeded Thanksgiving priority, over the four
// weeks that lead into Thanksgiving break. Read-only: one GET to the public feed.
//
//   NODE_USE_ENV_PROXY=1 node scripts/test-marketing-plan.mjs [--json]
//   node scripts/test-marketing-plan.mjs --feed path/to/programs.json
//
// Asserts: Camp Elevate is the most-posted social line in those weeks; parties
// and rentals each appear at least once in every 3 consecutive weeks; no line
// twice in a row on social; at most cadence.sms.per_month texts a month.

import { readFileSync } from "node:fs";
import { planWeek, planFlow, signalsFor, lineOf, mondayOf, parseBrief, LINES, DEFAULT_CADENCE, LINE_LINKS } from "../shared/marketing-plan.js";

const args = process.argv.slice(2);
const feedPath = args.includes("--feed") ? args[args.indexOf("--feed") + 1] : null;
const feed = feedPath ? JSON.parse(readFileSync(feedPath, "utf8")) : await (await fetch("https://www.drippingsportsclub.com/api/programs")).json();
if (!feed?.ok || !Array.isArray(feed.programs)) throw new Error("programs feed not ok");

const THANKSGIVING = {
  id: 1, title: "Thanksgiving break — push Camp Elevate",
  notes: "Thanksgiving break (Nov 23–25): push Camp Elevate hard, plus the volleyball and basketball break camps/clinics. Camp Elevate is a full-day, every-sport camp — pick one day or all three.",
  lines: ["camp_elevate", "volleyball", "basketball"], weight: 5, starts_on: "2026-10-26", ends_on: "2026-11-24", channels: ["social", "email", "sms"], active: true,
};
const settings = { weights: {}, cadence: DEFAULT_CADENCE };
const WEEKS = ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"];

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) fails++; };
const label = (k) => LINES.find(l => l.key === k)?.label || k;

console.log(`Feed: ${feed.programs.length} programs, today ${feed.today}`);
const lines = {}; for (const p of feed.programs) { const l = lineOf(p); lines[l] = (lines[l] || 0) + 1; }
console.log("Lines in feed:", lines);
console.log("Camp Elevate ->", lineOf(feed.programs.find(p => /camp elevate/i.test(p.name)) || {}));
console.log("mondayOf(2026-10-22) =", mondayOf("2026-10-22"), " mondayOf(2026-10-25) =", mondayOf("2026-10-25"), " mondayOf(2026-10-26) =", mondayOf("2026-10-26"));
console.log("Signals today:", signalsFor(feed.programs, feed.today).slice(0, 8).map(s => `${s.angle}/${s.urgency} ${s.line}: ${s.program.name}`));

// Week by week (planWeek with growing history), as generate would do it.
let history = [];
const social = [], smsByMonth = {};
for (const w of WEEKS) {
  const plan = planWeek({ weekOf: w, programs: feed.programs, priorities: [THANKSGIVING], settings, history });
  console.log(`\n=== Week of ${w} ===`);
  console.log("scores:", Object.entries(plan.scores).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));
  for (const n of plan.notes) console.log("  note:", n);
  for (const s of plan.slots) {
    console.log(`  ${s.day} ${s.time} ${s.channel.padEnd(6)} ${label(s.line).padEnd(18)} ${String(s.angle).padEnd(13)} ${s.program ? s.program.name : "-"}`);
    console.log(`      why: ${s.reason}`);
    if (s.channel === "email") console.log(`      programs: ${s.programs.map(p => `${p.name} (${p.first_date}, ${p.angle})`).join(" | ")}; evergreen: ${s.evergreen}`);
  }
  const soc = plan.slots.filter(s => s.channel === "social").map(s => s.line);
  social.push(soc);
  for (let i = 1; i < soc.length; i++) if (soc[i] === soc[i - 1]) check(false, `${w}: ${soc[i]} twice in a row`);
  const counts = {}; for (const l of soc) counts[l] = (counts[l] || 0) + 1;
  const top = Math.max(...Object.values(counts));
  check(counts.camp_elevate === top, `${w}: Camp Elevate leads social (${counts.camp_elevate || 0} of ${soc.length}; ${JSON.stringify(counts)})`);
  const email = plan.slots.find(s => s.channel === "email");
  check(email && email.line === "camp_elevate", `${w}: email features ${email?.line}`);
  for (const s of plan.slots.filter(s => s.channel === "sms")) smsByMonth[s.day.slice(0, 7)] = (smsByMonth[s.day.slice(0, 7)] || 0) + 1;
  for (const s of plan.slots) if (s.program) check(/^https:\/\//.test(s.program.url), `${w}: ${s.channel} ${s.program.name} has a real URL`);
  history = history.concat(plan.slots.map(s => ({ week_of: w, channel: s.channel, line: s.line, status: "draft", scheduled_at: s.day })));
}
console.log();
for (const l of ["parties", "rentals"]) {
  for (let i = 0; i + 2 < social.length; i++) check(social.slice(i, i + 3).some(ws => ws.includes(l)), `${label(l)} appears in weeks ${WEEKS[i]}..${WEEKS[i + 2]}`);
}
for (const [m, n] of Object.entries(smsByMonth)) check(n <= DEFAULT_CADENCE.sms.per_month, `texts in ${m}: ${n} (max ${DEFAULT_CADENCE.sms.per_month})`);
check(Object.keys(smsByMonth).length > 0, `at least one text planned (${JSON.stringify(smsByMonth)})`);

// planFlow over 6 weeks from the first week, no history.
const flow = planFlow({ startWeek: WEEKS[0], weeks: 6, programs: feed.programs, priorities: [THANKSGIVING], settings, history: [] });
console.log("\nplanFlow (6 weeks):");
for (const f of flow) console.log(`  ${f.weekOf}  social: ${f.social.join(", ").padEnd(60)} email: ${f.email}  sms: ${f.sms || "-"}`);
for (const l of ["parties", "rentals", "open_gym"]) {
  for (let i = 0; i + 2 < flow.length; i++) check(flow.slice(i, i + 3).some(f => f.social.includes(l)), `flow: ${label(l)} in weeks ${flow[i].weekOf}..${flow[i + 2].weekOf}`);
}
const fm = {}; for (const f of flow) for (const s of f.slots) if (s.channel === "sms") fm[s.day.slice(0, 7)] = (fm[s.day.slice(0, 7)] || 0) + 1;
for (const [m, n] of Object.entries(fm)) check(n <= 2, `flow texts in ${m}: ${n}`);

// Without the priority the mix should spread out.
const plain = planWeek({ weekOf: "2026-12-07", programs: feed.programs, priorities: [], settings, history: [] });
console.log("\nNo priority, week of 2026-12-07:", plain.slots.map(s => `${s.channel}:${s.line}`).join(", "));

// The current week (generate on a Thursday): no slots before today.
const cur = planWeek({ weekOf: "2026-10-19", today: "2026-10-22", programs: feed.programs, priorities: [THANKSGIVING], settings, history: [] });
check(cur.slots.every(s => s.day >= "2026-10-22"), `current week drops past days (${cur.slots.map(s => s.day + ":" + s.channel).join(", ")})`);

// Briefs.
for (const t of ["more Reach, less volleyball", "push Camp Elevate harder", "Thanksgiving: push Camp Elevate hard + volleyball and basketball camps", "no parties this week, focus on open gym"]) console.log("parseBrief:", JSON.stringify(t), "->", JSON.stringify(parseBrief(t)));
check(JSON.stringify(parseBrief("more Reach, less volleyball")) === JSON.stringify({ lines: ["reach"], avoid_lines: ["volleyball"] }), "parseBrief more/less");
check(Object.values(LINE_LINKS).every(l => /^https:\/\//.test(l.page)), "every line has a public page");

console.log(`\n${fails ? fails + " FAILED" : "all checks passed"}`);
process.exit(fails ? 1 : 0);
