// DSSC Tasks (Drew, Oct 28 2026): "a full task tracking application for all of
// my team members" - Jonathan, Hunter, Adrian, Brandon.
//
//   TasksView      every task (standalone and project cards) grouped by person,
//                  category, department, status, due date, project, or a week
//                  calendar; as a board or a list; filtered by person,
//                  category, department, and quick filters (overdue, today,
//                  blocked, needs help, unassigned). A task in several
//                  departments shows under each one.
//   TaskForm       a new task - one-off, or repeating daily / weekly / monthly -
//                  and editing a repeat.
//   RecurringView  the repeating tasks, when each is next due and how often
//                  it's been done on time.
//   Scorecard      per person and per category: open, overdue, blocked, help
//                  asked, done, and the on-time rate for the last 7/30/90 days.
// The data comes from /api/projects bootstrap (src/dssc/Projects.jsx loads it).
import { useMemo, useState } from "react";
import { DS, Btn, Card, Label, inputStyle, Grow } from "./DsscHub.jsx";
import { SMAP, LATE, HELP, isOpen, fmtD, fmtDW, plusDays, Avatar, Due, Modal, chip, Seg, TaskBadges, sel, firstName, Progress } from "./taskKit.jsx";
import { HQ_VIEWS, timeliness } from "../../shared/task-meta.js";
import { FREQUENCIES, DAY_SHORT, describeRepeat, nextOccurrence, dowOf } from "../../shared/task-recurrence.js";

const NONE = "__none";
const mondayOf = (ymd) => plusDays(ymd, -((dowOf(ymd) + 6) % 7));

