// Offline checks for Reach Stats (Oct 23 2026): sprint speed (mph) as a test
// for everyone, tests added in HQ, Reach athletes who aren't DS Elite players,
// and the public board. No network: an in-memory Supabase.
//   node scripts/test-reach-stats.mjs
//  1. shared/stat-report.js: parsing, formatting, custom tests, mph red flags
//  2. the team testing sheet's flag port (public/stats-sheet.js) still matches
//     statFlags flag for flag, sprint speed included (random histories)
//  3. api/reach-stats.js: athletes, a test day (merge, clear, vertical), flags, tests
//  4. api/leaderboard.js boardData: Reach athletes, sprint speed and added tests on the board

import { readFileSync } from "node:fs";
import { fakeSupabase } from "./lib/fake-supabase.mjs";

const S = await import("../shared/stat-report.js");
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) fails++; };

console.log("== 1. the shared builder ==");
check(S.parseMetric("stand_reach", "8'4") === 100 && S.parseMetric("stand_reach", "8-4") === 100 && S.parseMetric("stand_reach", "100 in") === 100 && S.parseMetric("approach_touch", "9' 7.5\"") === 115.5, "heights: 8'4 / 8-4 / 100 in / 9' 7.5\" read as inches");
check(S.parseMetric("sprint_mph", "17.4") === 17.4 && S.parseMetric("sprint_mph", "17.4 mph") === 17.4 && S.parseMetric("dash_10y", "") === null && Number.isNaN(S.parseMetric("dash_10y", "fast")), "speeds and seconds as plain numbers; blank is null; junk is unreadable");
check(S.fmtMetric("sprint_mph", 17.4) === "17.40 mph" && S.fmtChange("sprint_mph", 1.25) === "+1.25 mph" && S.fmtMetric("dash_10y", 1.85) === "1.85s" && S.fmtMetric("stand_reach", 100) === "8' 4\"" && S.fmtMetric("vertical", 21.7) === '21.70"', 'sprint speed reads "17.40 mph" / "+1.25 mph"; the rest unchanged');
S.setCustomMetrics([{ key: "pro_agility", label: "Pro agility", unit: "sec", higher_better: false }, { key: "trap_bar", label: "Trap bar deadlift", unit: "lb", higher_better: true }, { key: "old_one", label: "Old", unit: "", active: false }]);
check(S.METRICS.map(m => m[0]).join() === "stand_reach,approach_touch,standing_touch,vertical,broad_jump,dash_10y,sprint_mph,pro_agility,trap_bar", `added tests join METRICS after the built-ins (switched-off ones don't): ${S.METRICS.slice(7).map(m => m[0]).join(", ")}`);
check(S.fmtMetric("trap_bar", 225) === "225 lb" && S.fmtMetric("pro_agility", 4.8) === "4.80s" && S.fmtChange("pro_agility", -0.12) === "−0.12s", "added tests format in their own unit (225 lb, 4.80s)");
const mr = S.metricRows({ first_name: "A", sprint_mph: 16.1 }, [{ id: 1, test_date: "2026-10-20", sprint_mph: 17.4, extra: { trap_bar: 205, pro_agility: 4.9 } }, { id: 2, test_date: "2026-10-27", extra: { pro_agility: 4.7 } }]);
const by = Object.fromEntries(mr.map(r => [r.key, r]));
check(by.sprint_mph.baseline === 16.1 && by.sprint_mph.latest === 17.4 && by.sprint_mph.better === true && by.pro_agility.change === -0.2 && by.pro_agility.better === true && by.trap_bar.baseline === 205, "tryout sprint speed is the baseline; added tests read from extra; lower-is-better respected");
S.setCustomMetrics([]);
check(S.METRICS.length === 7, "clearing the added tests leaves the 7 built-ins");
const P = { first_name: "Q", usav_div: "U14", sprint_mph: 16.1, stat_baseline_date: "2026-06-26" };
const fl = (v) => S.statFlags(P, [{ id: 1, test_date: "2026-10-20", sprint_mph: v }]).map(f => f.reason).join(" | ");
check(fl(17.4) === "" && /km\/h\? \(17\.40 mph\)/.test(fl(28)) && /without the decimal point \(17\.20 mph\?\)/.test(fl(1720)) && /slower than a jog/.test(fl(4)) && /\+6\.40 mph since Jun 26/.test(fl(22.5)), "sprint speed red flags: km/h, a missing decimal, too slow, a jump too big to be real");

