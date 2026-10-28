// Repeating tasks (Drew, Oct 28 2026: "one-off, daily, weekly and monthly
// tasks"). A series (dssc_task_series) says when it repeats; HQ turns each
// occurrence into a task a little ahead of its due date (api/_lib/tasks.js).
// Shared by the server and the Tasks screen so both describe it the same way.
//
//   daily    weekdays it runs on (empty = every day)
//   weekly   weekdays, every_n weeks counted from the week of starts_on
//   monthly  monthday 1-31 (a short month uses its last day) or -1 = the last
//            day, every_n months counted from starts_on's month
// Dates are YYYY-MM-DD in Central time; nothing here looks at the clock.

export const FREQUENCIES = [["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// How far ahead an occurrence becomes a task: today's daily task, the coming
// week's weekly one, two weeks out for a monthly one.
export const LEAD_DAYS = { daily: 0, weekly: 6, monthly: 13 };

const toDate = (ymd) => new Date(ymd + "T12:00:00Z");
const ymdOf = (d) => d.toISOString().slice(0, 10);
export const addDays = (ymd, n) => { const d = toDate(ymd); d.setUTCDate(d.getUTCDate() + n); return ymdOf(d); };
export const dowOf = (ymd) => toDate(ymd).getUTCDay();
const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0, 12)).getUTCDate();
// Monday of the week a date is in, so "every 2 weeks" lines up by week.
const weekStart = (ymd) => addDays(ymd, -((dowOf(ymd) + 6) % 7));

export function occursOn(s, ymd) {
  if (!s || !ymd || ymd < s.starts_on || (s.ends_on && ymd > s.ends_on)) return false;
  const n = Math.max(1, Number(s.every_n) || 1);
  const days = Array.isArray(s.weekdays) ? s.weekdays.map(Number) : [];
  if (s.frequency === "daily") return !days.length || days.includes(dowOf(ymd));
  if (s.frequency === "weekly") {
    const want = days.length ? days : [dowOf(s.starts_on)];
    if (!want.includes(dowOf(ymd))) return false;
    const weeks = Math.round((toDate(weekStart(ymd)) - toDate(weekStart(s.starts_on))) / (7 * 864e5));
    return weeks % n === 0;
  }
  if (s.frequency === "monthly") {
    const d = toDate(ymd), y = d.getUTCFullYear(), m = d.getUTCMonth(), st = toDate(s.starts_on);
    const months = (y - st.getUTCFullYear()) * 12 + (m - st.getUTCMonth());
    if (months % n !== 0) return false;
    const last = lastDayOfMonth(y, m), want = Number(s.monthday) || st.getUTCDate();
    const day = want === -1 ? last : Math.min(want, last);
    return d.getUTCDate() === day;
  }
  return false;
}

// Every occurrence from `from` to `to`, inclusive (capped, so a bad series can't run away).
export function occurrences(s, from, to, cap = 400) {
  const out = [];
  for (let d = from; d <= to && out.length < cap; d = addDays(d, 1)) if (occursOn(s, d)) out.push(d);
  return out;
}
export function nextOccurrence(s, from, horizon = 400) {
  for (let i = 0, d = from; i <= horizon; i++, d = addDays(d, 1)) if (occursOn(s, d)) return d;
  return null;
}

// "Every weekday", "Weekly on Mon, Thu", "Every 2 weeks on Fri", "Monthly on the 1st", "Monthly on the last day".
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"));
export function describeRepeat(s) {
  if (!s) return "";
  const n = Math.max(1, Number(s.every_n) || 1);
  const days = (Array.isArray(s.weekdays) ? s.weekdays.map(Number) : []).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const list = days.map(d => DAY_SHORT[d]).join(", ");
  if (s.frequency === "daily") {
    if (!days.length || days.length === 7) return "Every day";
    if (days.length === 5 && [1, 2, 3, 4, 5].every(d => days.includes(d))) return "Every weekday";
    return "Daily on " + list;
  }
  if (s.frequency === "weekly") {
    const on = list || DAY_SHORT[dowOf(s.starts_on || "2026-01-05")];
    return (n === 1 ? "Weekly" : `Every ${n} weeks`) + " on " + on;
  }
  if (s.frequency === "monthly") {
    const md = Number(s.monthday) || (s.starts_on ? toDate(s.starts_on).getUTCDate() : 1);
    return (n === 1 ? "Monthly" : `Every ${n} months`) + " on the " + (md === -1 ? "last day" : ordinal(md));
  }
  return "";
}

// The occurrences to create now: from the day after the last one made (never
// more than 3 days back, so a missed run catches up without a flood) to the
// lead window ahead of today.
export function dueToCreate(s, today) {
  if (!s || s.active === false) return [];
  const lead = LEAD_DAYS[s.frequency] ?? 6;
  const floor = addDays(today, -3);
  let from = s.last_generated_on ? addDays(s.last_generated_on, 1) : today;
  if (from < floor) from = floor;
  if (from < s.starts_on) from = s.starts_on;
  const to = addDays(today, lead);
  return from > to ? [] : occurrences(s, from, to);
}
