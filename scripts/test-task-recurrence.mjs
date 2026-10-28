// Checks shared/task-recurrence.js and shared/task-meta.js: when repeating
// tasks fall due, what gets created ahead, how they're described, and how a
// finished task counts (on time / late / missed).
// node scripts/test-task-recurrence.mjs
import { occursOn, occurrences, dueToCreate, describeRepeat, nextOccurrence } from "../shared/task-recurrence.js";
import { timeliness } from "../shared/task-meta.js";

let bad = 0;
const check = (ok, msg) => { console.log((ok ? "PASS  " : "FAIL  ") + msg); if (!ok) bad++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Oct 28 2026 is a Wednesday.
const weekdays = { frequency: "daily", weekdays: [1, 2, 3, 4, 5], starts_on: "2026-10-26" };
check(eq(occurrences(weekdays, "2026-10-30", "2026-11-03"), ["2026-10-30", "2026-11-02", "2026-11-03"]), "daily on weekdays skips the weekend");
check(eq(occurrences({ frequency: "daily", weekdays: [], starts_on: "2026-10-28" }, "2026-10-27", "2026-10-29"), ["2026-10-28", "2026-10-29"]), "daily every day, from its start date");

const biweekly = { frequency: "weekly", every_n: 2, weekdays: [1], starts_on: "2026-10-28" };
check(eq(occurrences(biweekly, "2026-10-26", "2026-11-23"), ["2026-11-09", "2026-11-23"]), "every 2 weeks on Monday, counted from the start week (the Monday before the start is skipped)");
check(eq(occurrences({ frequency: "weekly", weekdays: [], starts_on: "2026-10-30" }, "2026-10-28", "2026-11-13"), ["2026-10-30", "2026-11-06", "2026-11-13"]), "weekly with no day picked repeats on the start date's weekday");

check(eq(occurrences({ frequency: "monthly", monthday: 31, starts_on: "2026-10-01" }, "2026-10-01", "2027-03-31"), ["2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31"]), "monthly on the 31st uses the last day of short months");
check(eq(occurrences({ frequency: "monthly", monthday: -1, starts_on: "2026-10-01" }, "2027-02-01", "2027-02-28"), ["2027-02-28"]), "monthly on the last day");
check(eq(occurrences({ frequency: "monthly", monthday: 15, every_n: 3, starts_on: "2026-10-15" }, "2026-10-01", "2027-04-30"), ["2026-10-15", "2027-01-15", "2027-04-15"]), "every 3 months on the 15th");
check(!occursOn({ frequency: "daily", weekdays: [], starts_on: "2026-10-01", ends_on: "2026-10-27" }, "2026-10-28"), "nothing after the end date");

// What gets created now.
const today = "2026-10-28";
check(eq(dueToCreate({ ...weekdays, last_generated_on: "2026-10-27" }, today), ["2026-10-28"]), "a daily repeat makes today's task only");
check(eq(dueToCreate({ frequency: "weekly", weekdays: [1, 4], starts_on: "2026-10-01", last_generated_on: "2026-10-27" }, today), ["2026-10-29", "2026-11-02"]), "a weekly repeat makes the coming week's tasks");
check(eq(dueToCreate({ frequency: "monthly", monthday: 1, starts_on: "2026-10-01", last_generated_on: "2026-10-27" }, today), ["2026-11-01"]), "a monthly repeat is made two weeks out (Nov 1, on Oct 28)");
check(eq(dueToCreate({ frequency: "monthly", monthday: 15, starts_on: "2026-10-01", last_generated_on: "2026-10-27" }, today), []), "...and not before (Nov 15 waits)");
check(eq(dueToCreate({ frequency: "monthly", monthday: 1, starts_on: "2026-10-01", last_generated_on: "2026-11-10" }, today), []), "already made through Nov 10: nothing again");
check(eq(dueToCreate({ ...weekdays, last_generated_on: "2026-10-01" }, today), ["2026-10-26", "2026-10-27", "2026-10-28"]), "a missed run catches up at most 3 days back");
check(eq(dueToCreate({ ...weekdays, last_generated_on: today }, today), []), "running twice the same day makes nothing new");
check(eq(dueToCreate({ ...weekdays, active: false }, today), []), "a stopped repeat makes nothing");
check(nextOccurrence(biweekly, today) === "2026-11-09", "next occurrence of the every-2-weeks repeat");

check(describeRepeat(weekdays) === "Every weekday", "describes weekdays");
check(describeRepeat({ frequency: "weekly", weekdays: [4, 1], every_n: 1 }) === "Weekly on Mon, Thu", "describes weekly days in Monday-first order");
check(describeRepeat(biweekly) === "Every 2 weeks on Mon", "describes every 2 weeks");
check(describeRepeat({ frequency: "monthly", monthday: 1 }) === "Monthly on the 1st" && describeRepeat({ frequency: "monthly", monthday: -1 }) === "Monthly on the last day" && describeRepeat({ frequency: "monthly", monthday: 22 }) === "Monthly on the 22nd", "describes monthly days");

// On time: finished by the end of the due day, Central time.
check(timeliness({ status: "done", due_date: "2026-10-28", completed_at: "2026-10-29T03:30:00Z" }, today) === "on_time", "done at 10:30pm Central on the due date is on time");
check(timeliness({ status: "done", due_date: "2026-10-28", completed_at: "2026-10-29T06:00:00Z" }, today) === "late", "done the next morning is late");
check(timeliness({ status: "skipped", due_date: "2026-10-26" }, today) === "missed", "a skipped repeat is missed");
check(timeliness({ status: "todo", due_date: "2026-10-27" }, today) === "overdue" && timeliness({ status: "todo", due_date: today }, today) === null, "open past its due date is overdue; due today isn't yet");

console.log(bad ? `\n${bad} failed` : "\nall task recurrence checks passed");
process.exit(bad ? 1 : 0);
