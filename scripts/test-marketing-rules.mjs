// Offline checks for the directors' marketing rules (Marketing -> Rules,
// shared/marketing-rules.js): reading a rule in plain words, the planner
// keeping lines apart (LIVE programs feed, one public GET), the copy check,
// the API (rules_check / rules_redo against an in-memory Supabase) and reels.
//   NODE_USE_ENV_PROXY=1 node scripts/test-marketing-rules.mjs

import { fakeSupabase } from "./lib/fake-supabase.mjs";

delete process.env.ANTHROPIC_API_KEY;
const R = await import("../shared/marketing-rules.js");
const { planWeek } = await import("../shared/marketing-plan.js");
const core = await import("../api/_lib/marketing-core.js");
const ai = await import("../api/_lib/marketing-ai.js");
const { run } = await import("../api/marketing.js");

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) fails++; };
const RULE = "Dont combine sport programming and birthday parties";

console.log("== reading a rule ==");
const apart = R.guessApart(RULE);
check(JSON.stringify(apart) === JSON.stringify([R.SPORT_LINES, ["parties"]]), `"${RULE}" -> ${JSON.stringify(apart)}`);
check(JSON.stringify(R.guessApart("Keep Camp Elevate and Reach Performance in separate posts")) === JSON.stringify([["camp_elevate"], ["reach"]]), "two named programs -> those two");
check(R.guessApart("Say the Warehouse, never the gym") === null && R.guessApart("Always smile") === null, "a rule that isn't about programs keeps nothing apart");
const rules = R.normRules([{ id: "r1", text: RULE, apart }, { id: "r2", text: "Never mention prices", apart: null }, { id: "r3", text: "Off one", active: false, apart: [["volleyball"], ["basketball"]] }]);
check(R.clash("volleyball", "parties", rules)?.id === "r1" && !R.clash("parties", "rentals", rules) && !R.clash("volleyball", "basketball", rules), "clash: sports vs parties yes; parties vs rentals no; a rule turned off counts for nothing");
check(R.normRules([{ text: "x", apart: [["volleyball"], ["volleyball"]] }])[0].apart === null && R.normRules([{ text: "" }]).length === 0, "a side that only repeats the other, or an empty rule, is dropped");
const rt = R.rulesText(rules);
check(/Dont combine sport programming/.test(rt) && /Volleyball \/ Basketball \/ Reach Performance \/ Camp Elevate together with Birthday parties/.test(rt) && /Never mention prices/.test(rt) && !/Off one/.test(rt), "Claude is told every active rule, with the lines spelled out");

console.log("\n== the planner (live feed) ==");
const feed = await (await fetch("https://www.drippingsportsclub.com/api/programs")).json();
const PARTIES = { id: 2, title: "Birthday Parties", notes: "Bigger and better birthday parties in the brand-new Warehouse II.", lines: ["parties"], avoid_lines: [], weight: 4, starts_on: "2026-10-19", ends_on: "2026-11-15", channels: ["social", "email"], active: true };
const settings = { ...core.SETTINGS_DEFAULTS };
let mixedBefore = 0, mixedAfter = 0, emails = 0;
for (const w of ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]) {
  for (const [rs, tally] of [[[], (n) => { mixedBefore += n; }], [rules, (n) => { mixedAfter += n; }]]) {
    const { slots } = planWeek({ weekOf: w, programs: feed.programs, priorities: [PARTIES], settings: { ...settings, rules: rs }, history: [] });
    const multi = slots.filter(s => s.kind === "roundup" || s.kind === "preview");
    if (rs.length) emails += multi.length;
    tally(multi.filter(s => { const ls = [s.line, ...(s.programs || []).map(p => p.line), s.evergreen].filter(Boolean); return ls.some(a => ls.some(b => R.clash(a, b, rules))); }).length);
  }
}
check(mixedBefore > 0, `without the rule, ${mixedBefore} roundup/preview piece(s) mix sports and parties (the bug the rule fixes)`);
check(mixedAfter === 0 && emails >= 5, `with the rule, none of ${emails} roundups/previews do`);

console.log("\n== the copy check ==");
const slot = { channel: "email", kind: "roundup", line: "parties", programs: [], evergreen: "rentals" };
const fb = { headline: "Bigger Birthdays", accent: "Birthdays", sub: "", tag: "", body: "Book a party.", cta_text: "Book a party", hashtags: [], email_subject: "Parties", email_preheader: "", email_blocks: [], photo_tags: [] };
const bad = ai.cleanCopy({ ...fb, email_subject: "Bigger birthday parties + Coach Chang's volleyball pods" }, slot, fb, rules);
check(!bad.copy && /mentions volleyball/.test(bad.problems.join()), `a parties email that mentions volleyball is refused: ${bad.problems.join("; ")}`);
check(!!ai.cleanCopy({ ...fb, email_subject: "Bigger birthday parties in Warehouse II" }, slot, fb, rules).copy, "a parties-only email passes");
check(!!ai.cleanCopy({ ...fb, email_subject: "Volleyball pods + birthday parties" }, slot, fb, []).copy, "with no rules nothing is refused");

