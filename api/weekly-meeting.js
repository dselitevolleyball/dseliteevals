// The weekly meeting (Drew, Oct 28 2026): "a screen that highlights the
// criticality of tasks and things we need to discuss during our weekly
// meeting - court discrepancies, lack of programming or overlapping
// programming, things not planned in Playbook that should be by now, class
// expectations, days off from school... things with a collapsing due date".
//
// Everything is worked out from what HQ already has; nothing is typed in.
//
// GET /api/weekly-meeting               the fast part:
//   tasks      overdue, blocked, asking for help, unassigned and due soon, stale;
//              projects whose time is running out faster than their cards are done
//   playbook   the 2027 Planning Calendar (dssc_plan_bookings) against the classes
//              synced from Playbook (dssc_clinics): planned, not in Playbook, and
//              how long until it has to be (6 weeks before the first date)
//   programming  weeks with far fewer classes than usual; two classes on one
//              court at the same time
//   school     school days off coming up with no camps or programming on them
//   classes    classes in the next 10 days with no coach; class plans not approved
//   comms      last week's classes whose families didn't hear from the coach
// GET /api/weekly-meeting?part=courts   the slow part (Playbook's live calendar,
//   about 9 seconds): the court engine over the next 14 days - teams with no
//   free court, bookings on top of each other.
//
// Each item: { id, section, severity: critical|high|watch, title, detail, due,
//   days_left, who, link: { view, params? }, task: { ...a task to make from it } }
// Auth: a DSSC manager's session (same people as Tasks & Projects managers).
import { createClient } from "@supabase/supabase-js";
import { whoIs, centralToday } from "./_lib/projects.js";
import { loadCourtBookings, loadHides } from "./_lib/court-data.js";
import { loadDseCourtInputs } from "../shared/court-inputs.js";
import { buildCourtDay, dseBlock, applyHides, COURTS } from "../shared/courts.js";
import { addDays } from "../shared/task-recurrence.js";
import { moments } from "../shared/marketing-seasons.js";
import { classRows, totals, clock24 } from "../shared/class-comms.js";

export const config = { maxDuration: 60 };

const RANK = { critical: 0, high: 1, watch: 2 };
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
const fmt = (ymd) => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const fmtShort = (ymd) => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const hourLabel = (h) => { const hh = Math.floor(h), m = Math.round((h - hh) * 60), ap = hh >= 12 ? "pm" : "am", h12 = ((hh + 11) % 12) + 1; return h12 + (m ? ":" + String(m).padStart(2, "0") : "") + ap; };
const mondayOf = (ymd) => addDays(ymd, -((new Date(ymd + "T12:00:00Z").getUTCDay() + 6) % 7));
const isOpen = (t) => t.status !== "done" && t.status !== "skipped";

