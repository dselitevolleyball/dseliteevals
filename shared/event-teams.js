// Event teams — a tournament roster, not a team anybody communicates with.
//
// 14 Crystal is the first: nine girls flying to Honolulu, borrowed from
// 13 Diamond, 13 Ruby and 14 Ruby. It has coaches and a tournament, but no
// practices, no families of its own and no season. Every one of its players
// already hears from the club through her home team.
//
// So anything that addresses people BY TEAM skips it. Otherwise it gets
// treated like a real team that has gone quiet: a kickoff party chased that
// will never happen, a daily "14 Crystal hasn't posted on SportsYou" nag to
// its coach, an orientation night for a team with no orientation. Drew asked
// for it to be left out of communications altogether.
//
// Travel is deliberately NOT filtered. The Hawaii trip still has to be booked,
// and that is Kristen's job, not a message to a family.
//
// Zero practices a week is the definition, the same one the roster page uses
// (73ed74a). NULL is not zero — a team whose practice count was never entered
// is a data gap, and silently dropping it from every email would hide the gap
// rather than surface it.
export const isEventTeam = (t) =>
  !!t && t.practices_per_week != null && Number(t.practices_per_week) === 0;
