// Checks the Marketing Machine planner (shared/marketing-plan.js) against the
// LIVE programs feed, with the seeded Thanksgiving priority, over the four
// weeks that lead into Thanksgiving break. Read-only: one GET to the public feed.
//
//   NODE_USE_ENV_PROXY=1 node scripts/test-marketing-plan.mjs [--json]
//   node scripts/test-marketing-plan.mjs --feed path/to/programs.json
//
// Asserts (balance mode): Camp Elevate is the most-posted social line in those
// weeks; parties and rentals each appear at least once in every 3 consecutive
// weeks; no line twice in a row on social; at most cadence.sms.per_month texts
// a month. Rhythm mode (the club calendar): Monday basketball / Thursday
// volleyball posts, follow-up stories on the same line, a month preview in the
// last week of a month, dedicated emails capped per month and never the same
// line as that week's roundup.

import { readFileSync } from "node:fs";
import { planWeek, planFlow, signalsFor, lineOf, mondayOf, parseBrief, normRhythm, LINES, DEFAULT_CADENCE, LINE_LINKS } from "../shared/marketing-plan.js";

const args = process.argv.slice(2);
const feedPath = args.includes("--feed") ? args[args.indexOf("--feed") + 1] : null;
const feed = feedPath ? JSON.parse(readFileSync(feedPath, "utf8")) : await (await fetch("https://www.drippingsportsclub.com/api/programs")).json();
if (!feed?.ok || !Array.isArray(feed.programs)) throw new Error("programs feed not ok");

const THANKSGIVING = {
  id: 1, title: "Thanksgiving break — push Camp Elevate",
  notes: "Thanksgiving break (Nov 23–25): push Camp Elevate hard, plus the volleyball and basketball break camps/clinics. Camp Elevate is a full-day, every-sport camp — pick one day or all three.",
  lines: ["camp_elevate", "volleyball", "basketball"], weight: 5, starts_on: "2026-10-26", ends_on: "2026-11-24", channels: ["social", "email", "sms"], active: true,
};
// The original "balance" layout (4 posts on cadence days); the calendar's
// rhythm (the default) is checked further down.
const settings = { weights: {}, cadence: { ...DEFAULT_CADENCE, social: { ...DEFAULT_CADENCE.social, mode: "balance" } } };
const WEEKS = ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"];

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) fails++; };
const addDaysT = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
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
  // Camp Elevate gets an email of its own (or leads the roundup when the
  // monthly cap on dedicated emails is used up).
  const emails = plan.slots.filter(s => s.channel === "email");
  check(emails.some(e => e.line === "camp_elevate") || (emails.find(e => e.kind === "roundup")?.programs || []).some(p => p.line === "camp_elevate"), `${w}: email covers Camp Elevate (${emails.map(e => e.kind + ":" + e.line).join(", ")})`);
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

// ── Rhythm mode: the club's marketing calendar (the default) ──
console.log("\n=== Rhythm mode ===");
const rset = { weights: {}, cadence: DEFAULT_CADENCE };
let rh = [];
const dedByMonth = {};
for (const w of [...WEEKS, "2026-11-23", "2026-11-30", "2026-12-07"]) {
  const plan = planWeek({ weekOf: w, programs: feed.programs, priorities: [THANKSGIVING], settings: rset, history: rh });
  const posts = plan.slots.filter(s => s.channel === "social" && s.kind === "post");
  console.log(`  ${w}: ${plan.slots.map(s => `${s.day.slice(5)} ${s.kind}:${s.line}`).join(", ")}`);
  const mon = posts.find(s => s.day === w), thu = posts.find(s => s.day === addDaysT(w, 3));
  if (w !== "2026-11-23") check(mon?.line === "basketball", `${w}: Monday post is basketball (${mon?.line})`);
  check(thu?.line === "volleyball", `${w}: Thursday post is volleyball (${thu?.line})`);
  for (const f of plan.slots.filter(s => s.kind === "follow_up")) {
    const src = posts.find(s => s.day === addDaysT(f.day, -1));
    check(src && src.line === f.line && f.platforms.includes("instagram_story") && !f.platforms.includes("instagram"), `${w}: ${f.day} follow-up story is on ${f.line}, story platforms only`);
  }
  for (let i = 1; i < posts.length; i++) if (posts[i].line === posts[i - 1].line) check(false, `${w}: ${posts[i].line} twice in a row`);
  const ded = plan.slots.find(s => s.kind === "dedicated"), rnd = plan.slots.find(s => s.kind === "roundup");
  check(!!rnd, `${w}: weekly roundup email planned (${rnd?.day})`);
  if (ded) { dedByMonth[ded.day.slice(0, 7)] = (dedByMonth[ded.day.slice(0, 7)] || 0) + 1; check(ded.line !== rnd?.line, `${w}: dedicated email (${ded.line}) isn't the roundup's line (${rnd?.line})`); }
  check(plan.slots.every(s => s.channel === "sms" || s.channel === "email" || s.theme), `${w}: every post has a theme`);
  const prev = plan.slots.filter(s => s.kind === "preview");
  check(prev.length === (["2026-10-26", "2026-11-23"].includes(w) ? 1 : 0), `${w}: ${prev.length} month preview(s)`);
  rh = rh.concat(plan.slots.map(s => ({ week_of: w, channel: s.channel, kind: s.kind, line: s.line, status: "draft", scheduled_at: s.day })));
}
for (const [m, n] of Object.entries(dedByMonth)) check(n <= DEFAULT_CADENCE.email.dedicated_per_month, `dedicated emails in ${m}: ${n}`);
check(Object.keys(dedByMonth).length > 0, `dedicated emails planned (${JSON.stringify(dedByMonth)})`);
// "less volleyball" opens Thursday to the other lines; "more Reach" puts Reach on Wednesday.
const less = planWeek({ weekOf: "2026-12-07", programs: feed.programs, settings: rset, priorities: [{ title: "x", lines: ["reach"], avoid_lines: ["volleyball"], weight: 4, starts_on: "2026-12-07", ends_on: "2026-12-13", channels: ["social", "email"], active: true }] });
const lp = less.slots.filter(s => s.kind === "post");
check(!lp.some(s => s.line === "volleyball") && lp.find(s => s.day === "2026-12-09")?.line === "reach", `brief "more Reach, less volleyball": ${lp.map(s => s.day.slice(5) + ":" + s.line).join(", ")}`);
const nr = normRhythm([{ day: "TUE", follow: "mon" }, { day: "mon", lines: ["basketball", "nope"] }, { day: "xyz" }, { day: "wed", follow: "fri" }]);
check(JSON.stringify(nr) === JSON.stringify([{ day: "mon", lines: ["basketball"], format: "post" }, { day: "tue", follow: "mon", format: "story" }]), `normRhythm cleans entries: ${JSON.stringify(nr)}`);
const bal = planWeek({ weekOf: "2026-12-07", programs: feed.programs, settings, priorities: [] });
check(bal.slots.filter(s => s.channel === "social").length === 4 && bal.slots.every(s => s.kind), "balance mode still makes 4 posts, every slot has a kind");

console.log(`\n${fails ? fails + " FAILED" : "all checks passed"}`);
process.exit(fails ? 1 : 0);