// ── Tasks ───────────────────────────────────────────────────────────────────
export function TasksView({ boot, api, onOpen, onNew, onChanged, narrow, initialPerson }) {
  const me = boot.me, today = boot.today, st = boot.settings || {};
  // Drew opens on the whole team; everyone else on their own tasks by due date.
  const [groupBy, setGroupBy] = useState(me.owner || initialPerson ? "person" : "due");
  const [layout, setLayout] = useState(narrow ? "list" : "board");
  const [person, setPerson] = useState(initialPerson || (me.owner ? "" : me.email));
  const [cat, setCat] = useState("");
  const [dept, setDept] = useState("");
  const [quick, setQuick] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [q, setQ] = useState("");
  const [week, setWeek] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const people = boot.people;
  const nameOf = (e) => people.find(p => p.email === e)?.name || e;
  const tomorrow = plusDays(today, 1), weekEnd = plusDays(today, 7 - ((dowOf(today) + 6) % 7) - 1), nextWeekEnd = plusDays(weekEnd, 7);
  const weekAgo = plusDays(today, -7);

  const all = boot.tasks || [];
  const involves = (t, e) => t.assignee_email === e || (t.helpers || []).some(h => h.email === e) || t.help_from === e;
  const filtered = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter(t => {
      const open = isOpen(t);
      if (!open && !showDone && groupBy !== "week") return false;
      if (!open && groupBy === "week" && t.status === "skipped") return false;
      if (person === NONE ? t.assignee_email : person && !involves(t, person)) return false;
      if (cat && (t.category || "") !== (cat === NONE ? "" : cat)) return false;
      if (dept && !(dept === NONE ? !(t.departments || []).length : (t.departments || []).includes(dept))) return false;
      if (quick === "overdue" && !(open && t.due_date && t.due_date < today)) return false;
      if (quick === "today" && !(open && t.due_date === today)) return false;
      if (quick === "blocked" && !(open && t.status === "blocked")) return false;
      if (quick === "help" && !(open && t.help_requested_at)) return false;
      if (quick === "unassigned" && !(open && !t.assignee_email)) return false;
      if (quick === "repeating" && !t.series_id) return false;
      if (words.length) { const hay = [t.title, t.project_name, t.category, t.assignee_name, ...(t.departments || []), t.blocker, t.help_note].join(" ").toLowerCase(); if (!words.every(w => hay.includes(w))) return false; }
      return true;
    });
  }, [all, q, showDone, person, cat, dept, quick, groupBy, today]); // eslint-disable-line react-hooks/exhaustive-deps

  // The strip along the top: counts across everything (not the filters).
  const openAll = all.filter(isOpen);
  const scope = person && person !== NONE ? openAll.filter(t => involves(t, person)) : openAll;
  const doneWeek = all.filter(t => t.status === "done" && t.completed_at && t.completed_at.slice(0, 10) >= weekAgo && (!person || person === NONE || involves(t, person)));
  const dueRecent = all.filter(t => t.due_date && t.due_date >= plusDays(today, -30) && t.due_date < today && (!person || person === NONE || involves(t, person)));
  const graded = dueRecent.map(t => timeliness(t, today)).filter(Boolean);
  const onTimePct = graded.length ? Math.round(100 * graded.filter(x => x === "on_time").length / graded.length) : null;
  const STRIP = [
    ["", "Open", scope.length, DS.text],
    ["today", "Due today", scope.filter(t => t.due_date === today).length, DS.lime],
    ["overdue", "Overdue", scope.filter(t => t.due_date && t.due_date < today).length, LATE],
    ["blocked", "Blocked", scope.filter(t => t.status === "blocked").length, DS.orange],
    ["help", "Needs help", scope.filter(t => t.help_requested_at).length, HELP],
    ["unassigned", "Unassigned", openAll.filter(t => !t.assignee_email).length, DS.mut],
  ];

  // Groups for the chosen view. A task can sit in more than one (departments).
  const groups = useMemo(() => {
    const out = new Map();
    const add = (key, label, t, extra = {}) => { if (!out.has(key)) out.set(key, { key, label, items: [], ...extra }); if (t) out.get(key).items.push(t); };
    if (groupBy === "person") {
      const order = person && person !== NONE ? [person] : people.map(p => p.email);
      for (const e of order) if (filtered.some(t => t.assignee_email === e) || (person === e)) add(e, nameOf(e), null, { email: e });
      for (const t of filtered) t.assignee_email ? add(t.assignee_email, t.assignee_name || nameOf(t.assignee_email), t, { email: t.assignee_email }) : add(NONE, "Not assigned", t);
    } else if (groupBy === "category") {
      for (const c of st.categories || []) add(c, c, null);
      for (const t of filtered) add(t.category || NONE, t.category || "No category", t);
    } else if (groupBy === "department") {
      for (const d of st.departments || []) add(d, d, null);
      for (const t of filtered) { const ds = t.departments || []; if (!ds.length) add(NONE, "No department", t); for (const d of ds) add(d, d, t, { cross: ds.length > 1 }); }
    } else if (groupBy === "status") {
      for (const [k] of [["todo"], ["doing"], ["blocked"], ...(showDone ? [["done"], ["skipped"]] : [])]) add(k, SMAP[k].label, null, { color: SMAP[k].color });
      for (const t of filtered) add(t.status, SMAP[t.status].label, t, { color: SMAP[t.status].color });
    } else if (groupBy === "due") {
      const slots = [["late", "Overdue", LATE], ["today", "Today", DS.lime], ["tomorrow", "Tomorrow", DS.lime], ["week", "Rest of this week", DS.text], ["next", "Next week", DS.text], ["later", "Later", DS.mut], ["nodate", "No due date", DS.mut], ["closed", "Done", "#2fbf9b"]];
      for (const [k, l, c] of slots) add(k, l, null, { color: c });
      for (const t of filtered) {
        const d = t.due_date;
        const k = !isOpen(t) ? "closed" : !d ? "nodate" : d < today ? "late" : d === today ? "today" : d === tomorrow ? "tomorrow" : d <= weekEnd ? "week" : d <= nextWeekEnd ? "next" : "later";
        add(k, "", t);
      }
    } else if (groupBy === "project") {
      for (const t of filtered) add(t.project_id || NONE, t.project_name || "Standalone tasks", t);
    } else if (groupBy === "week") {
      const mon = plusDays(mondayOf(today), week * 7);
      if (week === 0) add("late", "Overdue", null, { color: LATE });
      for (let i = 0; i < 7; i++) { const d = plusDays(mon, i); add(d, fmtDW(d), null, { date: d, color: d === today ? DS.lime : undefined }); }
      for (const t of filtered) {
        if (!t.due_date) continue;
        if (week === 0 && t.due_date < mon && isOpen(t)) add("late", "Overdue", t);
        else if (out.has(t.due_date)) add(t.due_date, "", t);
      }
    }
    const list = [...out.values()];
    const sortItems = (a, b) => (isOpen(b) - isOpen(a)) || (a.due_date || "9999").localeCompare(b.due_date || "9999") || (b.priority === "high") - (a.priority === "high") || a.title.localeCompare(b.title);
    for (const g of list) g.items.sort(sortItems);
    if (groupBy === "person") list.sort((a, b) => (a.key === NONE) - (b.key === NONE) || (b.key === me.email) - (a.key === me.email) || b.items.filter(isOpen).length - a.items.filter(isOpen).length || a.label.localeCompare(b.label));
    if (groupBy === "project") list.sort((a, b) => (a.key === NONE) - (b.key === NONE) || a.label.localeCompare(b.label));
    return list.filter(g => g.items.length || ["status", "week"].includes(groupBy) || (groupBy === "person" && g.key === person));
  }, [filtered, groupBy, week, showDone]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDone = async (t) => {
    setBusyId(t.id);
    try { await api("save_task", { task: { id: t.id, status: isOpen(t) ? "done" : "todo" } }); await onChanged(); } catch (e) { window.alert(e.message); }
    setBusyId(null);
  };
  const newIn = (g) => {
    const preset = {};
    if (groupBy === "person" && g.email) preset.assignee_email = g.email;
    if (groupBy === "category" && g.key !== NONE) preset.category = g.key;
    if (groupBy === "department" && g.key !== NONE) preset.departments = [g.key];
    if ((groupBy === "week" && g.date) || (groupBy === "due" && g.key === "today")) preset.due_date = g.date || today;
    if (groupBy === "project" && g.key !== NONE) preset.project_id = g.key;
    onNew(preset);
  };
  const board = layout === "board" && !narrow;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))", gap: 8, marginBottom: 12 }}>
        {STRIP.map(([k, l, n, color]) => (
          <button key={l} onClick={() => setQuick(quick === k ? "" : k)} style={{ textAlign: "left", background: quick === k && k ? color + "1f" : DS.panel, border: "1px solid " + (quick === k && k ? color : DS.line), borderRadius: 12, padding: "9px 11px", cursor: "pointer", fontFamily: DS.font, color: DS.text }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: n ? color : DS.dim, lineHeight: 1.1 }}>{n}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: DS.mut }}>{l}</div>
          </button>
        ))}
        <div style={{ background: DS.panel, border: "1px solid " + DS.line, borderRadius: 12, padding: "9px 11px" }} title="Tasks due in the last 30 days that were done by their due date">
          <div style={{ fontSize: 22, fontWeight: 900, color: onTimePct == null ? DS.dim : onTimePct >= 80 ? "#2fbf9b" : onTimePct >= 60 ? DS.orange : LATE, lineHeight: 1.1 }}>{onTimePct == null ? "-" : onTimePct + "%"}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: DS.mut }}>On time · 30d · {doneWeek.length} done this week</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <button onClick={() => setPerson("")} style={chip(!person)}>Everyone</button>
        <button onClick={() => setPerson(person === me.email ? "" : me.email)} style={chip(person === me.email)}>Me</button>
        {people.filter(p => p.email !== me.email).map(p => { const n = openAll.filter(t => t.assignee_email === p.email).length; return <button key={p.email} onClick={() => setPerson(person === p.email ? "" : p.email)} style={chip(person === p.email)}>{firstName(p.name)}{n ? " · " + n : ""}</button>; })}
        <button onClick={() => setPerson(person === NONE ? "" : NONE)} style={chip(person === NONE, DS.mut)}>Unassigned</button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <Seg small value={groupBy} onChange={setGroupBy} options={[["person", "Person"], ["category", "Category"], ["department", "Department"], ["status", "Status"], ["due", "Due"], ["week", "Week"], ["project", "Project"]]} />
        {!narrow && groupBy !== "week" && <Seg small value={layout} onChange={setLayout} options={[["board", "Board"], ["list", "List"]]} />}
        <select value={cat} onChange={e => setCat(e.target.value)} style={sel}><option value="">All categories</option>{(st.categories || []).map(c => <option key={c} value={c}>{c}</option>)}<option value={NONE}>No category</option></select>
        <select value={dept} onChange={e => setDept(e.target.value)} style={sel}><option value="">All departments</option>{(st.departments || []).map(c => <option key={c} value={c}>{c}</option>)}<option value={NONE}>No department</option></select>
        <select value={quick} onChange={e => setQuick(e.target.value)} style={sel}><option value="">Any status</option><option value="today">Due today</option><option value="overdue">Overdue</option><option value="blocked">Blocked</option><option value="help">Needs help</option><option value="unassigned">Unassigned</option><option value="repeating">Repeating</option></select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" style={{ ...sel, minWidth: 140, flex: "1 1 140px" }} />
        {groupBy !== "week" && <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: DS.mut, cursor: "pointer" }}><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} style={{ accentColor: DS.lime }} />Show done</label>}
        {groupBy === "week" && <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><Btn small kind="quiet" onClick={() => setWeek(w => w - 1)}>‹</Btn><Btn small kind="quiet" onClick={() => setWeek(0)}>This week</Btn><Btn small kind="quiet" onClick={() => setWeek(w => w + 1)}>›</Btn></span>}
      </div>

      {!groups.length && <Card><div style={{ color: DS.mut, fontSize: 14 }}>{all.length ? "No tasks match." : "No tasks yet. Press ＋ New task to add one, or set up a repeating one."}</div></Card>}
      {(board || groupBy === "week") && groups.length ? (
        <div style={{ display: "grid", gridAutoFlow: narrow ? "row" : "column", gridAutoColumns: narrow ? "auto" : groupBy === "week" ? "minmax(170px, 1fr)" : "minmax(260px, 1fr)", gap: 10, overflowX: "auto", paddingBottom: 8, alignItems: "start" }}>
          {groups.map(g => (
            <div key={g.key} style={{ background: g.date === today ? "rgba(178,208,73,0.06)" : "rgba(0,0,0,0.12)", border: "1px solid " + (g.date === today ? "rgba(178,208,73,0.4)" : DS.line), borderRadius: 12, padding: 8 }}>
              <GroupHead g={g} groupBy={groupBy} today={today} onAdd={() => newIn(g)} />
              {g.items.map(t => <TaskCard key={g.key + "-" + t.id} t={t} today={today} onOpen={() => onOpen(t)} onToggle={() => toggleDone(t)} busy={busyId === t.id} showWho={groupBy !== "person"} compact={groupBy === "week"} />)}
              {!g.items.length && <div style={{ fontSize: 12, color: DS.dim, padding: "6px 4px" }}>-</div>}
            </div>
          ))}
        </div>
      ) : groups.map(g => (
        <Card key={g.key} style={{ padding: 12 }}>
          <GroupHead g={g} groupBy={groupBy} today={today} onAdd={() => newIn(g)} />
          {g.items.map(t => <TaskRow key={g.key + "-" + t.id} t={t} today={today} onOpen={() => onOpen(t)} onToggle={() => toggleDone(t)} busy={busyId === t.id} showWho={groupBy !== "person"} />)}
        </Card>
      ))}
    </div>
  );
}