console.log("\n== 2. the team sheet's flag port matches statFlags ==");
const src = readFileSync(new URL("../public/stats-sheet.js", import.meta.url), "utf8");
const statSheetFlags = new Function(src.slice(src.indexOf("function statSheetFlags"), src.indexOf("(function () {")) + "; return statSheetFlags;")();
const L = Object.fromEntries(S.METRICS.map(m => [m[0], m[1]]));
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const maybe = (p, f) => rnd() < p ? f() : null;
let mismatch = 0, compared = 0, mphFlags = 0;
for (let i = 0; i < 3000; i++) {
  const reach = 80 + rnd() * 14;
  const typo = (v, kind) => rnd() < 0.12 ? pick(kind === "mph" ? [v * 1.609, v * 10, v - 9, v + 7] : kind === "s" ? [v * 100, v + 1.2] : [v * 2.54, v - 15.75, v / 12, v + 12]) : v;
  const base = { date: pick(["2026-06-26", null]), stand_reach: maybe(0.8, () => +reach.toFixed(2)), approach_touch: maybe(0.8, () => +typo(reach + 14 + rnd() * 10, "in").toFixed(2)), standing_touch: maybe(0.6, () => +typo(reach + 10 + rnd() * 6, "in").toFixed(2)), dash_10y: maybe(0.7, () => +typo(1.8 + rnd() * 0.4, "s").toFixed(2)), sprint_mph: maybe(0.6, () => +typo(14 + rnd() * 5, "mph").toFixed(2)) };
  const tests = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, k) => ({ id: k + 1, date: ["2026-08-15", "2026-10-11", "2027-01-20"][k], stand_reach: maybe(0.5, () => +(reach + rnd() * 1.5).toFixed(2)), approach_touch: maybe(0.7, () => +typo(reach + 15 + rnd() * 10, "in").toFixed(2)), standing_touch: maybe(0.5, () => +typo(reach + 11 + rnd() * 6, "in").toFixed(2)), broad_jump: maybe(0.5, () => +typo(60 + rnd() * 25, "in").toFixed(2)), dash_10y: maybe(0.6, () => +typo(1.75 + rnd() * 0.4, "s").toFixed(2)), sprint_mph: maybe(0.6, () => +typo(14.5 + rnd() * 5, "mph").toFixed(2)) }));
  const player = { first_name: "X", stand_reach: base.stand_reach, approach_touch: base.approach_touch, jump_touch: base.standing_touch, sprint_10y: base.dash_10y, sprint_mph: base.sprint_mph, stat_baseline_date: base.date };
  const a = S.statFlags(player, tests.map(t => ({ ...t, test_date: t.date }))).map(f => [f.key, f.row, f.level, f.rule, f.reason].join("|")).sort();
  const b = statSheetFlags(S.STAT_FLAG_RULES, L, base, tests).map(f => [f.key, f.row, f.level, f.rule, f.reason].join("|")).sort();
  compared++; mphFlags += a.filter(x => x.startsWith("sprint_mph")).length;
  if (a.join("\n") !== b.join("\n")) { if (!mismatch) console.log("  first mismatch:\n   shared:", a, "\n   sheet: ", b); mismatch++; }
}
check(mismatch === 0 && mphFlags > 100, `${compared} random histories, flag for flag (${mphFlags} sprint-speed flags among them); ${mismatch} mismatches`);

