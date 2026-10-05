// One day of DS Elite practice, hour by hour: which teams are on, which coaches
// are actually on the floor with each one, and what's wrong.
//
// Used by api/day-schedule.js for both the "Day Schedule" screen and the
// Saturday email of Sunday's schedule, so the two can never disagree. The
// rules mirror the Practice → Daily board in src/App.jsx:
//   • phase comes from the date (Summer / Fall 1 / Fall 2 / Season / Post);
//     preseason practices only run on the listed Sundays
//   • practice_slot_moves move a team to another block for one date
//   • practice_cancellations: whole day (team_name empty) or one team
//   • a team at a multi-day (or locked) tournament that weekend has no Sunday
//     practice; a coach on a tournament's staff that day is away
//   • practice_coverage marks a coach out, with a sub or a combined practice
//   • an approved coach_request for the date is a call-out
//   • two of a team's own coaches on the floor is the minimum (third coach
//     covers an absence without a sub)
// Event teams (0 practices/week, e.g. 14 Crystal) never appear.

import { TN_SUB_PLACEHOLDERS } from "./dssc-clinics.js";
import { isEventTeam } from "./event-teams.js";

export const MIN_STAFF = 2;
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PRESEASON_DATES = {
  summer: ["2026-07-12", "2026-07-19", "2026-07-26", "2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23", "2026-08-30", "2026-09-06"],
  fall1: ["2026-09-13", "2026-09-20", "2026-09-27", "2026-10-04", "2026-10-11"],
  fall2: ["2026-10-18", "2026-10-25", "2026-11-01", "2026-11-08", "2026-11-15"],
};
const PHASE_LABEL = { summer: "Summer", fall1: "Fall 1", fall2: "Fall 2", season: "Regular Season", postseason: "Post Season" };
// Same cut-overs as the Daily board.
export const phaseForDate = (iso) => iso >= "2027-05-07" ? "postseason" : iso >= "2026-11-29" ? "season" : iso >= "2026-10-18" ? "fall2" : iso >= "2026-09-13" ? "fall1" : "summer";
const isPracticeDay = (iso, ph) => {
  if (ph === "season" || ph === "postseason") return iso >= "2026-11-29" && iso <= "2027-06-15";
  return (PRESEASON_DATES[ph] || []).includes(iso);
};

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
// "Kelli R Hardge" and "Kelli Hardge" are one person.
// Requests get typed as "Coach Tara Fisher" or just "Karissa".
export const personKey = (s) => { const p = norm(s).replace(/^coach\s+/, "").split(" ").filter(Boolean); return p.length >= 3 ? p[0] + " " + p[p.length - 1] : p.join(" "); };
export const samePerson = (a, b) => { const x = personKey(a), y = personKey(b); if (!x || !y) return false; if (x === y) return true; return (!x.includes(" ") && y.split(" ")[0] === x) || (!y.includes(" ") && x.split(" ")[0] === y); };
export const isPlaceholder = (s) => { const v = String(s || "").trim(); return !v || TN_SUB_PLACEHOLDERS.has(v.toLowerCase()) || /new coach|floater coach|assistant coach$|head coach$|coach needed/i.test(v); };
const isRealSub = (s) => !!String(s || "").trim() && !isPlaceholder(s);
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

// "5-7pm" → [17, 19]; reads am/pm off the end like the app does.
export const span = (sl) => {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(sl || "");
  if (!m) return [99, 99];
  let s = +m[1] + (+(m[2] || 0)) / 60, e = +m[3] + (+(m[4] || 0)) / 60;
  const h24 = (h) => (h === 12 ? 12 : h >= 9 && h <= 11 ? h : h + 12);
  if (m[5]) { const pm = /p/i.test(m[5]); const fx = (h, p) => (h % 12) + (p ? 12 : 0); e = fx(e, pm); s = fx(s, pm); if (s >= e) s = fx(s, !pm); }
  else { s = h24(Math.floor(s)) + (s % 1); e = h24(Math.floor(e)) + (e % 1); }
  return [s, e];
};
const hr12 = (h) => { const w = Math.floor(h), mm = Math.round((h - w) * 60); const x = w % 12 === 0 ? 12 : w % 12; return x + (mm ? ":" + String(mm).padStart(2, "0") : ""); };
export const fmtSpan = (s, e) => hr12(s) + (s < 12 && e >= 12 ? "am" : "") + "–" + hr12(e) + (e >= 12 ? "pm" : "am");
export const hourLabel = (h) => hr12(h) + (h >= 12 ? "pm" : "am");

