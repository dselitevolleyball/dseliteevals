// DS Elite's own Playbook rentals are courts held for DS Elite on any day, and
// HQ's practice schedule fills them by team name (shared/courts.js dseBlock).
// Run: node scripts/test-court-blocks.mjs
import { buildCourtDay, dseBlock, applyHides } from "../shared/courts.js";

let bad = 0;
const check = (ok, msg) => { console.log((ok ? "PASS  " : "FAIL  ") + msg); if (!ok) bad++; };
const R = (date, courts, start, end, internal = true) => ({ date, courts, start, end, internal, timed: true });
const teams = (slots) => Object.entries(slots).flatMap(([b, ts]) => ts.map((team) => ({ team, blocks: [b === "early" ? [17, 19] : [19, 21]], court: null })));
const day = (date, reservations, bookings, t) => buildCourtDay({ bookings, teams: t, reserved: dseBlock(date, reservations), startHour: 7, endHour: 22 });

// A Tuesday: DS Elite holds Courts 1-4 5-9pm, DS Storm has the Flex.
const tue = "2026-12-08";
const g = day(tue, ["V1", "V2", "V3", "V4"].map((c) => R(tue, [c], 17, 21)),
  [{ courts: ["V5", "V6"], start: 17, end: 20.5, kind: "hold", label: "DS Storm" }],
  teams({ early: ["12 Diamond", "13 Emerald", "13 Ruby"], late: ["13 Sapphire", "14 Diamond", "15 Diamond", "16 Diamond"] }));
check(g.issues.length === 0, "Tuesday: 3 then 4 teams fit DS Elite's four held courts (" + (g.issues.join("; ") || "no issues") + ")");
const at = (h) => g.slots.indexOf(h);
check(["V1", "V2", "V3", "V4"].every((c) => /\d/.test(g.cells[c][at(19.5)].label)), "Tuesday 7:30pm: every held court shows a team name");
check(g.cells.V4[at(17.5)].reserved === true, "Tuesday 5:30pm: the held court no team uses stays held, not free");
check(g.cells.V5[at(17.5)].label === "DS Storm", "the Flex rental is untouched");

// A Monday: DS Elite holds only Courts 1-2; DS Storm has 3-4 until 8pm.
const mon = "2026-12-07";
const m = day(mon, [R(mon, ["V1"], 17, 21), R(mon, ["V2"], 17, 21)],
  [{ courts: ["V3", "V4"], start: 17, end: 20, kind: "hold", label: "DS Storm" },
   { courts: ["V5", "V6"], start: 19, end: 20, kind: "dssc", label: "Shooting Lab" }],
  teams({ early: ["12 Rise 1"], late: ["13 Rise 1", "14 Sapphire", "14 Topaz", "15 Ruby"] }));
check(m.issues.length === 2 && m.issues.every((x) => /not enough free courts/.test(x)), "Monday: four teams on two held courts is a real conflict (" + m.issues.join("; ") + ")");

// Sundays keep their fallback: nothing booked -> the whole Warehouse 1-9pm.
const sun = dseBlock("2026-12-06", []);
check(sun.length === 1 && sun[0].courts.length === 4 && sun[0].start === 13, "Sunday with nothing booked still holds the Warehouse 1-9pm");
check(dseBlock(tue, [R(tue, ["V1"], 17, 21, false)]).length === 0, "another renter's booking isn't DS Elite's");

// Hidden blocks: one date, every week, bookings and DS Elite's held courts.
const storm = { date: mon, courts: ["V3", "V4"], start: 17, end: 20, kind: "hold", label: "DS Storm" };
const held = dseBlock(mon, [R(mon, ["V1"], 17, 21), R(mon, ["V2"], 17, 21)]);
const H = (o) => ({ id: 1, kind: "booking", label: "DS Storm", start_h: 17, end_h: 20, courts: ["V3"], date: mon, weekly: false, ...o });
check(applyHides(mon, { bookings: [storm], reserved: held }, [H()]).bookings.length === 0, "hiding a booking from one of its courts takes the whole booking off");
check(applyHides(mon, { bookings: [storm], reserved: held }, [H({ label: "Aces" })]).bookings.length === 1, "a hide only takes the booking with that label");
const nextMon = "2026-12-14", nextTue = "2026-12-15";
check(applyHides(nextMon, { bookings: [{ ...storm, date: nextMon }] }, [H({ weekly: true })]).bookings.length === 0, "an every-week hide reaches the next Monday");
check(applyHides("2026-11-30", { bookings: [{ ...storm, date: "2026-11-30" }] }, [H({ weekly: true })]).bookings.length === 1, "an every-week hide doesn't reach back before its date");
check(applyHides(nextTue, { bookings: [{ ...storm, date: nextTue }] }, [H({ weekly: true })]).bookings.length === 1, "an every-week Monday hide leaves Tuesday alone");
check(applyHides(nextMon, { bookings: [{ ...storm, date: nextMon }] }, [H()]).bookings.length === 1, "a one-day hide is that day only");
const r2 = applyHides(mon, { reserved: held }, [H({ kind: "dse", label: null, start_h: 17, end_h: 21, courts: ["V1"] })]).reserved;
check(r2.length === 1 && r2[0].courts.join() === "V2", "hiding DS Elite's held Court 1 leaves Court 2 held");
const gh = buildCourtDay({ bookings: [storm], reserved: held, startHour: 7, endHour: 22 });
check(gh.cells.V3[gh.slots.indexOf(17)].hide?.label === "DS Storm" && gh.cells.V1[gh.slots.indexOf(17)].hide?.kind === "dse", "chart cells carry what a hide would match");

console.log(bad ? `\n${bad} failed` : "\nall court block checks passed");
process.exit(bad ? 1 : 0);