function GroupHead({ g, groupBy, today, onAdd }) {
  const open = g.items.filter(isOpen), late = open.filter(t => t.due_date && t.due_date < today).length;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "2px 4px 8px" }}>
      {groupBy === "person" && g.email && <Avatar name={g.label} size={22} />}
      {g.color && <span style={{ width: 9, height: 9, borderRadius: 9, background: g.color, flex: "0 0 auto" }} />}
      <b style={{ fontSize: 13, color: g.color && groupBy !== "status" ? g.color : DS.text }}>{g.label}</b>
      <span style={{ fontSize: 12, color: DS.mut }}>{open.length}</span>
      {late > 0 && groupBy !== "due" && g.key !== "late" && <span style={{ fontSize: 11, color: LATE, fontWeight: 800 }}>{late} late</span>}
      <div style={{ flex: 1 }} />
      {g.key !== "late" && g.key !== "closed" && <span onClick={onAdd} title="Add a task here" style={{ cursor: "pointer", color: DS.mut, fontWeight: 800 }}>＋</span>}
    </div>
  );
}

function Check({ t, onToggle, busy }) {
  const done = t.status === "done";
  return <span role="checkbox" aria-checked={done} onClick={(e) => { e.stopPropagation(); if (!busy) onToggle(); }} title={done ? "Mark not done" : "Mark done"}
    style={{ width: 18, height: 18, borderRadius: 18, border: "2px solid " + (done ? "#2fbf9b" : SMAP[t.status].color), background: done ? "#2fbf9b" : "transparent", color: DS.bg, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 900, cursor: busy ? "wait" : "pointer", flex: "0 0 auto", opacity: busy ? 0.5 : 1 }}>{done ? "✓" : ""}</span>;
}

