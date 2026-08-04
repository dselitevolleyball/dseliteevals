// The club season runs 1 August to 31 July.
//
// So anything bought from 2026-08-01 belongs to 2026-27, and every tournament
// from December 2026 through June 2027 is 2026-27 as well — both of Drew's
// rules fall out of the same boundary.
//
// Kept in one place because it was previously a hardcoded "2026-27" default in
// the receipt parser, which would have quietly mislabelled everything captured
// after 31 July 2027 and only shown up as a season total that looked wrong.

export const SEASON_START_MONTH = 8;   // August

export function seasonForDate(iso) {
  const d = String(iso || "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return null;
  const year = +m[1], month = +m[2];
  const start = month >= SEASON_START_MONTH ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

// An expense tied to a tournament belongs to that tournament's season, even
// when it was paid in the previous one — entries for a December event are often
// bought in July, and the cost belongs against the season the team plays.
export function seasonForExpense({ expenseDate = null, tournamentStart = null } = {}) {
  return seasonForDate(tournamentStart) || seasonForDate(expenseDate) || seasonForDate(new Date().toISOString());
}