// Plan programs and how to recognise them among the Playbook classes. Programs
// that never go into Playbook as classes (DS Elite, rentals, outside groups) aren't checked.
const PLAN_MATCH = [
  ["Volleyball Clinic", /volleyball clinic|beginner volleyball|volleyball 101/i],
  ["Volleyball Pod", /volleyball pods?\b|\bpod\b/i, "volleyball"],
  ["Volleyball Academy", /volleyball academy/i],
  ["Volleyball Training", /volleyball/i],
  ["Basketball Clinic", /basketball clinic|shooting lab/i],
  ["Basketball Academy", /basketball academy/i],
  ["Summer Camp", /camp/i],
  ["Adult Pick Up", /adult/i],
  ["Heatwave Academy", /heatwave/i],
];
const PLAYBOOK_LEAD = 42;   // a planned program should be in Playbook (registration open) 6 weeks ahead

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const me = await whoIs(sb, req, SUPABASE_SERVICE_ROLE_KEY);
  if (!me || !me.manager) return res.status(403).json({ error: "The weekly meeting screen is for the DSSC directors." });
  res.setHeader("Cache-Control", "no-store");
  const today = centralToday();
  const part = new URL(req.url, "https://x").searchParams.get("part");
  try {
    const items = part === "courts" ? await courtItems(sb, today) : await mainItems(sb, today);
    items.sort((a, b) => RANK[a.severity] - RANK[b.severity] || (a.days_left ?? 999) - (b.days_left ?? 999) || a.title.localeCompare(b.title));
    return res.status(200).json({ ok: true, today, part: part || "main", items, generated_at: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}

// ── The fast part ───────────────────────────────────────────────────────────
async function mainItems(sb, today) {
  const [{ data: tasks }, { data: projects }, { data: series }, { data: clinics }, { data: plan }, { data: msgs }] = await Promise.all([
    sb.from("dssc_project_tasks").select("id, project_id, series_id, title, status, priority, due_date, assignee_email, assignee_name, blocker, help_requested_at, help_note, help_from, last_activity_at, created_at, category, hq_view").in("status", ["todo", "doing", "blocked"]),
    sb.from("dssc_projects").select("id, name, status, start_date, due_date, owner_name, created_at"),
    sb.from("dssc_task_series").select("id, frequency"),
    sb.from("dssc_clinics").select("id, name, sport, category, coach_name, plan_status, sessions"),
    sb.from("dssc_plan_bookings").select("date, program, court, start_slot, slots").gte("date", today).lte("date", addDays(today, 84)),
    sb.from("dssc_class_messages").select("clinic_id, session_id, sent_by, created_at").gte("created_at", addDays(today, -10)),
  ]);
  const items = [];
  const push = (x) => items.push({ days_left: x.due ? daysBetween(today, x.due) : null, ...x });
  const live = new Map((projects || []).filter(p => !["done", "archived"].includes(p.status)).map(p => [p.id, p]));
  const daily = new Set((series || []).filter(s => s.frequency === "daily").map(s => s.id));
  const open = (tasks || []).filter(t => !t.project_id || live.has(t.project_id));
  const where = (t) => (t.project_id ? live.get(t.project_id)?.name + " · " : "");
  const taskLink = (t) => ({ view: "projects", params: { task: t.id, ...(t.project_id ? { project: t.project_id } : {}) } });

  // Tasks
  const missedDaily = new Map(), quiet = new Map();
  for (const t of open) {
    const late = t.due_date && t.due_date < today;
    if (daily.has(t.series_id)) { if (late) missedDaily.set(t.assignee_name || "Not assigned", (missedDaily.get(t.assignee_name || "Not assigned") || 0) + 1); continue; }
    if (t.help_requested_at) push({ id: "help-" + t.id, section: "tasks", severity: "high", title: `🙋 ${t.assignee_name || "Someone"} needs help: ${t.title}`, detail: `${where(t)}"${t.help_note || ""}"`, due: t.due_date, who: t.assignee_name, link: taskLink(t) });
    else if (t.status === "blocked") push({ id: "blocked-" + t.id, section: "tasks", severity: late ? "critical" : "high", title: `⛔ Blocked: ${t.title}`, detail: `${where(t)}${t.blocker ? `Waiting on: ${t.blocker}` : "No blocker written down"}`, due: t.due_date, who: t.assignee_name, link: taskLink(t) });
    else if (late) { const n = daysBetween(t.due_date, today); push({ id: "late-" + t.id, section: "tasks", severity: n > 3 || t.priority === "high" ? "critical" : "high", title: `Overdue ${n}d: ${t.title}`, detail: `${where(t)}${t.status === "doing" ? "In progress" : "Not started"}`, due: t.due_date, who: t.assignee_name || "Not assigned", link: taskLink(t) }); }
    else if (!t.assignee_email && t.due_date && t.due_date <= addDays(today, 14)) push({ id: "unassigned-" + t.id, section: "tasks", severity: "high", title: `Nobody has it: ${t.title}`, detail: `${where(t)}Due ${fmt(t.due_date)}`, due: t.due_date, who: null, link: taskLink(t) });
    else if (t.due_date && t.due_date <= addDays(today, 3) && t.status === "todo") push({ id: "soon-" + t.id, section: "tasks", severity: t.priority === "high" ? "high" : "watch", title: `Due ${t.due_date === today ? "today" : fmt(t.due_date)}, not started: ${t.title}`, detail: where(t).replace(/ · $/, ""), due: t.due_date, who: t.assignee_name, link: taskLink(t) });
    else if (Date.parse(t.last_activity_at || t.created_at) < Date.now() - 10 * 864e5 && !t.series_id) { const k = t.project_id || "solo"; if (!quiet.has(k)) quiet.set(k, []); quiet.get(k).push(t); }
  }
  // Gone quiet: one line per project (and one for standalone tasks).
  for (const [k, list] of quiet) {
    list.sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"));
    const p = k === "solo" ? null : live.get(k), who = [...new Set(list.map(t => t.assignee_name).filter(Boolean))].join(", ");
    push({ id: "quiet-" + k, section: "tasks", severity: "watch", title: `${list.length === 1 ? list[0].title : `${p ? p.name : "Standalone tasks"}: ${list.length} cards`} - no update in 10+ days`,
      detail: list.slice(0, 6).map(t => `${t.title}${t.due_date ? " (due " + fmtShort(t.due_date) + ")" : ""}`).join(" · ") + (list.length > 6 ? "…" : ""), due: list[0].due_date, who: who || null,
      link: p ? { view: "projects", params: { project: p.id } } : taskLink(list[0]) });
  }
  if (missedDaily.size) push({ id: "daily-missed", section: "tasks", severity: "high", title: `Daily repeats not done: ${[...missedDaily.values()].reduce((a, b) => a + b, 0)}`, detail: [...missedDaily].map(([n, k]) => `${n} ${k}`).join(" · "), due: null, link: { view: "projects", params: { tab: "repeating" } } });
  // Projects: is the time running out faster than the work?
  const { data: allCards } = await sb.from("dssc_project_tasks").select("project_id, status, due_date").not("project_id", "is", null);
  for (const p of live.values()) {
    const cards = (allCards || []).filter(c => c.project_id === p.id), total = cards.length, done = cards.filter(c => !isOpen(c)).length;
    const lateCards = cards.filter(c => isOpen(c) && c.due_date && c.due_date < today).length;
    const pct = total ? done / total : 0;
    if (p.due_date) {
      const start = p.start_date || (p.created_at || "").slice(0, 10) || today;
      const span = Math.max(1, daysBetween(start, p.due_date)), used = Math.min(1, Math.max(0, daysBetween(start, today) / span));
      const left = daysBetween(today, p.due_date);
      const behind = used - pct;
      if (left < 0 && pct < 1) push({ id: "proj-" + p.id, section: "tasks", severity: "critical", title: `Project past due: ${p.name}`, detail: `${done} of ${total} done · was due ${fmt(p.due_date)}`, due: p.due_date, who: p.owner_name, link: { view: "projects", params: { project: p.id } } });
      else if (total && (behind > 0.25 || (left <= 14 && pct < 0.7))) push({ id: "proj-" + p.id, section: "tasks", severity: left <= 14 ? "critical" : "high", title: `Running out of time: ${p.name}`, detail: `${Math.round(pct * 100)}% done with ${Math.round(used * 100)}% of the time gone · ${done} of ${total} cards · due ${fmt(p.due_date)}${lateCards ? ` · ${lateCards} overdue` : ""}`, due: p.due_date, who: p.owner_name, link: { view: "projects", params: { project: p.id } } });
    } else if (total && !p.due_date && p.status === "active" && total - done > 0) push({ id: "proj-nodate-" + p.id, section: "tasks", severity: "watch", title: `No deadline set: ${p.name}`, detail: `${total - done} open cards - without dates nothing can show as late`, due: null, who: p.owner_name, link: { view: "projects", params: { project: p.id } } });
  }

  // Classes (Playbook programs synced to HQ), as flat sessions.
  const sessions = [];
  for (const c of clinics || []) for (const s of c.sessions || []) if (s && s.date && !s.cancelled) sessions.push({ c, s, sport: c.sport || "volleyball", start: clock24(s.start_time), end: clock24(s.end_time) });

  // Planned in the 2027 calendar, not in Playbook yet.
  const inPlaybook = (prog, date) => {
    const m = PLAN_MATCH.find(x => x[0] === prog); if (!m) return true;
    const sport = /basketball/i.test(prog) ? "basketball" : /volleyball/i.test(prog) ? "volleyball" : m[2] || null;
    return sessions.some(x => x.s.date === date && (!sport || x.sport === sport) && m[1].test(`${x.c.category || ""} ${x.c.name || ""}`));
  };
  const byProg = new Map();
  for (const b of plan || []) {
    if (!PLAN_MATCH.some(x => x[0] === b.program)) continue;
    if (!byProg.has(b.program)) byProg.set(b.program, new Map());
    byProg.get(b.program).set(b.date, true);
  }
  for (const [prog, dates] of byProg) {
    const missing = [...dates.keys()].sort().filter(d => !inPlaybook(prog, d));
    if (!missing.length) continue;
    const first = missing[0], due = addDays(first, -PLAYBOOK_LEAD), left = daysBetween(today, due);
    const weeks = [...new Set(missing.map(mondayOf))].slice(0, 6).map(w => fmtShort(w)).join(", ");
    push({ id: "plan-" + prog, section: "playbook", severity: left < 0 ? "critical" : left <= 14 ? "high" : "watch",
      title: `${prog}: ${missing.length} planned day${missing.length === 1 ? "" : "s"} not in Playbook yet`,
      detail: `Starts ${fmt(first)} · should be in Playbook by ${fmt(due)}${left < 0 ? ` (${-left} days ago)` : ""} · weeks of ${weeks}${missing.length > 6 ? "…" : ""}`,
      due, link: { view: "dsscplan" }, task: { title: `Put ${prog} into Playbook (from ${fmt(first)})`, due_date: due, category: "Programming", hq_view: "dsscplan" } });
  }

  // Lack of programming: next 6 weeks vs the last 4, per sport.
  const breaks = moments(addDays(today, -1), 60).filter(m => m.kind === "school" || (m.kind === "holiday" && (m.lines || []).some(l => /camp|open_gym/.test(l))));
  for (const sport of ["volleyball", "basketball"]) {
    const count = (w) => sessions.filter(x => x.sport === sport && mondayOf(x.s.date) === w).length;
    const thisMon = mondayOf(today);
    const past = [1, 2, 3, 4].map(i => count(addDays(thisMon, -7 * i)));
    const base = past.reduce((a, b) => a + b, 0) / 4;
    if (base < 4) continue;
    for (let i = 0; i <= 6; i++) {
      const w = addDays(thisMon, 7 * i), n = count(w);
      if (n >= base * 0.5) continue;
      const brk = breaks.find(m => m.start <= addDays(w, 6) && m.end >= w);
      push({ id: `thin-${sport}-${w}`, section: "programming", severity: i <= 2 ? "high" : "watch",
        title: `Week of ${fmtShort(w)}: ${n} ${sport} class${n === 1 ? "" : "es"} (usually ~${Math.round(base)})`,
        detail: brk ? `${brk.name} that week - is that the plan, or a gap to fill (camp, clinic, open gym)?` : "Far fewer than a normal week - is something missing from Playbook?",
        due: w, link: { view: "clinics" }, task: { title: `Fill the ${sport} schedule for the week of ${fmtShort(w)}`, due_date: addDays(w, -14), category: "Programming", hq_view: "clinics" } });
    }
  }
  // Two classes on one court at once.
  const byCourtDay = new Map();
  for (const x of sessions) { if (x.s.date < today || x.s.date > addDays(today, 21) || !x.s.court) continue; const k = x.s.date + "|" + x.s.court; if (!byCourtDay.has(k)) byCourtDay.set(k, []); byCourtDay.get(k).push(x); }
  for (const [k, list] of byCourtDay) {
    list.sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.c.id === b.c.id || b.start >= a.end) continue;
      const [date, court] = k.split("|");
      push({ id: `overlap-${date}-${a.s.id}-${b.s.id}`, section: "programming", severity: daysBetween(today, date) <= 7 ? "critical" : "high",
        title: `Overlap on ${court}: ${fmt(date)}`, detail: `${a.c.name} (${a.s.start_time}-${a.s.end_time}) and ${b.c.name} (${b.s.start_time}-${b.s.end_time})`, due: date, link: { view: "courts", params: { date } } });
    }
  }

  // School days off coming up.
  for (const m of moments(today, 70).filter(m => (m.kind === "school" || m.kind === "holiday") && (m.lines || []).some(l => /camp_elevate|open_gym/.test(l)))) {
    const inRange = sessions.filter(x => x.s.date >= m.start && x.s.date <= m.end);
    const camps = inRange.filter(x => /camp/i.test(`${x.c.category || ""} ${x.c.name}`));
    if (camps.length) continue;
    const due = addDays(m.start, -28), left = daysBetween(today, due);
    push({ id: "school-" + m.key, section: "school", severity: left < 0 ? "high" : left <= 14 ? "high" : "watch",
      title: `${m.name} (${fmtShort(m.start)}${m.end !== m.start ? "-" + fmtShort(m.end) : ""}): ${inRange.length ? "no camps on the schedule" : "nothing on the schedule"}`,
      detail: `${m.idea}${m.approx ? " (school dates approximate - check the DSISD calendar)" : ""} · ${inRange.length} class${inRange.length === 1 ? "" : "es"} that week · decide and market it by ${fmt(due)}`,
      due, link: { view: "clinics" }, task: { title: `Plan programming for ${m.name}`, due_date: due, category: "Programming", hq_view: "dsscplan" } });
  }

  // Classes in the next 10 days with no coach; class plans not approved.
  const soon = sessions.filter(x => x.s.date >= today && x.s.date <= addDays(today, 10));
  const noCoach = new Map();
  for (const x of soon) {
    const staffed = (x.s.staff || []).some(st => st && st.status !== "declined" && st.name) || x.s.coach_name || x.c.coach_name;
    if (staffed && !x.s.needsCoverage) continue;
    if (!noCoach.has(x.c.id)) noCoach.set(x.c.id, { c: x.c, dates: [] });
    noCoach.get(x.c.id).dates.push(x.s.date);
  }
  // One line per sport: which classes, which dates.
  for (const sport of ["volleyball", "basketball"]) {
    const list = [...noCoach.values()].filter(x => (x.c.sport || "volleyball") === sport).map(x => ({ ...x, dates: x.dates.sort() })).sort((a, b) => a.dates[0].localeCompare(b.dates[0]));
    if (!list.length) continue;
    const first = list[0].dates[0], n = list.reduce((a, x) => a + x.dates.length, 0);
    push({ id: "coach-" + sport, section: "classes", severity: daysBetween(today, first) <= 3 ? "critical" : "high",
      title: `${sport[0].toUpperCase() + sport.slice(1)}: ${n} class${n === 1 ? "" : "es"} in the next 10 days with no coach in HQ`,
      detail: list.slice(0, 8).map(x => `${x.c.name} (${x.dates.map(fmtShort).join(", ")})`).join(" · ") + (list.length > 8 ? ` · and ${list.length - 8} more` : ""),
      due: first, link: { view: "dssccal" }, task: { title: `Assign coaches to ${sport} classes without one`, due_date: first, category: "Programming", hq_view: "dssccal" } });
  }
  const week = sessions.filter(x => x.s.date >= today && x.s.date <= addDays(today, 7));
  const unplanned = [...new Set(week.filter(x => x.c.plan_status !== "approved").map(x => x.c.id))];
  if (unplanned.length) push({ id: "plans", section: "classes", severity: unplanned.length > 5 ? "high" : "watch",
    title: `${unplanned.length} of ${new Set(week.map(x => x.c.id)).size} programs running this week have no approved class plan`,
    detail: (clinics || []).filter(c => unplanned.includes(c.id)).slice(0, 6).map(c => c.name).join(" · ") + (unplanned.length > 6 ? "…" : ""), due: null, link: { view: "clinics" } });

  // Class comms, last 7 days.
  for (const sport of ["volleyball", "basketball"]) {
    const rows = classRows({ clinics: clinics || [], messages: msgs || [], from: addDays(today, -7), to: addDays(today, -1), sport });
    const t = totals(rows);
    if (!t.classes || t.messaged / t.classes >= 0.8) continue;
    const none = new Map(); for (const r of rows) if (r.state === "none") none.set(r.lead, (none.get(r.lead) || 0) + 1);
    push({ id: "comms-" + sport, section: "comms", severity: t.messaged / t.classes < 0.5 ? "high" : "watch",
      title: `${sport[0].toUpperCase() + sport.slice(1)}: ${t.messaged} of ${t.classes} classes last week got a message to families`,
      detail: `Before class ${t.before} · after ${t.after} · no message from: ${[...none].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, k]) => `${n} (${k})`).join(", ")}`, due: null, link: { view: "classcomms" } });
  }
  return items;
}