function TaskCard({ t, today, onOpen, onToggle, busy, showWho, compact }) {
  const cl = t.checklist || [], doneCl = cl.filter(x => x.done).length;
  const late = isOpen(t) && t.due_date && t.due_date < today;
  return (
    <div onClick={onOpen} style={{ background: DS.panel, border: "1px solid " + (t.help_requested_at ? "rgba(197,139,255,0.55)" : late ? "rgba(255,107,90,0.6)" : DS.line), borderLeft: "3px solid " + (t.priority === "high" && isOpen(t) ? DS.orange : SMAP[t.status].color), borderRadius: 10, padding: "8px 9px", marginBottom: 7, cursor: "pointer", opacity: isOpen(t) ? 1 : 0.6 }}>
      <div style={{ display: "flex", gap: 7, alignItems: "flex-start" }}>
        <Check t={t} onToggle={onToggle} busy={busy} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {t.project_name && <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: DS.dim, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📌 {t.project_name}</div>}
          <div style={{ fontSize: compact ? 13 : 14, fontWeight: 700, lineHeight: 1.3, textDecoration: t.status === "done" ? "line-through" : "none" }}>{t.priority === "high" && isOpen(t) ? "🔥 " : ""}{t.title}</div>
        </div>
      </div>
      {t.status === "blocked" && t.blocker && !compact && <div style={{ fontSize: 11, color: DS.orange, marginTop: 4 }}>⛔ {t.blocker}</div>}
      {t.help_requested_at && !compact && <div style={{ fontSize: 11, color: HELP, marginTop: 4 }}>🙋 {t.help_note}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7, fontSize: 11, color: DS.mut, flexWrap: "wrap" }}>
        <TaskBadges t={t} compact />
        {cl.length > 0 && <span title="Checklist">☑ {doneCl}/{cl.length}</span>}
        <div style={{ flex: 1 }} />
        {!compact && <Due date={t.due_date} today={today} done={!isOpen(t)} />}
        {showWho && t.assignee_name && <Avatar name={t.assignee_name} size={20} />}
        {(t.helpers || []).slice(0, 2).map(h => <Avatar key={h.email} name={h.name} size={18} title={h.name + " (helping)"} />)}
      </div>
    </div>
  );
}

function TaskRow({ t, today, onOpen, onToggle, busy, showWho }) {
  return (
    <div onClick={onOpen} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderTop: "1px solid " + DS.line, cursor: "pointer", opacity: isOpen(t) ? 1 : 0.6 }}>
      <Check t={t} onToggle={onToggle} busy={busy} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, textDecoration: t.status === "done" ? "line-through" : "none" }}>{t.priority === "high" && isOpen(t) ? "🔥 " : ""}{t.title}</div>
        <div style={{ fontSize: 12, color: DS.mut, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
          {t.project_name && <span>📌 {t.project_name}</span>}
          <span style={{ color: SMAP[t.status].color, fontWeight: 700 }}>{SMAP[t.status].label}</span>
          <TaskBadges t={t} />
          {t.status === "blocked" && t.blocker && <span style={{ color: DS.orange }}>"{t.blocker}"</span>}
        </div>
      </div>
      <Due date={t.due_date} today={today} done={!isOpen(t)} />
      {showWho && (t.assignee_name ? <Avatar name={t.assignee_name} size={22} /> : <span style={{ width: 22 }} />)}
    </div>
  );
}