console.log("\n== the API ==");
const mixed = { id: 4, week_of: "2026-11-02", channel: "email", kind: "roundup", status: "draft", line: "parties", headline: "Bigger Birthdays Start Here", email_subject: "Bigger birthday parties + Coach Chang pods start Oct 29", body: "Party in Warehouse II.", programs: [{ id: "79681", line: "volleyball", name: "U13-15 Pod" }], email_blocks: [{ program_id: "79681", blurb: "Hitting pod" }, { program_id: null, line: "rentals", blurb: "Rent a court" }], scheduled_at: "2026-11-03T12:30:00Z", graphic: {}, revisions: [], created_at: "2026-10-22T00:00:00Z", updated_at: "2026-10-22T00:00:00Z" };
const fine = { ...mixed, id: 5, kind: "post", channel: "social", line: "volleyball", headline: "TONIGHT: HITTING + BLOCKING", email_subject: null, body: "First session tonight.", programs: [], email_blocks: [] };
const appr = { ...mixed, id: 6, status: "approved", week_of: "2026-11-09", scheduled_at: "2026-11-10T12:30:00Z" };
check(core.ruleIssues(mixed, rules).length === 1 && core.ruleIssues(fine, rules).length === 0, `ruleIssues (one line per rule broken): ${core.ruleIssues(mixed, rules).join(" | ")}`);
const sb = fakeSupabase({ mkt_settings: [{ id: 1, ...core.SETTINGS_DEFAULTS }], mkt_priorities: [PARTIES], mkt_items: [mixed, fine, appr], mkt_photos: [], mkt_log: [], mkt_ideas: [], mkt_videos: [], mkt_spotlights: [] });
const who = { me: "drew@drippingsportsclub.com", name: "Drew" };
const saved = await run(sb, who, { action: "settings_save", patch: { rules: [{ text: RULE, apart }, { text: "  " }] } });
check(saved.settings.rules.length === 1 && saved.settings.rules[0].apart?.[1]?.[0] === "parties" && saved.settings.rules[0].id, "settings_save keeps the rule (an id, its sides), drops an empty one");
const interp = await run(sb, who, { action: "rule_interpret", text: RULE });
check(JSON.stringify(interp.apart) === JSON.stringify(apart), "rule_interpret without Claude falls back to the keyword reading");
const chk = await run(sb, who, { action: "rules_check" });
check(chk.items.map(i => i.id).sort().join() === "4,6" && chk.items.find(i => i.id === 6).status === "approved", `rules_check finds the mixed draft and the approved one (${chk.items.map(i => `#${i.id} ${i.status}`).join(", ")})`);
const redo = await run(sb, who, { action: "rules_redo", ids: [4, 5, 6] });
check(redo.removed === 1 && !sb.db.mkt_items.some(i => i.id === 4) && sb.db.mkt_items.some(i => i.id === 5) && sb.db.mkt_items.some(i => i.id === 6), "rules_redo drops only the breaking draft (not the fine one, not the approved one)");
const newEmail = redo.items.find(i => i.kind === "roundup");
check(redo.items.length === 1 && newEmail && !core.ruleIssues(newEmail, sb.db.mkt_settings[0].rules).length, `one new draft in its place - a roundup that follows the rules (${newEmail?.email_subject}; programs: ${(newEmail?.programs || []).map(p => p.line).join(", ") || "none"}, closing with ${(newEmail?.email_blocks || []).find(b => b.line)?.line || "-"})`);

console.log("\n== reels ==");
const V = await import("../api/_lib/marketing-video.js");
const vids = [
  { id: 1, line: "volleyball", status: "ready", active: true, release_ok: true, created_at: "2026-11-01T00:00:00Z", moments: [{ id: "m1", start: 1, end: 4, score: 9, label: "Dig" }] },
  { id: 2, line: "parties", status: "ready", active: true, release_ok: true, created_at: "2026-11-01T00:00:00Z", moments: [{ id: "m1", start: 1, end: 4, score: 8, label: "Cake" }] },
  { id: 3, line: "basketball", status: "ready", active: true, release_ok: true, created_at: "2026-11-01T00:00:00Z", moments: [{ id: "m1", start: 1, end: 4, score: 7, label: "Three" }] },
];
const vsb = fakeSupabase({ mkt_videos: vids, mkt_items: [], mkt_music: [] });
const err = await V.createReel(vsb, { picks: [{ video_id: 1, moment_id: "m1" }, { video_id: 2, moment_id: "m1" }], settings: { rules }, today: "2026-11-02" }).catch(e => e.message);
check(/mix Volleyball and Birthday parties/.test(err) && /Make two reels/.test(err), `picked clips that mix them are refused: ${err}`);
const auto = await V.createReel(vsb, { settings: { rules }, today: "2026-11-02" });
check(auto.video.clips.map(c => c.video_id).sort().join() === "1,3", `"best of" keeps the best clip's side: videos ${auto.video.clips.map(c => c.video_id).join(", ")}`);

console.log(`\n${fails ? fails + " FAILED" : "all checks passed"}`);
process.exit(fails ? 1 : 0);
