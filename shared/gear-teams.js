// The teams that order DS Elite gear.
//
// One list, imported by all three things that have to agree about it: the
// public order form's team dropdown (api/gear-form.js), the Gear Orders board
// (src/App.jsx), and the send script (scripts/send-gear-form.mjs). Kept apart
// from all three because when they disagree, a family is either emailed a form
// she can't submit — team is required — or chased forever for an order she was
// never meant to place.
//
// Rise is deliberately absent: the developmental teams don't order this gear.
// Adding a team here puts it in the dropdown, on the board, and in the send.
export const GEAR_TEAMS = [
  "16 Diamond",
  "15 Diamond", "15 Ruby", "15 Sapphire", "15 Emerald",
  "14 Diamond", "14 Ruby", "14 Sapphire", "14 Emerald", "14 Topaz",
  "13 Diamond", "13 Ruby", "13 Sapphire", "13 Emerald",
  "12 Diamond", "12 Ruby",
  "11 Diamond",
];