// ── A new task, or a repeating one (also edits a repeat) ────────────────────
const EMPTY = { title: "", details: "", assignee_email: "", due_date: "", priority: "normal", category: "", departments: [], project_id: "", hq_view: "", link_url: "",
  repeat: "", every_n: 1, weekdays: [], monthday: "", starts_on: "", ends_on: "" };
export function TaskForm({ api, boot, preset = {}, series, onClose, onSaved }) {
  const today = boot.today, st = boot.settings || {}, me = boot.me;
  const [f, setF] = useState(() => series
    ? { ...EMPTY, ...series, assignee_email: series.assignee_email || "", category: series.category || "", hq_view: series.hq_view || "", link_url: series.link_url || "", repeat: series.frequency, monthday: series.monthday ?? "", ends_on: series.ends_on || "", details: series.details || "" }
    : { ...EMPTY, assignee_email: me.email, ...preset, project_id: preset.project_id || "", repeat: preset.repeat || "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (patch) => setF(x => ({ ...x, ...patch }));
  const rep = f.repeat;
  const canRepeatFor = me.manager || !f.assignee_email || f.assignee_email === me.email;
  const startOn = f.starts_on || f.due_date || today;
  const preview = rep ? { frequency: rep, every_n: f.every_n, weekdays: f.weekdays, monthday: f.monthday === "" ? null : Number(f.monthday), starts_on: startOn, ends_on: f.ends_on || null } : null;
  const next = preview ? nextOccurrence(preview, today > startOn ? today : startOn) : null;
  const toggleDay = (d) => set({ weekdays: f.weekdays.includes(d) ? f.weekdays.filter(x => x !== d) : [...f.weekdays, d] });
  const submit = async () => {
    if (!f.title.trim()) { setErr("Give it a title."); return; }
    if (rep && !canRepeatFor) { setErr("Only the DSSC admins can set repeating tasks for someone else."); return; }
    setBusy(true); setErr("");
    const common = { title: f.title.trim(), details: f.details, assignee_email: f.assignee_email || null, priority: f.priority, category: f.category || null, departments: f.departments, hq_view: f.hq_view || null, link_url: f.link_url.trim() || null };
    try {
      if (rep) await api("save_series", { series: { ...(series ? { id: series.id } : {}), ...common, frequency: rep, every_n: Number(f.every_n) || 1, weekdays: f.weekdays, monthday: rep === "monthly" ? (f.monthday === "" ? null : Number(f.monthday)) : null, starts_on: startOn, ends_on: f.ends_on || null } });
      else await api("save_task", { task: { ...common, due_date: f.due_date || null, project_id: f.project_id ? Number(f.project_id) : null } });
      await onSaved();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const lab = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: DS.mut };
  return (
    <Modal onClose={onClose} width={720}>
      <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 10 }}>{series ? "🔁 Edit repeating task" : rep ? "🔁 New repeating task" : "＋ New task"}</div>
      <input autoFocus value={f.title} onChange={e => set({ title: e.target.value })} onKeyDown={e => { if (e.key === "Enter" && !rep) submit(); }} placeholder={rep ? "e.g. Approve DSSC time cards" : "What needs to get done?"} style={{ ...inputStyle, fontSize: 16, fontWeight: 700 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 10 }}>
        <label style={lab}>Assigned to<select value={f.assignee_email} onChange={e => set({ assignee_email: e.target.value })} style={{ ...sel, width: "100%" }}><option value="">Unassigned</option>{boot.people.map(p => <option key={p.email} value={p.email}>{p.name}</option>)}</select></label>
        {!rep && <label style={lab}>Due<input type="date" value={f.due_date} onChange={e => set({ due_date: e.target.value })} style={{ ...sel, width: "100%" }} /></label>}
        <label style={lab}>Priority<select value={f.priority} onChange={e => set({ priority: e.target.value })} style={{ ...sel, width: "100%" }}><option value="low">Low</option><option value="normal">Normal</option><option value="high">🔥 High</option></select></label>
        <label style={lab}>Category<select value={f.category} onChange={e => set({ category: e.target.value })} style={{ ...sel, width: "100%" }}><option value="">-</option>{(st.categories || []).map(c => <option key={c} value={c}>{c}</option>)}</select></label>
        {!rep && !series && <label style={lab}>Project<select value={f.project_id} onChange={e => set({ project_id: e.target.value })} style={{ ...sel, width: "100%" }}><option value="">None (standalone)</option>{(boot.projects || []).filter(p => !["done", "archived"].includes(p.status)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        <label style={lab}>HQ screen<select value={f.hq_view} onChange={e => set({ hq_view: e.target.value })} style={{ ...sel, width: "100%" }}><option value="">-</option>{HQ_VIEWS.map(([k, l, g]) => <option key={k} value={k}>{g} · {l}</option>)}</select></label>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 10, fontSize: 12, color: DS.mut }}>Departments
        {(st.departments || []).map(d => { const on = f.departments.includes(d); return <button key={d} onClick={() => set({ departments: on ? f.departments.filter(x => x !== d) : [...f.departments, d] })} style={chip(on, "#7FD1C3")}>{on ? "✓ " : ""}{d}</button>; })}
      </div>

      {!series && <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: DS.mut }}>Repeats</span>
        <Seg small value={rep} onChange={(v) => set({ repeat: v })} options={[["", "One-off"], ...FREQUENCIES]} />
      </div>}
      {rep && (
        <div style={{ background: "rgba(178,208,73,0.06)", border: "1px solid rgba(178,208,73,0.3)", borderRadius: 10, padding: 10, marginTop: 10 }}>
          {series && <div style={{ marginBottom: 8 }}><Seg small value={rep} onChange={(v) => set({ repeat: v })} options={FREQUENCIES} /></div>}
          {(rep === "daily" || rep === "weekly") && <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: DS.mut }}>
            {rep === "daily" ? "On" : "On"}
            {[1, 2, 3, 4, 5, 6, 0].map(d => <button key={d} onClick={() => toggleDay(d)} style={chip(f.weekdays.includes(d))}>{DAY_SHORT[d]}</button>)}
            {rep === "daily" && <button onClick={() => set({ weekdays: [1, 2, 3, 4, 5] })} style={chip(false, DS.mut)}>Weekdays</button>}
            <span style={{ color: DS.dim }}>{rep === "daily" ? "(none picked = every day)" : "(none picked = the start date's day)"}</span>
          </div>}
          {rep !== "daily" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: DS.mut, marginTop: 8 }}>
            Every <select value={f.every_n} onChange={e => set({ every_n: Number(e.target.value) })} style={sel}>{[1, 2, 3, 4, 6, 12].map(n => <option key={n} value={n}>{n}</option>)}</select> {rep === "weekly" ? "week(s)" : "month(s)"}
            {rep === "monthly" && <>on <select value={f.monthday} onChange={e => set({ monthday: e.target.value })} style={sel}><option value="">the start date's day</option>{Array.from({ length: 31 }, (_, i) => i + 1).map(n => <option key={n} value={n}>the {n}{n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}</option>)}<option value="-1">the last day</option></select></>}
          </div>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: DS.mut, marginTop: 8 }}>
            Starts <input type="date" value={f.starts_on || startOn} onChange={e => set({ starts_on: e.target.value })} style={sel} />
            Ends <input type="date" value={f.ends_on} onChange={e => set({ ends_on: e.target.value })} style={sel} /><span style={{ color: DS.dim }}>(optional)</span>
          </div>
          <div style={{ fontSize: 13, marginTop: 8 }}><b>{describeRepeat(preview)}</b>{next ? <span style={{ color: DS.mut }}> · next due {fmtDW(next)}</span> : <span style={{ color: LATE }}> · never falls due with these settings</span>}</div>
          <div style={{ fontSize: 11, color: DS.dim, marginTop: 4 }}>Each one becomes its own task: today's for a daily task, the coming week's for weekly, two weeks ahead for monthly. A daily one nobody finishes is closed as missed two days later.</div>
        </div>
      )}

      <div style={{ marginTop: 12 }}><Grow value={f.details} onChange={e => set({ details: e.target.value })} minRows={3} placeholder="Details, notes, what done looks like…" /></div>
      <input value={f.link_url} onChange={e => set({ link_url: e.target.value })} placeholder="Link (optional): https://…" style={{ ...inputStyle, fontSize: 13, marginTop: 8 }} />
      {err && <div style={{ color: DS.orange, fontSize: 13, marginTop: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
        <Btn kind="primary" disabled={busy || !f.title.trim()} onClick={submit}>{busy ? "Saving…" : series ? "Save the repeat" : rep ? "Create repeating task" : "Add task"}</Btn>
        <span style={{ fontSize: 12, color: DS.dim }}>{f.assignee_email && f.assignee_email !== me.email ? "They get an email" : ""}{f.assignee_email && f.assignee_email !== me.email && st.slack ? " and a Slack mention" : !f.assignee_email || f.assignee_email === me.email ? (st.slack ? "Slack hears about it" : "") : ""}.</span>
        <div style={{ flex: 1 }} />
        <Btn kind="quiet" onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );
}

// ── Repeating tasks ─────────────────────────────────────────────────────────
export function RecurringView({ boot, api, onNew, onEdit, onChanged }) {
  const today = boot.today, me = boot.me;
  const [person, setPerson] = useState("");
  const series = (boot.series || []).filter(s => !person || s.assignee_email === person);
  const stats = (s) => {
    const ts = (boot.tasks || []).filter(t => t.series_id === s.id && t.due_date && t.due_date < today);
    const g = ts.map(t => timeliness(t, today)).filter(Boolean);
    return { n: g.length, onTime: g.filter(x => x === "on_time").length, missed: g.filter(x => x === "missed" || x === "overdue").length };
  };
  const toggle = async (s) => { try { await api("save_series", { series: { id: s.id, active: !s.active } }); await onChanged(); } catch (e) { window.alert(e.message); } };
  const stop = async (s) => { if (!window.confirm(`Stop "${s.title}" repeating? Upcoming copies nobody has started are removed; anything done stays.`)) return; try { await api("delete_series", { id: s.id }); await onChanged(); } catch (e) { window.alert(e.message); } };
  const by = [["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]];
  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <button onClick={() => setPerson("")} style={chip(!person)}>Everyone</button>
        {boot.people.filter(p => (boot.series || []).some(s => s.assignee_email === p.email)).map(p => <button key={p.email} onClick={() => setPerson(person === p.email ? "" : p.email)} style={chip(person === p.email)}>{firstName(p.name)}</button>)}
        <div style={{ flex: 1 }} />
        <Btn kind="primary" onClick={() => onNew({ repeat: "weekly" })}>🔁 New repeating task</Btn>
      </div>
      {!series.length && <Card><div style={{ color: DS.mut, fontSize: 14, lineHeight: 1.5 }}>No repeating tasks yet. Add the routine work here, like approving time cards every Monday, checking staff hours on Fridays, or planning next month's programming on the 15th. HQ puts each one on the right person's list ahead of its due date.</div></Card>}
      {by.map(([k, l]) => {
        const list = series.filter(s => s.frequency === k);
        if (!list.length) return null;
        return (
          <Card key={k} style={{ padding: 12 }}>
            <Label>{l} · {list.length}</Label>
            {list.map(s => {
              const x = stats(s), next = s.active ? nextOccurrence(s, today) : null, mine = me.manager || s.assignee_email === me.email || s.created_by === me.email;
              return (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 4px", borderTop: "1px solid " + DS.line, flexWrap: "wrap", opacity: s.active ? 1 : 0.55 }}>
                  {s.assignee_name ? <Avatar name={s.assignee_name} size={26} /> : <span style={{ width: 26 }} />}
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{s.title}</div>
                    <div style={{ fontSize: 12, color: DS.mut, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
                      <span>🔁 {describeRepeat(s)}</span>{s.assignee_name && <span>· {s.assignee_name}</span>}<TaskBadges t={s} />
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: DS.mut, minWidth: 120 }}>{s.active ? (next ? "Next " + fmtD(next) : "Ended") : "Paused"}</div>
                  <div style={{ minWidth: 120 }} title={`${x.onTime} of ${x.n} done on time`}>
                    {x.n ? <><div style={{ fontSize: 12, fontWeight: 800, color: x.onTime / x.n >= 0.8 ? "#2fbf9b" : x.onTime / x.n >= 0.6 ? DS.orange : LATE }}>{Math.round(100 * x.onTime / x.n)}% on time</div><div style={{ fontSize: 11, color: DS.dim }}>{x.n} due so far{x.missed ? ` · ${x.missed} missed` : ""}</div></> : <span style={{ fontSize: 11, color: DS.dim }}>None due yet</span>}
                  </div>
                  {mine && <span style={{ display: "inline-flex", gap: 4 }}>
                    <Btn small kind="quiet" onClick={() => onEdit(s)}>Edit</Btn>
                    <Btn small kind="quiet" onClick={() => toggle(s)}>{s.active ? "Pause" : "Resume"}</Btn>
                    <Btn small kind="quiet" onClick={() => stop(s)} style={{ color: LATE }}>Stop</Btn>
                  </span>}
                </div>
              );
            })}
          </Card>
        );
      })}
    </div>
  );
}

// ── Scorecard ───────────────────────────────────────────────────────────────
export function Scorecard({ boot, onPick }) {
  const today = boot.today;
  const [days, setDays] = useState(30);
  const [by, setBy] = useState("person");
  const from = plusDays(today, -days);
  const tasks = boot.tasks || [];
  const rowsFor = (keyOf, labelOf, keys) => {
    const m = new Map(keys.map(k => [k, { key: k, label: labelOf(k), open: 0, overdue: 0, blocked: 0, help: 0, done: 0, onTime: 0, late: 0, missed: 0, lateDays: 0 }]));
    const get = (k) => { if (!m.has(k)) m.set(k, { key: k, label: labelOf(k), open: 0, overdue: 0, blocked: 0, help: 0, done: 0, onTime: 0, late: 0, missed: 0, lateDays: 0 }); return m.get(k); };
    for (const t of tasks) {
      for (const k of keyOf(t)) {
        const r = get(k);
        if (isOpen(t)) { r.open++; if (t.due_date && t.due_date < today) r.overdue++; if (t.status === "blocked") r.blocked++; if (t.help_requested_at) r.help++; }
        if (t.status === "done" && t.completed_at && t.completed_at.slice(0, 10) >= from) r.done++;
        // Graded: due in the window, and either closed or already past due.
        if (t.due_date && t.due_date >= from && t.due_date < today) {
          const g = timeliness(t, today);
          if (g === "on_time") r.onTime++;
          else if (g === "late") { r.late++; r.lateDays += Math.max(0, Math.round((Date.parse((t.completed_at || "").slice(0, 10) + "T12:00:00Z") - Date.parse(t.due_date + "T12:00:00Z")) / 864e5)); }
          else if (g === "missed" || g === "overdue") r.missed++;
        } else if (t.due_date === today && t.status === "done") r.onTime++;
      }
    }
    return [...m.values()].filter(r => r.open || r.done || r.onTime || r.late || r.missed);
  };
  const people = boot.people;
  const rows = by === "person"
    ? rowsFor(t => [t.assignee_email || NONE], k => k === NONE ? "Not assigned" : people.find(p => p.email === k)?.name || k, people.map(p => p.email))
    : by === "category" ? rowsFor(t => [t.category || NONE], k => k === NONE ? "No category" : k, boot.settings?.categories || [])
    : rowsFor(t => (t.departments || []).length ? t.departments : [NONE], k => k === NONE ? "No department" : k, boot.settings?.departments || []);
  const pct = (r) => { const n = r.onTime + r.late + r.missed; return n ? Math.round(100 * r.onTime / n) : null; };
  rows.sort((a, b) => (a.key === NONE) - (b.key === NONE) || (pct(b) ?? -1) - (pct(a) ?? -1) || b.open - a.open);
  const tot = rows.reduce((a, r) => { for (const k of ["open", "overdue", "blocked", "help", "done", "onTime", "late", "missed"]) a[k] += r[k]; return a; }, { open: 0, overdue: 0, blocked: 0, help: 0, done: 0, onTime: 0, late: 0, missed: 0 });
  const th = { padding: "6px 8px", fontSize: 11, color: DS.mut, fontWeight: 800, textAlign: "right", whiteSpace: "nowrap" };
  const td = { padding: "8px", fontSize: 13, textAlign: "right", borderTop: "1px solid " + DS.line, whiteSpace: "nowrap" };
  const colorPct = (p) => p == null ? DS.dim : p >= 80 ? "#2fbf9b" : p >= 60 ? DS.orange : LATE;
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <Seg small value={by} onChange={setBy} options={[["person", "By person"], ["category", "By category"], ["department", "By department"]]} />
        <Seg small value={days} onChange={setDays} options={[[7, "7 days"], [30, "30 days"], [90, "90 days"]]} />
        <span style={{ fontSize: 12, color: DS.dim }}>On time = done by the end of its due date. Missed = a repeat that was skipped, or anything still open past due.</span>
      </div>
      <Card style={{ padding: 8, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>{by === "person" ? "Person" : by === "category" ? "Category" : "Department"}</th><th style={{ ...th, textAlign: "left", width: 190 }}>On time ({days}d)</th><th style={th}>Done</th><th style={th}>Late</th><th style={th}>Missed</th><th style={th}>Avg days late</th><th style={th}>Open</th><th style={th}>Overdue</th><th style={th}>Blocked</th><th style={th}>Help</th></tr></thead>
          <tbody>
            {rows.map(r => { const p = pct(r); return (
              <tr key={r.key} onClick={() => by === "person" && r.key !== NONE && onPick?.(r.key)} style={{ cursor: by === "person" && r.key !== NONE ? "pointer" : "default" }}>
                <td style={{ ...td, textAlign: "left", fontWeight: 700 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>{by === "person" && r.key !== NONE && <Avatar name={r.label} size={22} />}{r.label}</span></td>
                <td style={{ ...td, textAlign: "left" }}>{p == null ? <span style={{ color: DS.dim }}>-</span> : <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ flex: 1 }}><Progress done={r.onTime} total={r.onTime + r.late + r.missed} color={colorPct(p)} /></div><b style={{ color: colorPct(p), minWidth: 36 }}>{p}%</b></div>}</td>
                <td style={td}>{r.done || "-"}</td>
                <td style={{ ...td, color: r.late ? DS.orange : DS.dim }}>{r.late || "-"}</td>
                <td style={{ ...td, color: r.missed ? LATE : DS.dim }}>{r.missed || "-"}</td>
                <td style={{ ...td, color: DS.mut }}>{r.late ? (r.lateDays / r.late).toFixed(1) : "-"}</td>
                <td style={td}>{r.open || "-"}</td>
                <td style={{ ...td, color: r.overdue ? LATE : DS.dim, fontWeight: r.overdue ? 800 : 400 }}>{r.overdue || "-"}</td>
                <td style={{ ...td, color: r.blocked ? DS.orange : DS.dim }}>{r.blocked || "-"}</td>
                <td style={{ ...td, color: r.help ? HELP : DS.dim }}>{r.help || "-"}</td>
              </tr>); })}
            {(() => { const p = pct(tot); return (
              <tr><td style={{ ...td, textAlign: "left", fontWeight: 900 }}>Team</td><td style={{ ...td, textAlign: "left" }}>{p == null ? "-" : <b style={{ color: colorPct(p) }}>{p}%</b>}</td><td style={td}>{tot.done}</td><td style={td}>{tot.late}</td><td style={td}>{tot.missed}</td><td style={td} /><td style={td}>{tot.open}</td><td style={td}>{tot.overdue}</td><td style={td}>{tot.blocked}</td><td style={td}>{tot.help}</td></tr>); })()}
          </tbody>
        </table>
        {!rows.length && <div style={{ color: DS.mut, fontSize: 13, padding: 10 }}>Nothing to score yet. Tasks with due dates show up here once they're done or due.</div>}
      </Card>
      {by === "person" && <div style={{ fontSize: 12, color: DS.dim }}>Tap a person to see their tasks. A task counts for whoever it's assigned to; done counts are by when it was finished.</div>}
    </div>
  );
}
