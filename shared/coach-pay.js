// How a DS Elite shift turns into money.
//
// One implementation, imported by everything that has to agree about it: the
// Monday payroll email to the bookkeeper (api/payroll-report.js) and the
// weekly confirmation each coach gets (api/timecard-summary.js).
//
// This used to live only in the payroll report, with a comment warning that
// the Time Cards ledger had to match it by hand. A third copy for the coach
// email would have been the one that quietly drifted — and a coach being told
// a different number from the one the bookkeeper was sent is worse than not
// telling them at all.
//
// The rules, in order:
//   1. A per-shift rate_override wins outright. It is how a one-off event (a
//      club-wide coach training) pays a rate that has nothing to do with whose
//      team the coach normally covers, and how the DSYSA lead is paid for
//      running a night. It also stands in for a missing coach_rates row, so an
//      override alone is enough to pay someone.
//   2. head_rate, if she head-coaches the team the shift is for.
//   3. hourly_rate for everything else — assisting, subbing, floating.
//   4. No rate on file: null, which callers must surface rather than treat as
//      zero. A shift priced at nothing looks paid.

export const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

export function makeRateResolver({ rates = [], teams = [] } = {}) {
  const byName = new Map();
  for (const r of rates) {
    const k = norm(r.coach_name);
    if (k) byName.set(k, r);
  }
  const isHeadOf = (nm, team) =>
    !!team && teams.some(t => t.team_name === team && norm(t.head_coach) === norm(nm));

  return function rateFor(nm, team, override) {
    if (override != null && override !== "") return Number(override);
    const r = byName.get(norm(nm));
    if (!r) return null;
    if (r.head_rate != null && isHeadOf(nm, team)) return Number(r.head_rate);
    return r.hourly_rate != null ? Number(r.hourly_rate) : null;
  };
}

// Turn whatever got typed on a shift into the person's real name.
//
// Check-ins carry names from half a dozen entry points, so the same coach
// appears as "britneyaparker", "Dillyn", "Kelli R Hardge", "ella hinkle" and
// "Mia de la Rosa". The payroll report has always cleaned this up before
// grouping; the coach's own email needs it more, because the difference
// between grouping wrongly and greeting somebody as "Hi britneyaparker," is
// that the second one is read by the coach.
//
// Email is trusted first — it is the only identifier that is actually unique.
// Then an exact name match, then first-and-last against the known roster, then
// a unique first name. Failing all that, what was typed, cleaned of a leading
// "Coach ".
export function makeNameResolver({ roster = [], teams = [], rates = [] } = {}) {
  const byEmail = new Map();
  for (const r of roster) {
    if (r.email) byEmail.set(norm(r.email), `${r.first_name || ""} ${r.last_name || ""}`.trim());
  }
  const canon = new Map();
  for (const r of roster) {
    const full = `${r.first_name || ""} ${r.last_name || ""}`.trim();
    if (full) canon.set(norm(full), full);
  }
  for (const t of teams) {
    for (const n of [t.head_coach, t.assistant_coach, t.third_coach]) {
      if (n && String(n).trim()) canon.set(norm(n), String(n).trim());
    }
  }
  for (const r of rates) {
    if (r.coach_name) canon.set(norm(r.coach_name), String(r.coach_name).trim());
  }

  return function canonicalName(raw, email) {
    if (email) { const e = byEmail.get(norm(email)); if (e) return e; }
    const base = String(raw || "").replace(/^\s*coach\s+/i, "").trim();
    const n = norm(base);
    if (canon.has(n)) return canon.get(n);
    const toks = n.split(/\s+/).filter(Boolean);
    if (toks.length) {
      const first = toks[0], last = toks[toks.length - 1];
      for (const [k, v] of canon) {
        const kt = k.split(/\s+/), kf = kt[0], kl = kt[kt.length - 1];
        if (kl === last && (kf === first || kf.startsWith(first) || first.startsWith(kf))) return v;
      }
      const firstOnly = [...canon.values()].filter(v => norm(v).split(/\s+/)[0] === first);
      if (firstOnly.length === 1) return firstOnly[0];
    }
    return base || raw;
  };
}

// The Monday-to-Sunday week BEFORE the week that contains `today`. Payroll runs
// on a Monday for the week just finished, and the coach confirmation has to
// describe exactly the same days or the two emails will disagree about which
// week they are talking about.
export function lastPayWeek(todayISO) {
  const d = new Date(todayISO + "T12:00:00Z");
  const dow = d.getUTCDay();                       // 0 Sun … 6 Sat
  const backToMonday = (dow + 6) % 7;              // days since this week's Monday
  const monThis = new Date(d);
  monThis.setUTCDate(d.getUTCDate() - backToMonday);
  const start = new Date(monThis);
  start.setUTCDate(monThis.getUTCDate() - 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export const money = (n) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