console.log("\n== 3. api/reach-stats.js ==");
const { runReach } = await import("../api/reach-stats.js");
const sb = fakeSupabase({
  players: [
    { id: 11, first_name: "Kate", last_name: "Stroop", gender: "female", usav_div: "U14", season: "2026-27", team_assignment: "14 Diamond", offer_status: "accepted", stand_reach: 90, approach_touch: 110, jump_touch: 102, sprint_10y: 1.95, sprint_mph: null, stat_baseline_date: "2026-06-26" },
    { id: 12, first_name: "Old", last_name: "Player", season: "2025-26", team_assignment: "13 Ruby", offer_status: "accepted" },
  ],
  player_stat_tests: [{ id: 501, player_id: 11, test_date: "2026-10-11", stand_reach: 90.5, approach_touch: 112, standing_touch: null, vertical: 21.5, broad_jump: 80, dash_10y: 1.9, sprint_mph: null, extra: {}, notes: null }],
  reach_athletes: [], reach_athlete_tests: [], stat_metrics: [],
});
const who = { me: "brandon@drippingsportsclub.com", name: "Brandon Butler" };
let L1 = await runReach(sb, who, { action: "load" });
check(L1.players.map(p => p.id).join() === "11" && L1.tests.dse.length === 1 && L1.metrics.some(m => m.key === "sprint_mph" && m.unit === "mph" && m.built_in), "load: this season's DS Elite players (not last season's), their tests, sprint speed among the tests");
const add = await runReach(sb, who, { action: "athlete_save", athlete: { first_name: "Jackson", last_name: "Reyes", gender: "M", dob: "2012-03-04", sport: "Football", team: "Dripping Springs MS", parent_email: "Mom@Example.com", public: true } });
check(add.athlete.id && add.athlete.gender === "M" && add.athlete.parent_email === "mom@example.com" && add.athlete.created_by === who.me, "a new Reach athlete is saved (email tidied, who added him)");
const dupe = await runReach(sb, who, { action: "athlete_save", athlete: { first_name: "kate", last_name: "STROOP" } }).catch(e => e);
check(dupe.status === 409 && dupe.extra?.match?.kind === "dse" && /DS Elite player \(14 Diamond\)/.test(dupe.message), `a DS Elite player's name is caught: "${dupe.message}"`);
const dupe2 = await runReach(sb, who, { action: "athlete_save", athlete: { first_name: "Jackson", last_name: "Reyes" } }).catch(e => e);
const forced = await runReach(sb, who, { action: "athlete_save", athlete: { first_name: "Jackson", last_name: "Reyes", sport: "Soccer" }, force: true });
check(dupe2.status === 409 && dupe2.extra?.match?.kind === "reach" && forced.athlete.id !== add.athlete.id, "a second Reach athlete with the same name asks first; force adds a different person");
const jid = add.athlete.id;
const m1 = await runReach(sb, who, { action: "metric_save", metric: { label: "Pro agility", unit: "sec", higher_better: false, on_board: true } });
check(m1.metric.key === "pro_agility" && m1.metric.unit === "sec" && m1.metric.higher_better === false, `metric_save: "Pro agility" -> key ${m1.metric.key}`);
const m2 = await runReach(sb, who, { action: "metric_save", metric: { label: "Pro agility", unit: "sec" } });
check(m2.metric.key === "pro_agility_2", "the same name again gets its own key (pro_agility_2)");
await runReach(sb, who, { action: "metric_save", metric: { ...m2.metric, active: false } });
const day = "2026-10-20";
const s1 = await runReach(sb, who, { action: "results_save", date: day, rows: [
  { kind: "reach", id: jid, values: { stand_reach: "7'2", approach_touch: "104", broad_jump: "84.5", dash_10y: "1.72", sprint_mph: "19.4", pro_agility: "4.61" } },
  { kind: "dse", id: 11, values: { approach_touch: "113.25", sprint_mph: "17.2" } },
] });
const jt = sb.db.reach_athlete_tests.find(t => t.athlete_id === jid), kt = sb.db.player_stat_tests.find(t => t.player_id === 11 && t.test_date === day);
check(s1.saved === 2 && jt.stand_reach === 86 && jt.vertical === 18 && jt.sprint_mph === 19.4 && jt.extra.pro_agility === 4.61 && jt.recorded_by === "Brandon Butler" && jt.source === "hq", "Reach athlete: 7'2 → 86\", vertical 104 − 86 = 18\", sprint mph and the added test (in extra) saved");
check(kt && kt.approach_touch === 113.25 && kt.vertical === 22.75 && kt.sprint_mph === 17.2 && kt.team_name === "14 Diamond", "DS Elite player: saved to player_stat_tests (her team on it); vertical uses her latest reach (90.5 from Oct 11)");
const s2 = await runReach(sb, who, { action: "results_save", date: day, rows: [{ kind: "reach", id: jid, values: { broad_jump: "", standing_touch: "96" } }] });
const jt2 = sb.db.reach_athlete_tests.find(t => t.athlete_id === jid);
check(s2.saved === 1 && sb.db.reach_athlete_tests.length === 1 && jt2.broad_jump == null && jt2.standing_touch === 96 && jt2.approach_touch === 104 && jt2.extra.pro_agility === 4.61, "same day again: a blank clears that number, new ones add, the rest stay");
const s3 = await runReach(sb, who, { action: "results_save", date: day, rows: [{ kind: "reach", id: jid, values: { sprint_mph: "31" } }] });
check(s3.flags.some(f => f.name === "Jackson Reyes" && /km\/h/.test(f.reason)), `a typo comes back to check: ${s3.flags.map(f => f.reason).join("; ")}`);
const bad = await runReach(sb, who, { action: "results_save", date: day, rows: [{ kind: "reach", id: jid, values: { dash_10y: "quick" } }] }).catch(e => e);
check(bad.status === 400 && bad.extra?.bad?.[0]?.id === jid, "an unreadable number is refused and its row named");
const fut = await runReach(sb, who, { action: "results_save", date: "2099-01-01", rows: [] }).catch(e => e);
check(fut.status === 400, "a date in the future is refused");
const clear = await runReach(sb, who, { action: "results_save", date: day, rows: [{ kind: "dse", id: 11, values: { approach_touch: "", sprint_mph: "" } }] });
check(clear.cleared === 1 && !sb.db.player_stat_tests.some(t => t.player_id === 11 && t.test_date === day), "clearing every number for the day removes that day's row");
// Fix the km/h slip (a red flag nobody accepted keeps a number off the board), then a second day.
await runReach(sb, who, { action: "results_save", date: day, rows: [{ kind: "reach", id: jid, values: { sprint_mph: "19.4" } }] });
await runReach(sb, who, { action: "results_save", date: "2026-10-22", rows: [{ kind: "reach", id: jid, values: { sprint_mph: "19.9", dash_10y: "1.69" } }] });

