// SportsEngine's member export → per-player SportsEngine status.
//
// Lone Star Region memberships run through SportsEngine, and the org's
// member export (Name, Profile Status, Email, Phone, City, SportsEngine ID,
// Date Of Birth) is the record of who has a profile with the club. Coaches
// are in it too; only rows that match a player are used here.
//
// Shared by the Tracker tab's upload button (src/App.jsx) and the CLI
// (scripts/import-sportsengine.mjs). Matching is shared/name-match.js, with
// the profile email as the tie-breaker (it is the parent's email).

import { matchPlayer } from "./name-match.js";

const col = (r, ...names) => { for (const n of names) { for (const k of Object.keys(r)) { if (k.trim().toLowerCase() === n.toLowerCase()) return String(r[k] ?? "").trim(); } } return ""; };

// Papa-parsed rows (header: true) → member rows.
export function parseSportsEngineRows(rows) {
  const out = [];
  for (const r of rows || []) {
    const name = col(r, "Name");
    if (!name) continue;
    out.push({
      name: name.replace(/\s+/g, " "),
      status: col(r, "SportsEngine Profile: Profile Status", "Profile Status") || null,
      email: col(r, "SportsEngine Profile: Email", "Email").toLowerCase() || null,
      phone: col(r, "SportsEngine Profile: Phone", "Phone") || null,
      sportsengine_id: col(r, "SportsEngine Profile: SportsEngine ID", "SportsEngine ID") || null,
      dob: col(r, "SportsEngine Profile: Date Of Birth", "Date Of Birth") || null,
      player_id: null, match_note: null,
    });
  }
  return out;
}

// A profile born before this is a parent or coach, never a player — the
// oldest age group is 16s. Without it, "Kristen Alexandrov" would mark her
// daughter Avery registered on the strength of a shared surname.
const ADULT_BEFORE = "2006-01-01";
const isAdult = (dob) => /^\d{4}-\d{2}-\d{2}$/.test(dob || "") && dob < ADULT_BEFORE;

// Attach player ids. Rows that match nobody are usually coaches or parents.
export function matchMembersToPlayers(members, players) {
  let matched = 0;
  for (const m of members) {
    if (isAdult(m.dob)) { m.player_id = null; m.match_note = "adult (born " + m.dob.slice(0, 4) + ")"; continue; }
    const { player, note } = matchPlayer(m.name, players, { email: m.email, strict: true });
    m.player_id = player ? player.id : null;
    m.match_note = note;
    if (player) matched++;
  }
  return { matched, unmatched: members.filter(m => !m.player_id) };
}

// The patch to write on each matched player.
export const playerPatchFor = (m, stamp) => ({
  sportsengine_registered: true,
  sportsengine_id: m.sportsengine_id,
  sportsengine_status: m.status,
  sportsengine_synced_at: stamp,
});
