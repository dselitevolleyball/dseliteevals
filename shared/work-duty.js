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
  // Each set is dealt as a whole: try every way to fill its slots from the
  // players free that set and keep the one that leaves the job counts most
  // even (sum of squares), so nobody drifts two jobs ahead of anyone else.
  const slots = SET_SLOTS.filter(([slot]) => slot !== "comp" || computer);
  const setRows = [];
  for (let i = 0; i < sets; i++) {
    const cand = pool.filter(id => !allMatch.has(id));
    const cost = (id, role) => { const c = get(id); return (c[role] + 1) ** 2 * 100 + (c.total + 1) ** 2 + (thisMatch[id] || 0) * 50 + jitter.get(id); };
    let best = null, bestCost = Infinity;
    const walk = (k, used, acc, sum) => {
      if (sum >= bestCost) return;
      if (k === slots.length) { best = acc.slice(); bestCost = sum; return; }
      const role = slots[k][1];
      const free = cand.filter(id => !used.has(id));
      if (!free.length) { acc.push(null); walk(k + 1, used, acc, sum); acc.pop(); return; }
      for (const id of free) { used.add(id); acc.push(id); walk(k + 1, used, acc, sum + cost(id, role)); acc.pop(); used.delete(id); }
    };
    walk(0, new Set(), [], 0);
    const row = {};
    slots.forEach(([slot, role], k) => { const id = best?.[k] ?? null; row[slot] = id; if (id) { get(id)[role]++; get(id).total++; thisMatch[id] = (thisMatch[id] || 0) + 1; } });
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

// Season balancing. After the matches are dealt one by one, swap two players'
// jobs within a single match (always valid: they just trade everything they
// do that match) whenever it makes every job's counts more even. `locked`
// match indexes (already worked) are never touched. Aims for every player
// within one of every other player on every job.
export function balanceSeason(list, players, { locked = new Set(), iterations = 30000, rand = Math.random } = {}) {
  const ids = players.map(p => String(p.id));
  const roles = ["book", "libero", "line", "flip", "comp", "total"];
  const score = (c) => { let s = 0; for (const r of roles) { const v = ids.map(id => (c[id] || {})[r] || 0); const m = v.reduce((a, b) => a + b, 0) / v.length; s += v.reduce((a, b) => a + (b - m) ** 2, 0) * (r === "total" ? 1 : 3); } return s; };
  const swapIn = (a, x, y) => {
    const sw = (v) => (v === x ? y : v === y ? x : v);
    return { ...a, book: sw(a.book), libero: sw(a.libero), sets: (a.sets || []).map(s => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, sw(v)]))) };
  };
  const free = list.map((_, i) => i).filter(i => !locked.has(i));
  if (!free.length || ids.length < 2) return list;
  let cur = tally(list), best = score(cur);
  for (let it = 0; it < iterations; it++) {
    const i = free[Math.floor(rand() * free.length)];
    const x = ids[Math.floor(rand() * ids.length)], y = ids[Math.floor(rand() * ids.length)];
    if (x === y) continue;
    const out = (list[i].assignments.out || []).map(String);
    if (out.includes(x) || out.includes(y)) continue;
    const before = list[i].assignments, after = swapIn(before, x, y);
    list[i] = { ...list[i], assignments: after };
    const c = tally(list), s = score(c);
    if (s <= best) { best = s; cur = c; } else list[i] = { ...list[i], assignments: before };
  }
  return list;
}

// Deal `n` new generic assignments for a team, fair against everything it has
// already worked (`done`: [{ assignments }]), balanced across the lot.
export function dealAssignments(players, n, { sets = 3, computer = false, done = [], iterations = 20000 } = {}) {
  const counts = tally(done);
  const fresh = Array.from({ length: n }, () => ({ assignments: planMatch({ players, counts, sets, computer }) }));
  const all = balanceSeason([...done.map(d => ({ assignments: d.assignments }))].concat(fresh), players, { locked: new Set(done.map((_, i) => i)), iterations });
  return all.slice(done.length).map(x => x.assignments);
}