console.log("\n== 4. the public board ==");
const { boardData } = await import("../api/leaderboard.js");
sb.db.stat_boards = [{ key: "pub", public: true, settings: {}, created_at: "2026-10-14" }];
sb.db.stat_flag_reviews = [];
sb.db.reach_athletes.push({ id: 900, first_name: "Hidden", last_name: "Kid", active: true, public: false });
sb.db.reach_athlete_tests.push({ id: 9001, athlete_id: 900, test_date: day, sprint_mph: 25, extra: {} });
const { status, body } = await boardData(sb, {});
const jack = body.athletes.find(a => a.n === "Jackson R."), kate = body.athletes.find(a => a.n === "Kate S.");
check(status === 200 && jack && jack.t === "Reach" && jack.g === "M" && jack.m.sprint_mph.best === 19.9 && jack.m.sprint_mph.gain === 0.5 && jack.m.dash_10y.best === 1.69, `Jackson R. is on the board under "Reach": sprint ${jack?.m.sprint_mph.best} mph (+${jack?.m.sprint_mph.gain}), 10-yard ${jack?.m.dash_10y.best}s`);
check(!body.athletes.some(a => a.n === "Hidden K."), "an athlete with \"show on the public board\" unticked stays off");
check(body.metrics.some(m => m.key === "sprint_mph" && m.unit === "mph") && body.metrics.some(m => m.key === "pro_agility" && m.up === false) && !body.metrics.some(m => m.key === "pro_agility_2"), "board tests: sprint speed and the added Pro agility (not the switched-off one)");
check(jack.m.pro_agility?.best === 4.61 && kate && kate.t === "14 Diamond" && !JSON.stringify(body).includes("Reyes") && !JSON.stringify(body).includes("Stroop"), "added tests rank too; names stay first name + last initial; DS Elite unchanged");
check(jack.id !== kate.id && /^[0-9a-f]{10}$/.test(jack.id), "ids are the board's hashes (a Reach id can't collide with a DS Elite one)");

console.log(`\n${fails ? fails + " FAILED" : "all checks passed"}`);
process.exit(fails ? 1 : 0);
