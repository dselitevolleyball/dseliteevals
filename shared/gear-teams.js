// The teams that order DS Elite gear.
//
// One list, imported by all three things that have to agree about it: the
// public order form's team dropdown (api/gear-form.js), the Gear Orders board
// (src/App.jsx), and the send script (scripts/send-gear-form.mjs). Kept apart
// from all three because when they disagree, a family is either emailed a form
// she can't submit — team is required — or chased forever for an order she was
// never meant to place.
//
// Rise teams: 13 Rise 1 added 2026-09-29; 11 and 12 Rise added 2026-10-11
// (Drew: every Rise player does the jersey try-on and gets the order link).
// Adding a team here puts it in the dropdown, on the board, and in the send.
export const GEAR_TEAMS = [
  "16 Diamond",
  "15 Diamond", "15 Ruby", "15 Sapphire", "15 Emerald",
  "14 Diamond", "14 Ruby", "14 Sapphire", "14 Emerald", "14 Topaz",
  "13 Diamond", "13 Ruby", "13 Sapphire", "13 Emerald",
  "12 Diamond", "12 Ruby",
  "11 Diamond",
  "13 Rise 1", "12 Rise 1", "11 Rise 1",
];

// Rise teams don't buy the club shoe (Drew, 12 Oct 2026: "anyone with Rise
// teams don't need to see anything about shoes"). The order form hides every
// shoe question for them and HQ leaves them out of the shoe chase, so both
// ask this one question.
export const isRiseTeam = (team) => /\brise\b/i.test(String(team || ""));
export const ordersShoes = (team) => GEAR_TEAMS.includes(team) && !isRiseTeam(team);