// Merge back-to-back / overlapping [s,e] pieces.
const mergeSpans = (list) => {
  const out = [];
  for (const [s, e] of list.slice().sort((a, b) => a[0] - b[0])) {
    const p = out[out.length - 1];
    if (p && s <= p[1]) p[1] = Math.max(p[1], e); else out.push([s, e]);
  }
  return out;
};

// Everything the day needs, in one round of queries.
export async function loadDayFacts(sb, date) {
  const ph = phaseForDate(date);
  const fri = (() => { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 2); return d.toISOString().slice(0, 10); })();
  const q = (p) => p.then(r => { if (r.error) throw new Error(r.error.message); return r.data || []; });
  const [teams, assigns, moves, cancels, cover, reqs, floats, sas, nights, tns] = await Promise.all([
    q(sb.from("practice_teams").select("team_name, head_coach, assistant_coach, third_coach, practices_per_week, level")),
    q(sb.from("practice_assignments").select("team_name, phase, day, slot, court, venue")),
    q(sb.from("practice_slot_moves").select("practice_date, team_name, slot").eq("practice_date", date)),
    q(sb.from("practice_cancellations").select("practice_date, team_name, reason").eq("practice_date", date)),
    q(sb.from("practice_coverage").select("practice_date, team_name, slot, phase, coach_out, sub_name, combine_with_team, note").eq("practice_date", date)),
    q(sb.from("coach_requests").select("coach_name, request_date, team_name, status, type, details").gte("request_date", fri).lte("request_date", date)),
    q(sb.from("coach_floats").select("coach_name, day, slot, phase")),
    q(sb.from("sa_sessions").select("team_name, session_date, slot").eq("session_date", date)),
    q(sb.from("orientation_nights").select("night_date, label, ages, teams, start_time, end_time, cancelled").eq("night_date", date)),
    q(sb.from("tournaments").select("id, name, start_date, end_date, cancelled").lte("start_date", date).gte("end_date", fri)),
  ]);
  const tnIds = tns.map(t => t.id);
  const tas = tnIds.length ? await q(sb.from("tournament_assignments").select("tournament_id, team_id, status, head_override, asst_override, sub_coach").in("tournament_id", tnIds)) : [];
  return { date, ph, fri, teams, assigns, moves, cancels, cover, reqs, floats, sas, nights, tns, tas };
}

