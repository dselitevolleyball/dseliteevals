// DS Elite's own Playbook rentals are courts held for DS Elite on any day, and
// HQ's practice schedule fills them by team name (shared/courts.js dseBlock).
// Run: node scripts/test-court-blocks.mjs
import { buildCourtDay, dseBlock, applyHides, describeChange, COURTS } from "../shared/courts.js";

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

// Moves: Volleyball 101 off Court 4 (DS Storm's) onto Court 5.
const v101 = { date: mon, courts: ["V4"], start: 17, end: 18, kind: "dssc", label: "Volleyball 101", category: "Beginner Volleyball" };
const mv = { id: 9, action: "move", kind: "booking", label: "Volleyball 101", start_h: 17, end_h: 18, courts: ["V4"], to_courts: ["V5"], to_start_h: 17, to_end_h: 18, date: mon, weekly: true };
const moved = applyHides(mon, { bookings: [v101] }, [mv]).bookings;
check(moved.length === 1 && moved[0].courts.join() === "V5" && moved[0].origin.courts.join() === "V4", "a moved booking is drawn on its new court and remembers where it was");
check(/Moved in HQ from Court 4, 5pm-6pm/.test(moved[0].category), "the moved block says where it came from (" + moved[0].category + ")");
const gm = buildCourtDay({ bookings: moved, startHour: 7, endHour: 22 });
check(gm.cells.V5[gm.slots.indexOf(17)].change?.id === 9 && !gm.cells.V4[gm.slots.indexOf(17)], "on the chart: Court 5 has it (with its change row), Court 4 is free");
const dm = applyHides(mon, { reserved: held }, [{ id: 3, action: "move", kind: "dse", start_h: 17, end_h: 21, courts: ["V1"], to_courts: ["V1"], to_start_h: 19, to_end_h: 21, date: "2026-11-30", weekly: true }]).reserved;
check(dm.some(r => r.courts.join() === "V1" && r.start === 19) && dm.some(r => r.courts.join() === "V2" && r.start === 17), "DS Elite's Court 1 moved to 7-9pm every Monday; Court 2 unchanged");
check(describeChange(mv).text === "Volleyball 101: move from Court 4, 5pm-6pm to Court 5, 5pm-6pm" && describeChange(mv).when === "Every Monday from Mon, Dec 7", "change log line for a weekly move: " + JSON.stringify(describeChange(mv)));
check(describeChange({ action: "add", kind: "booking", label: "DS Storm", renter: "Tressa Aleshire", courts: ["V5", "V6"], start_h: 17, end_h: 19, date: "2027-01-19" }).text === "Add DS Storm (Tressa Aleshire): Courts 5 + 6, 5pm-7pm", "change log line for an added rental");
check(describeChange(H()).text === "Remove DS Storm: Court 3, 5pm-8pm", "change log line for a hidden booking");

// Sundays: a court per hour, shared courts, a taken court, open held courts, usage.
const sun2 = "2026-11-01";
const SUNT = [
  { team: "11 Diamond", blocks: [[15, 17]], courtAt: [{ s: 15, e: 16, court: 1 }, { s: 16, e: 17, court: 3 }] },
  { team: "12 Diamond", blocks: [[16, 17]], courtAt: [{ s: 16, e: 17, court: 3 }] },
  { team: "13 Ruby", blocks: [[15, 17]], courtAt: [{ s: 15, e: 16, court: 3 }, { s: 16, e: 17, court: 1 }] },
  { team: "14 Topaz", blocks: [[15, 16]], courtAt: [{ s: 15, e: 16, court: 3 }] },
  { team: "15 Ruby", blocks: [[15, 17]], courtAt: [{ s: 15, e: 17, court: 2 }] },
];
const sg = buildCourtDay({ teams: SUNT, reserved: dseBlock(sun2, []), startHour: 7, endHour: 22, releaseHeld: true });
const cAt = (c, h) => sg.cells[c][sg.slots.indexOf(h)];
check(cAt("V1", 15).label === "11 Diamond" && cAt("V3", 16).label.includes("11 Diamond"), "11 Diamond is on Court 1 at 3pm and Court 3 at 4pm, hour by hour");
check(cAt("V3", 15).label === "13 Ruby + 14 Topaz" && cAt("V3", 16).label === "11 Diamond + 12 Diamond", "teams set to the same court share it, both named");
check(sg.issues.length === 0, "no false overlaps (" + (sg.issues.join("; ") || "none") + ")");
check(cAt("V4", 15).open === true && sg.free.V4.some(([a, b]) => a <= 15 && b >= 16), "a held court with no team shows as open, and counts as free");
check(sg.usage.used === 6 && sg.usage.held === 32 && sg.usage.heldUnused === 26, "usage: 6 court-hours used of 32 held (" + JSON.stringify(sg.usage) + ")");
const blockedG = buildCourtDay({ teams: [{ team: "14 Ruby", blocks: [[18, 19]], courtAt: [{ s: 18, e: 19, court: 3 }] }], bookings: [{ courts: ["V3"], start: 18, end: 19, kind: "dssc", label: "Volleyball 101" }], reserved: dseBlock(sun2, []), startHour: 7, endHour: 22 });
check(blockedG.issues.length === 1 && /taken|has it/.test(blockedG.issues[0]) && COURTS.some(c => blockedG.cells[c.id][blockedG.slots.indexOf(18)]?.label === "14 Ruby"), "a team whose court is taken still shows, on an open court, with a note");

// Saturday DS Elite holds are DS Elite Operations: in use with no team on them, and never shown as open.
const opsG = buildCourtDay({ reserved: dseBlock("2026-11-07", [{ date: "2026-11-07", internal: true, courts: ["V3", "V4"], start: 12, end: 19, timed: true }]), startHour: 7, endHour: 22, releaseHeld: true });
check(opsG.usage.used === 14 && opsG.usage.heldUnused === 0 && opsG.cells.V3[opsG.slots.indexOf(12)]?.label === "DS Elite Operations", "Saturday DS Elite hold is DS Elite Operations, counted in use");

console.log(bad ? `\n${bad} failed` : "\nall court block checks passed");
process.exit(bad ? 1 : 0);