// ── The slow part: the court engine, next 14 days ───────────────────────────
async function courtItems(sb, today) {
  const end = addDays(today, 14);
  const dates = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const [{ bookings, reservations }, dse, hides] = await Promise.all([loadCourtBookings(sb, today, end), loadDseCourtInputs(sb, dates), loadHides(sb, today, end)]);
  const items = [];
  // The same clash every week is one line, with its dates.
  const clashes = new Map();
  const issuesSeen = new Map();   // issue text -> dates
  for (const d of dates) {
    const x = dse[d] || { teams: [], scrims: [], tourn: [] };
    const shown = applyHides(d, { bookings: bookings.filter(b => b.date === d), reserved: dseBlock(d, reservations) }, hides);
    const g = buildCourtDay({ bookings: shown.bookings.map(b => ({ courts: b.courts, start: b.start, end: b.end, kind: b.kind, label: b.label })).concat(x.tourn || []), teams: x.teams, scrims: x.scrims, reserved: shown.reserved, startHour: 7, endHour: 22 });
    for (const issue of g.issues) { if (!issuesSeen.has(issue)) issuesSeen.set(issue, []); issuesSeen.get(issue).push(d); }
    // Two bookings in the same place at the same time.
    for (const c of COURTS) {
      let run = null;
      g.cells[c.id].forEach((cell, i) => {
        const key = cell && cell.conflict ? [cell.label, ...(cell.also || [])].sort().join(" + ") : null;
        if (key && run && run.key === key) { run.end = g.slots[i] + 0.5; return; }
        if (run) addClash(run, d, c);
        run = key ? { key, start: g.slots[i], end: g.slots[i] + 0.5 } : null;
      });
      if (run) addClash(run, d, c);
    }
  }
  function addClash(run, d, c) {
    const k = run.key + "|" + run.start + "|" + run.end;
    if (!clashes.has(k)) clashes.set(k, { ...run, dates: new Set(), courts: new Set() });
    const x = clashes.get(k); x.dates.add(d); x.courts.add(c.label || c.id);
  }
  for (const [issue, ds] of issuesSeen) items.push({ id: `court-${issue}`, section: "courts", severity: daysBetween(today, ds[0]) <= 3 ? "critical" : "high", title: issue + (ds.length > 1 ? ` (${ds.length} days)` : ""), detail: `Court Availability can't fit this as booked · ${ds.map(fmt).join(", ")}`, due: ds[0], days_left: daysBetween(today, ds[0]), link: { view: "courts", params: { date: ds[0] } } });
  for (const x of clashes.values()) {
    const ds = [...x.dates].sort(), first = ds[0];
    items.push({ id: `clash-${x.key}-${x.start}`, section: "courts", severity: daysBetween(today, first) <= 3 ? "critical" : "high",
      title: `Double-booked ${[...x.courts].join(" & ")}, ${hourLabel(x.start)}-${hourLabel(x.end)}${ds.length > 1 ? `, ${ds.length} days` : ""}`,
      detail: `${x.key} · ${ds.map(fmt).join(", ")}`, due: first, days_left: daysBetween(today, first), link: { view: "courts", params: { date: first } } });
  }
  return items;
}