export function buildDaySchedule(f) {
  const { date, ph, fri } = f;
  const weekday = WD[new Date(date + "T12:00:00Z").getUTCDay()];
  const teamBy = new Map(f.teams.map(t => [t.team_name, t]));
  const eventTeams = new Set(f.teams.filter(isEventTeam).map(t => t.team_name));
  const dayCancel = f.cancels.find(c => !c.team_name);
  const teamCancel = new Map(f.cancels.filter(c => c.team_name).map(c => [c.team_name, c.reason || ""]));
  const practiceDay = isPracticeDay(date, ph);
  const issues = [];
  const out = {
    date, weekday, phase: ph, phaseLabel: PHASE_LABEL[ph] || ph, practiceDay,
    cancelled: dayCancel ? (dayCancel.reason || "Cancelled") : null,
    teams: [], coaches: [], floaters: [], sa: [], offTeams: [], hours: [], issues,
  };

  // Tournaments: a team at a multi-day or locked event that weekend skips its
  // Sunday practice; anyone on a tournament's staff today is away.
  const tnBy = new Map(f.tns.filter(t => !t.cancelled).map(t => [t.id, t]));
  const atTournament = new Map();  // team → tournament name
  const away = new Map();          // personKey → tournament name
  const rostered = new Set(f.teams.flatMap(t => [t.head_coach, t.assistant_coach]).filter(Boolean).map(personKey));
  for (const a of f.tas) {
    const tn = tnBy.get(a.tournament_id); if (!tn || a.status === "dropped") continue;
    if (weekday === "Sun" && tn.start_date <= date && tn.end_date >= fri && (tn.end_date > tn.start_date || a.status === "locked")) atTournament.set(a.team_id, tn.name);
    if (tn.start_date <= date && tn.end_date >= date) {
      const team = teamBy.get(a.team_id) || {};
      for (const [ov, def] of [[a.head_override, team.head_coach], [a.asst_override, team.assistant_coach]]) {
        const who = ov || def; if (!who || isPlaceholder(who)) continue;
        const isSub = !!(ov && ov !== def);
        // A coach swapped onto another team's tournament keeps her own Sunday
        // practice as the priority (same rule as the Daily board).
        if (isSub && rostered.has(personKey(who))) continue;
        away.set(personKey(who), tn.name);
      }
      // An extra coach going with the team (sub_coach — e.g. Rene Sandoval as
      // 12 Diamond's third coach) is travelling: away from every practice.
      if (a.sub_coach && !isPlaceholder(a.sub_coach)) away.set(personKey(a.sub_coach), tn.name);
    }
  }

  if (out.cancelled) { issues.push({ level: "info", text: `Whole day cancelled — ${out.cancelled}` }); return out; }

  // Which teams practice when today.
  const moveFor = new Map(f.moves.map(m => [m.team_name, m.slot]));
  const rows = practiceDay ? f.assigns.filter(a => (a.phase || "fall1") === ph && a.day === weekday && !eventTeams.has(a.team_name)) : [];
  const byTeam = new Map();
  for (const a of rows) {
    if (!byTeam.has(a.team_name)) byTeam.set(a.team_name, { slots: new Set(), venue: a.venue || "", court: a.court });
    byTeam.get(a.team_name).slots.add(moveFor.get(a.team_name) || a.slot);
  }
  // Approved call-outs dated today take the coach off. A weekend request
  // dated Fri/Sat may or may not include Sunday, so it's raised, not applied.
  const todays = f.reqs.filter(r => r.coach_name && r.request_date === date);
  const offFor = (name, team) => { const r = todays.find(r => r.status === "approved" && samePerson(r.coach_name, name) && (!r.team_name || r.team_name === team)); return r ? (clean(r.details) || "time off") : null; };
  const offAnywhere = (name) => todays.some(r => r.status === "approved" && samePerson(r.coach_name, name));
  for (const r of todays) if (r.status === "pending") issues.push({ level: "warn", text: `${r.coach_name} has a PENDING time-off request${r.team_name ? " for " + r.team_name : ""}${r.details ? " (" + clean(r.details) + ")" : ""} — approve or deny it` });
  const earlier = f.reqs.filter(r => r.coach_name && r.request_date < date && r.type === "weekend" && !/denied|declined|rejected|cancel|withdrawn/i.test(r.status || ""));

  for (const [team, info] of [...byTeam.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
    if (atTournament.has(team)) { out.offTeams.push({ team, why: "At " + atTournament.get(team) }); continue; }
    if (teamCancel.has(team)) { out.offTeams.push({ team, why: "Cancelled" + (teamCancel.get(team) ? " — " + teamCancel.get(team) : "") }); continue; }
    const blocks = mergeSpans([...info.slots].map(span).filter(([s, e]) => s < 99 && e > s));
    if (!blocks.length) continue;
    const t = teamBy.get(team) || {};
    const coaches = [];
    for (const [role, raw] of [["Head", t.head_coach], ["Asst", t.assistant_coach], ["3rd", t.third_coach]]) {
      if (role === "3rd" && !raw) continue;
      if (!raw || isPlaceholder(raw)) { coaches.push({ role, name: raw || "", status: "open" }); continue; }
      const cov = f.cover.find(c => c.team_name === team && samePerson(c.coach_out, raw));
      const awayAt = away.get(personKey(raw));
      const off = offFor(raw, team);
      // A sub who is on a tournament's staff that day can't be here either.
      const subAway = cov && isRealSub(cov.sub_name) ? away.get(personKey(cov.sub_name)) : null;
      if (cov) coaches.push({ role, name: raw, status: "out", cov: true, sub: isRealSub(cov.sub_name) && !subAway ? cov.sub_name : null, subPlaceholder: cov.sub_name && !isRealSub(cov.sub_name) ? cov.sub_name : null, combined: cov.combine_with_team || null, why: (subAway ? cov.sub_name + " was the sub but is at " + subAway : "") || cov.note || (awayAt ? "at " + awayAt : off ? off : "") });
      else if (awayAt) coaches.push({ role, name: raw, status: "away", why: "at " + awayAt });
      else if (off) coaches.push({ role, name: raw, status: "out", why: off });
      else coaches.push({ role, name: raw, status: "on" });
    }
    // Who is really on the floor: own coaches present + named subs.
    const floor = [
      ...coaches.filter(c => c.status === "on").map(c => ({ name: c.name, role: c.role })),
      ...coaches.filter(c => c.sub).map(c => ({ name: c.sub, role: "Sub", forWhom: c.name })),
    ];
    const combined = coaches.find(c => c.combined)?.combined || null;
    out.teams.push({ team, level: t.level || "", venue: info.venue, court: info.court, blocks, slots: [...info.slots].sort((a, b) => span(a)[0] - span(b)[0]), coaches, floor, combined });
  }

  // Per-coach timeline (to catch the same person in two places at once).
  const coachMap = new Map();
  const addShift = (name, team, s, e, role) => {
    const k = personKey(name);
    if (!coachMap.has(k)) coachMap.set(k, { name, shifts: [] });
    coachMap.get(k).shifts.push({ team, start: s, end: e, role });
  };
  for (const t of out.teams) for (const [s, e] of t.blocks) for (const p of t.floor) addShift(p.name, t.team, s, e, p.role === "Sub" ? "Sub for " + p.forWhom : p.role);

  // Floaters: only those not out or away, and only for the hours they aren't
  // already coaching a team — a floater picked up as a sub (or on a team's
  // staff) stops floating for those hours.
  for (const fl of f.floats) {
    if ((fl.phase || "season") !== ph || fl.day !== weekday || !practiceDay) continue;
    const k = personKey(fl.coach_name);
    if (away.has(k) || offAnywhere(fl.coach_name)) continue;
    if (f.cover.some(c => samePerson(c.coach_out, fl.coach_name))) continue;
    const [s, e] = span(fl.slot); if (s >= 99) continue;
    const busy = (coachMap.get(k)?.shifts || []).map(x => [x.start, x.end]);
    let free = [[s, e]];
    for (const [bs, be] of busy) free = free.flatMap(([a, b]) => (be <= a || bs >= b) ? [[a, b]] : [[a, Math.min(b, bs)], [Math.max(a, be), b]].filter(([x, y]) => y > x));
    for (const [a, b] of free) out.floaters.push({ name: fl.coach_name, start: a, end: b });
  }
  for (const s of f.sas) if (!teamCancel.has(s.team_name) && !atTournament.has(s.team_name) && !eventTeams.has(s.team_name)) { const [a, b] = span(s.slot); if (a < 99) out.sa.push({ team: s.team_name, start: a, end: b }); }
  for (const n of f.nights) {
    if (n.cancelled) continue;
    const hh = (x) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(x || "")); return m ? +m[1] + (+m[2]) / 60 : null; };
    out.orientation = out.orientation || [];
    out.orientation.push({ label: n.label, start: hh(n.start_time), end: hh(n.end_time) });
  }

  // ── Issues ───────────────────────────────────────────────────────────────
  for (const t of out.teams) {
    const when = t.blocks.map(([s, e]) => fmtSpan(s, e)).join(", ");
    const n = t.floor.length;
    for (const c of t.coaches) {
      if (c.status === "open") issues.push({ level: "warn", team: t.team, text: `${t.team} (${when}): ${c.role === "Head" ? "head coach" : c.role === "Asst" ? "assistant" : "third coach"} spot is unfilled${c.name ? " (" + c.name + ")" : ""}` });
      if ((c.status === "out" || c.status === "away") && !c.sub && !c.combined) {
        const why = c.why ? ` (${c.why})` : "";
        if (n >= MIN_STAFF) issues.push({ level: "info", team: t.team, text: `${t.team} (${when}): ${c.name} is out${why} — still ${n} coaches on the floor` });
        else issues.push({ level: "critical", team: t.team, text: `${t.team} (${when}): ${c.name} is out${why} with NO SUB${c.subPlaceholder ? " (listed as \"" + c.subPlaceholder + "\")" : ""}` });
      }
      if (c.status === "out" && c.combined) issues.push({ level: "info", team: t.team, text: `${t.team} (${when}): ${c.name} out — combined with ${c.combined}` });
      if (c.sub) issues.push({ level: "info", team: t.team, text: `${t.team} (${when}): ${c.sub} subbing for ${c.name}${c.why ? " (" + c.why + ")" : ""}` });
    }
    if (n === 0 && !t.combined) issues.push({ level: "critical", team: t.team, text: `${t.team} (${when}): NO COACH on the floor` });
    else if (n < MIN_STAFF && !t.combined && !t.coaches.some(c => (c.status === "out" || c.status === "away") && !c.sub)) issues.push({ level: "warn", team: t.team, text: `${t.team} (${when}): only ${n} coach on the floor` });
  }
  // The same person in two places at once. Critical only when either team
  // would drop below two without them.
  const teamOf = new Map(out.teams.map(t => [t.team, t]));
  for (const c of coachMap.values()) {
    const sh = c.shifts.slice().sort((a, b) => a.start - b.start);
    for (let i = 0; i < sh.length; i++) for (let j = i + 1; j < sh.length; j++) {
      if (sh[j].team === sh[i].team || sh[j].start >= sh[i].end) continue;
      const s = Math.max(sh[i].start, sh[j].start), e = Math.min(sh[i].end, sh[j].end);
      const short = [sh[i], sh[j]].filter(x => (teamOf.get(x.team)?.floor.length || 0) - 1 < MIN_STAFF).map(x => x.team);
      // If only one team needs them, the fix is obvious: they go there.
      issues.push({ level: short.length === 2 ? "critical" : "warn", text: `${c.name} is double-booked ${fmtSpan(s, e)}: ${sh[i].team} (${sh[i].role}) and ${sh[j].team} (${sh[j].role})` + (short.length === 2 ? " — both teams drop to one coach without them" : short.length === 1 ? ` — should be with ${short[0]}; the other team still has two` : " — both teams still have two without them") });
    }
  }
  // Called out of one team but still listed on another the same day.
  const seen = new Set();
  for (const t of out.teams) for (const c of t.coaches) {
    if (c.status !== "on" || seen.has(personKey(c.name))) continue;
    const elsewhere = out.teams.filter(o => o.team !== t.team && o.coaches.some(x => (x.status === "out" || x.status === "away") && samePerson(x.name, c.name)));
    if (!elsewhere.length) continue;
    seen.add(personKey(c.name));
    issues.push({ level: "warn", team: t.team, text: `${c.name} is out for ${elsewhere.map(o => o.team).join(", ")} but still listed on ${t.team} (${t.blocks.map(([s, e]) => fmtSpan(s, e)).join(", ")}) — confirm they're there` });
  }
  // Weekend requests filed for Fri/Sat that might run into today.
  for (const r of earlier) {
    const onToday = out.teams.filter(t => t.coaches.some(c => c.status === "on" && samePerson(c.name, r.coach_name)));
    if (!onToday.length) continue;
    const wd = WD[new Date(r.request_date + "T12:00:00Z").getUTCDay()];
    issues.push({ level: "warn", text: `${r.coach_name} has a weekend time-off request starting ${wd}${r.details ? " (" + clean(r.details) + ")" : ""} — check it doesn't include ${weekday} (${onToday.map(t => t.team).join(", ")})` });
  }
  const rank = { critical: 0, warn: 1, info: 2 };
  issues.sort((a, b) => rank[a.level] - rank[b.level]);

  out.coaches = [...coachMap.values()].map(c => {
    const sh = c.shifts.slice().sort((a, b) => a.start - b.start);
    const hours = mergeSpans(sh.map(x => [x.start, x.end])).reduce((n, [s, e]) => n + (e - s), 0);
    return { name: c.name, shifts: sh, hours, first: sh[0]?.start ?? 99 };
  }).sort((a, b) => a.first - b.first || a.name.localeCompare(b.name));

  // Hour rows from the first block to the last.
  const all = [...out.teams.flatMap(t => t.blocks), ...out.sa.map(x => [x.start, x.end]), ...out.floaters.map(x => [x.start, x.end])];
  if (all.length) {
    const lo = Math.floor(Math.min(...all.map(x => x[0]))), hi = Math.ceil(Math.max(...all.map(x => x[1])));
    for (let h = lo; h < hi; h++) {
      const on = (s, e) => s < h + 1 && e > h;
      out.hours.push({
        hour: h, label: hourLabel(h) + "–" + hourLabel(h + 1),
        teams: out.teams.filter(t => t.blocks.some(([s, e]) => on(s, e))).map(t => {
          const [s] = t.blocks.find(([s, e]) => on(s, e));
          return { team: t.team, starts: Math.floor(s) === h, crit: issues.some(i => i.team === t.team && i.level === "critical") };
        }),
        sa: out.sa.filter(x => on(x.start, x.end)).map(x => x.team),
        floaters: out.floaters.filter(x => on(x.start, x.end)).map(x => x.name),
      });
    }
  }
  return out;
}

