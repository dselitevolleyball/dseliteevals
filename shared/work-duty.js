// Work Duty — fair job rotation for working tournament matches (Oct 2026).
//
// Every work match: one player keeps the score book + VolleyStation all match,
// one tracks the libero all match, and every set needs line judge 1, line
// judge 2, the score flipper and (optionally) a computer scorekeeper. Anyone
// can do any job, so the only rule is fairness across the season:
//
//   for each job, pick the available player who has done THAT job least,
//   then the one with the fewest jobs overall, then the fewest this match,
//   then at random.
//
// Line judge 1 and 2 count as the same job. The two all-match jobs take the
// player out of the set jobs for that match.

export const ROLE_LABEL = { book: "Score book + VolleyStation", libero: "Libero tracker", line: "Line judge", flip: "Score flipper", comp: "Computer scorekeeper" };
export const ROLE_SHORT = { book: "Book/VS", libero: "Libero", line: "Line", flip: "Flip", comp: "Computer" };
export const SET_SLOTS = [["lj1", "line", "Line judge 1"], ["lj2", "line", "Line judge 2"], ["flip", "flip", "Score flipper"], ["comp", "comp", "Computer scorekeeper"]];

// counts[playerId] = { book, libero, line, flip, comp, total } from a list of matches.
export function tally(matches, { onlyDone = false } = {}) {
  const c = {};
  const add = (pid, role) => { if (pid == null) return; const k = String(pid); c[k] = c[k] || { book: 0, libero: 0, line: 0, flip: 0, comp: 0, total: 0 }; c[k][role]++; c[k].total++; };
  for (const m of matches) {
    if (onlyDone && !m.done) continue;
    const a = m.assignments || {};
    add(a.book, "book"); add(a.libero, "libero");
    for (const s of a.sets || []) for (const [slot, role] of SET_SLOTS) add(s[slot], role);
  }
  return c;
}

// One match's lineup. players: [{ id }], counts: tally so far (mutated as jobs
// are handed out, so a season can be planned match after match).
export function planMatch({ players, counts, sets = 3, computer = false, out = [], rand = Math.random }) {
  const outSet = new Set(out.map(String));
  const pool = players.map(p => String(p.id)).filter(id => !outSet.has(id));
  const get = (id) => (counts[id] = counts[id] || { book: 0, libero: 0, line: 0, flip: 0, comp: 0, total: 0 });
  const thisMatch = {};
  const jitter = new Map(pool.map(id => [id, rand()]));
  const pick = (role, exclude) => {
    const cand = pool.filter(id => !exclude.has(id));
    if (!cand.length) return null;
    cand.sort((a, b) => get(a)[role] - get(b)[role] || get(a).total - get(b).total || (thisMatch[a] || 0) - (thisMatch[b] || 0) || jitter.get(a) - jitter.get(b));
    const id = cand[0];
    get(id)[role]++; get(id).total++; thisMatch[id] = (thisMatch[id] || 0) + 1;
    return id;
  };
  const book = pick("book", new Set());
  const libero = pick("libero", new Set([book]));
  const allMatch = new Set([book, libero].filter(Boolean));
  const setRows = [];
  for (let i = 0; i < sets; i++) {
    const used = new Set(allMatch);
    const row = {};
    for (const [slot, role] of SET_SLOTS) {
      if (slot === "comp" && !computer) continue;
      row[slot] = pick(role, used);
      if (row[slot]) used.add(row[slot]);
    }
    setRows.push(row);
  }
  return { book, libero, sets: setRows, out: [...outSet] };
}

// The work matches a team owes: every day of every tournament it's entered in.
export function workSlots(tournamentDays, perDay) {
  const out = [];
  for (const { tournament_id, date } of tournamentDays) for (let seq = 1; seq <= perDay; seq++) out.push({ tournament_id, match_date: date, seq });
  return out;
}
export function daysOf(start, end) {
  const out = [];
  for (let d = new Date(start + "T12:00:00Z"); d.toISOString().slice(0, 10) <= (end || start); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
