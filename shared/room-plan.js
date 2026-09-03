// How many hotel rooms a tournament needs, and who shares with whom.
//
// Stay-to-play weekends make us hold a block before anyone has booked, so the
// number has to be worked out from the roster rather than counted afterwards
// from what people did.
//
// THE RULES
//
//   Players — one room per player's family. A family books its own room, so
//   twelve players attending is twelve rooms, not three. This is the part most
//   easily got wrong by assuming four-to-a-room like a college trip.
//
//   Coaches — two same-sex coaches to a room, EXCEPT a coach whose own child is
//   playing that weekend. She is there as a parent as well as a coach, her
//   family has a room, and pairing her with another coach would put her in the
//   wrong one. So she keeps a room to herself and is never counted as half of
//   a pair.
//
// An odd number of same-sex coaches leaves one on her own — three women is two
// rooms, not one and a half — so each group rounds up independently. Rounding
// the combined total instead would quietly put a man and a woman together.
//
// A coach whose sex is not recorded cannot be paired. She is counted as needing
// a room and named, rather than assumed into one, because the cost of a wrong
// guess is somebody sharing a room they should not be in.

export const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * @param {object}   input
 * @param {string[]} input.players       attending players (any labels; only the count is used)
 * @param {Array}    input.coaches       [{ name, sex: 'F'|'M'|null, hasPlayerHere: boolean }]
 * @returns {object} the plan, with every group named so the UI can show its working
 */
export function planRooms({ players = [], coaches = [] } = {}) {
  // One room per player's family.
  const playerRooms = players.length;

  const own = coaches.filter(c => c.hasPlayerHere);
  const rest = coaches.filter(c => !c.hasPlayerHere);
  const women = rest.filter(c => c.sex === "F");
  const men = rest.filter(c => c.sex === "M");
  const unknown = rest.filter(c => c.sex !== "F" && c.sex !== "M");

  // Each group rounds up on its own — see the note above about why the total
  // must not be rounded instead.
  const womenRooms = Math.ceil(women.length / 2);
  const menRooms = Math.ceil(men.length / 2);
  // Unknown sex cannot be paired with anybody, so each needs a room until
  // somebody records it. Counted high rather than low: a room too many is a
  // cancellation, a room too few is a coach with nowhere to sleep.
  const unknownRooms = unknown.length;
  const ownRooms = own.length;

  const coachRooms = womenRooms + menRooms + unknownRooms + ownRooms;

  return {
    playerRooms,
    coachRooms,
    total: playerRooms + coachRooms,
    breakdown: {
      players: { count: players.length, rooms: playerRooms },
      women: { names: women.map(c => c.name), rooms: womenRooms },
      men: { names: men.map(c => c.name), rooms: menRooms },
      ownRoom: { names: own.map(c => c.name), rooms: ownRooms },
      unknownSex: { names: unknown.map(c => c.name), rooms: unknownRooms },
    },
    // What stops this being a finished answer, in words the UI can print.
    gaps: unknown.length
      ? [`${unknown.length} coach${unknown.length === 1 ? "" : "es"} with no sex recorded — each counted as a room of their own until set: ${unknown.map(c => c.name).join(", ")}`]
      : [],
  };
}

// Pair the coaches up, so the plan can show who is actually sharing rather than
// only how many rooms. Deterministic (sorted by name) so the same weekend does
// not reshuffle every time the page is opened.
export function pairCoaches(coaches = []) {
  const out = [];
  const by = (s) => coaches.filter(c => !c.hasPlayerHere && c.sex === s)
    .slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  for (const group of [by("F"), by("M")]) {
    for (let i = 0; i < group.length; i += 2) {
      out.push(group.slice(i, i + 2).map(c => c.name));
    }
  }
  coaches.filter(c => c.hasPlayerHere)
    .slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .forEach(c => out.push([c.name]));
  coaches.filter(c => !c.hasPlayerHere && c.sex !== "F" && c.sex !== "M")
    .slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .forEach(c => out.push([c.name]));
  return out;
}

// ── Splitting a weekend across more than one hotel ──────────────────────────
//
// Lone Star Classic is the case this exists for: one block is never big enough
// for the whole club, so the rooms get booked at two or three properties. The
// only split that survives contact with a parent is by team — a team's families
// stay together, and its coaches stay with it.
//
// Same rules as above, applied per team. Two things follow from that and are
// worth saying out loud:
//
//   A coach who works two teams that weekend sleeps in ONE room, so she is
//   counted under a single team (the caller decides which — normally the one
//   she heads) and listed as covering the other.
//
//   Splitting can cost a room. Two lone women on different teams share when the
//   club books one hotel and cannot when it books two. That difference is
//   returned as `extra` rather than hidden, because it is a real bill and the
//   alternative — quietly matching the combined number — would leave somebody
//   without a bed on arrival.
export const UNASSIGNED = "Unassigned";

const teamLabel = (x) => String(x?.team || "").trim() || UNASSIGNED;

/**
 * @param {object} input
 * @param {Array}  input.players  [{ team }]  attending players
 * @param {Array}  input.coaches  [{ name, sex, hasPlayerHere, team, alsoTeams }]
 * @returns {object} per-team groups plus what the split costs against one block
 */
export function planRoomsByTeam({ players = [], coaches = [] } = {}) {
  const teams = [...new Set([...players.map(teamLabel), ...coaches.map(teamLabel)])]
    // Unassigned last: it is the leftovers pile, not a team.
    .sort((a, b) => a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : String(a).localeCompare(String(b)));

  const groups = teams.map(team => {
    const tp = players.filter(p => teamLabel(p) === team);
    const tc = coaches.filter(c => teamLabel(c) === team);
    return { team, coaches: tc, ...planRooms({ players: tp, coaches: tc }), pairs: pairCoaches(tc) };
  });

  const combinedTotal = planRooms({ players, coaches }).total;
  const splitTotal = groups.reduce((s, g) => s + g.total, 0);
  return { groups, splitTotal, combinedTotal, extra: splitTotal - combinedTotal };
}