// Each person's day in a few lines — what they'd be texted. Includes the
// teams they're NOT coaching today (and who has it), so marking someone out
// counts as a change to their plan just like adding a shift does.
export function plansFor(day) {
  const plans = new Map();   // personKey → { name, items: [{ start, line }] }
  const add = (name, start, line) => { const k = personKey(name); if (!k) return; if (!plans.has(k)) plans.set(k, { key: k, name, items: [] }); plans.get(k).items.push({ start, line }); };
  for (const c of day.coaches || []) for (const s of c.shifts) add(c.name, s.start, `${fmtSpan(s.start, s.end)} ${s.team}` + (/^Sub for /.test(s.role) ? ` (covering for ${s.role.slice(8)})` : ""));
  for (const t of day.teams || []) for (const c of t.coaches) {
    if (c.status !== "out" && c.status !== "away") continue;
    const when = t.blocks.map(([s, e]) => fmtSpan(s, e)).join(", ");
    add(c.name, t.blocks[0]?.[0] ?? 99, `NOT coaching ${t.team} ${when} — ` + (c.sub ? c.sub + " covering" : c.combined ? "combined with " + c.combined : "no sub yet"));
  }
  const fl = new Map();
  for (const f of day.floaters || []) { const k = personKey(f.name); if (!fl.has(k)) fl.set(k, { name: f.name, spans: [] }); fl.get(k).spans.push([f.start, f.end]); }
  for (const { name, spans } of fl.values()) for (const [s, e] of mergeSpans(spans)) add(name, s, `${fmtSpan(s, e)} floating`);
  return [...plans.values()].map(p => ({ key: p.key, name: p.name, body: p.items.sort((a, b) => a.start - b.start).map(i => i.line).join("\n") }));
}

export async function daySchedule(sb, date) { return buildDaySchedule(await loadDayFacts(sb, date)); }
