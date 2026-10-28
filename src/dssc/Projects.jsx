// DSSC Tasks & Projects. Projects (Drew, Oct 14 2026): "a project menu within
// the DSSC HQ ... to assign projects and track to-dos and completions" - e.g.
// Heatwave's Inaugural Winter Edition and DS Fall Fest Activations (Jonathan).
// Tasks (Oct 28 2026): "a full task tracking application for all of my team
// members" - one-off, daily, weekly and monthly tasks in categories, Slack for
// updates and feedback, notes and details, deadlines, blockers, overdue,
// on-time tracking, asking for help, views across the team, tasks that cross
// departments, and links into the HQ screens the work happens in. Projects are
// the larger one-off items that hold many tasks.
//
//   Tasks       every task (standalone and project cards) - src/dssc/Tasks.jsx
//   Projects    project cards; one project opens as a board or by section
//   Repeating   the daily / weekly / monthly tasks
//   Scorecard   on-time rates and what's open, by person, category, department
// Everything goes through /api/projects, which posts to Slack and emails
// assignees; /api/tasks-daily makes the repeats and posts the morning digest;
// /api/projects-weekly sends the Monday "needs an update" email.
import { useEffect, useState } from "react";
import { DS, Btn, Card, Label, Tag, inputStyle, Field, Grow } from "./DsscHub.jsx";
import { realApi, BOARD_STATUS, SMAP, fmtDW, ago, Avatar, Due, Progress, Modal, Seg, TaskModal, sel } from "./taskKit.jsx";
import { TasksView, TaskForm, RecurringView, Scorecard } from "./Tasks.jsx";

const PSTATUS = [["planning", "Planning"], ["active", "Active"], ["on_hold", "On hold"], ["done", "Done"], ["archived", "Archived"]];
const PCOLOR = { planning: "#A9C7C3", active: "#B2D049", on_hold: "#FF7300", done: "#2fbf9b", archived: "#6F9995" };
const EXAMPLE = "Heatwave - Inaugural Winter Edition. We need to get everything together and launched: lock in a lead coach for each session, a launch plan, a marketing plan, finalize the brand order and swag, select the players, and plan the sessions. Hunter helps with coaches and players, Kristen with the swag order.";
const TABS = [["tasks", "Tasks"], ["projects", "Projects"], ["repeating", "Repeating"], ["scorecard", "Scorecard"]];

export default function Projects({ coach, apiFn, onOpenView }) {
  const api = apiFn || realApi;
  const [boot, setBoot] = useState(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("tasks");
  const [selId, setSelId] = useState(null);
  const [openTask, setOpenTask] = useState(null);       // a task opened outside a project view
  const [projTask, setProjTask] = useState(null);       // a card opened inside the project view
  const [modal, setModal] = useState(null);             // "new" | "settings" | { task: preset } | { series }
  const [showDone, setShowDone] = useState(false);
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 760);
  const [pick, setPick] = useState({ n: 0, email: "" });   // the Scorecard opens one person's tasks

  const load = async () => { try { setBoot(await api("bootstrap", { archived: true })); setErr(""); } catch (e) { setErr(e.message); } };
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get("tab") && TABS.some(t => t[0] === p.get("tab"))) setTab(p.get("tab"));
      if (p.get("project")) { setSelId(Number(p.get("project"))); setTab("projects"); if (p.get("task")) setProjTask(Number(p.get("task"))); }
      else if (p.get("task")) setOpenTask(Number(p.get("task")));
    } catch { /* ignore */ }
    load();
    const f = () => setNarrow(window.innerWidth < 760); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Keep the address shareable: ?view=projects&tab=..&project=..&task=..
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      tab !== "tasks" ? u.searchParams.set("tab", tab) : u.searchParams.delete("tab");
      selId ? u.searchParams.set("project", selId) : u.searchParams.delete("project");
      const t = selId ? projTask : openTask;
      t ? u.searchParams.set("task", t) : u.searchParams.delete("task");
      window.history.replaceState(window.history.state, "", u);
    } catch { /* ignore */ }
  }, [tab, selId, openTask, projTask]);

  if (err && !boot) return <div style={{ padding: 24, color: DS.orange, fontFamily: DS.font }}>{err}</div>;
  if (!boot) return <div style={{ padding: 24, color: DS.mut, fontFamily: DS.font }}>Loading tasks…</div>;
  const manager = !!boot.me?.manager;
  const editSeries = (series) => { setOpenTask(null); setProjTask(null); setModal({ series }); };
  const modals = (
    <>
      {openTask && <TaskModal api={api} id={openTask} boot={boot} onOpenView={onOpenView} onEditSeries={editSeries}
        onClose={() => { setOpenTask(null); load(); }} onSaved={() => {}} onDeleted={() => { setOpenTask(null); load(); }} />}
      {modal === "new" && <NewProject api={api} boot={boot} onClose={() => setModal(null)} onCreated={(id) => { setModal(null); load(); setTab("projects"); setSelId(id); }} />}
      {modal === "settings" && <Settings api={api} boot={boot} onClose={() => setModal(null)} onSaved={load} />}
      {modal?.task && <TaskForm api={api} boot={boot} preset={modal.task} onClose={() => setModal(null)} onSaved={async () => { setModal(null); await load(); }} />}
      {modal?.series && <TaskForm api={api} boot={boot} series={modal.series} onClose={() => setModal(null)} onSaved={async () => { setModal(null); await load(); }} />}
    </>
  );

  if (selId) return (
    <>
      <ProjectView api={api} id={selId} boot={boot} openTask={projTask} setOpenTask={setProjTask} onOpenView={onOpenView} onEditSeries={editSeries}
        onBack={() => { setSelId(null); setProjTask(null); load(); }} onChanged={load} />
      {modals}
    </>
  );

  const visible = boot.projects.filter(p => showDone ? true : !["done", "archived"].includes(p.status));
  return (
    <div style={{ fontFamily: DS.font, color: DS.text, maxWidth: 1500, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>✅ Tasks &amp; Projects</div>
        <Seg value={tab} onChange={setTab} options={TABS.map(([k, l]) => [k, k === "tasks" && boot.myTasks.length ? `${l} · ${boot.myTasks.length} mine` : k === "repeating" && boot.series?.length ? `${l} · ${boot.series.length}` : l])} />
        <div style={{ flex: 1 }} />
        <Btn kind="primary" onClick={() => setModal({ task: {} })}>＋ New task</Btn>
        {manager && <Btn kind="ghost" onClick={() => setModal("new")}>✦ New project</Btn>}
        {manager && <Btn kind="quiet" onClick={() => setModal("settings")} title="Slack, emails, categories and departments">⚙ Settings</Btn>}
      </div>

      {tab === "tasks" && <TasksView key={pick.n} initialPerson={pick.email} boot={boot} api={api} narrow={narrow} onChanged={load} onOpen={(t) => setOpenTask(t.id)} onNew={(preset) => setModal({ task: preset })} />}
      {tab === "repeating" && <RecurringView boot={boot} api={api} onChanged={load} onNew={(preset) => setModal({ task: preset })} onEdit={(s) => setModal({ series: s })} />}
      {tab === "scorecard" && <Scorecard boot={boot} onPick={(email) => { setPick(x => ({ n: x.n + 1, email })); setTab("tasks"); }} />}
      {tab === "projects" && (<>
        {!visible.length && <Card><div style={{ color: DS.mut, fontSize: 14 }}>{boot.projects.length ? "No open projects." : manager ? "No projects yet. Tap ✦ New project and describe one - Claude will draft the cards for you." : "No projects yet."}</div></Card>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {visible.map(p => <ProjectCard key={p.id} p={p} today={boot.today} onOpen={() => setSelId(p.id)} />)}
        </div>
        {boot.projects.some(p => ["done", "archived"].includes(p.status)) && <div style={{ marginTop: 12 }}><Btn kind="link" onClick={() => setShowDone(v => !v)}>{showDone ? "Hide finished projects" : "Show finished and archived projects"}</Btn></div>}
      </>)}
      {modals}
    </div>
  );
}

function ProjectCard({ p, today, onOpen }) {
  const c = p.counts || {};
  return (
    <div onClick={onOpen} style={{ background: DS.panel, border: "1px solid " + DS.line, borderRadius: 14, padding: 14, cursor: "pointer", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 800, flex: 1, lineHeight: 1.25 }}>{p.icon ? p.icon + " " : ""}{p.name}</div>
        <Tag color={PCOLOR[p.status]}>{PSTATUS.find(s => s[0] === p.status)?.[1]}</Tag>
      </div>
      {p.summary && <div style={{ fontSize: 12, color: DS.mut, lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.summary}</div>}
      <Progress done={c.done || 0} total={c.total || 0} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: DS.mut }}>
        <span><b style={{ color: DS.text }}>{c.done || 0}</b>/{c.total || 0} done</span>
        {c.overdue > 0 && <span style={{ color: "#ff6b5a", fontWeight: 700 }}>{c.overdue} overdue</span>}
        {c.blocked > 0 && <span style={{ color: DS.orange, fontWeight: 700 }}>{c.blocked} blocked</span>}
        {c.mine > 0 && <span style={{ color: DS.lime, fontWeight: 700 }}>{c.mine} yours</span>}
        <div style={{ flex: 1 }} />
        {p.due_date && <span>Due <Due date={p.due_date} today={today} done={p.status === "done"} /></span>}
        {p.owner_name && <Avatar name={p.owner_name} size={22} title={"Owner: " + p.owner_name} />}
      </div>
    </div>
  );
}

// ── One project: header, board / list, activity ─────────────────────────────
function ProjectView({ api, id, boot, openTask, setOpenTask, onBack, onChanged, onOpenView, onEditSeries }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState("board");
  const [mine, setMine] = useState(false);
  const [adding, setAdding] = useState(null);           // status or section the quick-add is open in
  const manager = !!boot.me?.manager, today = boot.today, people = boot.people;
  const load = async () => { try { setData(await api("project", { id })); setErr(""); } catch (e) { setErr(e.message); } };
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <div style={{ padding: 20, fontFamily: DS.font }}><Btn kind="link" onClick={onBack}>‹ Projects</Btn><div style={{ color: DS.orange, marginTop: 10 }}>{err}</div></div>;
  if (!data) return <div style={{ padding: 20, color: DS.mut, fontFamily: DS.font }}>Loading…</div>;
  const p = data.project;
  const tasks = data.tasks.filter(t => !mine || t.assignee_email === boot.me.email || (t.helpers || []).some(h => h.email === boot.me.email));
  const done = data.tasks.filter(t => t.status === "done").length;
  const sections = [...new Set(data.tasks.map(t => t.section).filter(Boolean))];
  const saveProject = async (patch) => { try { const d = await api("save_project", { project: { id: p.id, ...patch } }); setData(x => ({ ...x, project: d.project })); onChanged(); } catch (e) { window.alert(e.message); load(); } };
  const quickAdd = async (title, extra) => { if (!title.trim()) return; try { const d = await api("save_task", { task: { project_id: p.id, title: title.trim(), ...extra } }); setData(x => ({ ...x, tasks: [...x.tasks, { ...d.task, files: 0, comments: 0 }] })); onChanged(); } catch (e) { window.alert(e.message); } };
  const patchTask = (t) => setData(x => ({ ...x, tasks: x.tasks.map(o => o.id === t.id ? { ...o, ...t } : o) }));

  return (
    <div style={{ fontFamily: DS.font, color: DS.text, maxWidth: 1400, margin: "0 auto" }}>
      <Btn kind="link" onClick={onBack}>‹ All projects</Btn>
      <Card style={{ marginTop: 8 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 320px", minWidth: 0 }}>
            {manager ? <Field value={p.name} onSave={(v) => v.trim() && saveProject({ name: v })} style={{ fontSize: 20, fontWeight: 800, background: "transparent", border: "1px solid transparent", padding: "4px 6px" }} />
              : <div style={{ fontSize: 20, fontWeight: 800 }}>{p.name}</div>}
          </div>
          {manager ? (
            <select value={p.status} onChange={e => saveProject({ status: e.target.value })} style={{ ...sel, color: PCOLOR[p.status], fontWeight: 800 }}>{PSTATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          ) : <Tag color={PCOLOR[p.status]}>{PSTATUS.find(s => s[0] === p.status)?.[1]}</Tag>}
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", margin: "10px 0", fontSize: 13, color: DS.mut }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Owner
            {manager ? <select value={p.owner_email || ""} onChange={e => saveProject({ owner_email: e.target.value || null })} style={sel}><option value="">-</option>{people.map(x => <option key={x.email} value={x.email}>{x.name}</option>)}</select>
              : <b style={{ color: DS.text }}>{p.owner_name || "-"}</b>}
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Starts
            {manager ? <input type="date" value={p.start_date || ""} onChange={e => saveProject({ start_date: e.target.value || null })} style={sel} /> : <b style={{ color: DS.text }}>{fmtDW(p.start_date) || "-"}</b>}
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Due
            {manager ? <input type="date" value={p.due_date || ""} onChange={e => saveProject({ due_date: e.target.value || null })} style={sel} /> : <b style={{ color: DS.text }}>{fmtDW(p.due_date) || "-"}</b>}
          </label>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>Team
            {(p.team || []).map(m => <span key={m.email} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(255,255,255,0.06)", borderRadius: 20, padding: "2px 8px 2px 2px" }}><Avatar name={m.name} size={20} /><span style={{ color: DS.text, fontSize: 12 }}>{m.name.split(" ")[0]}</span>{manager && <span onClick={() => saveProject({ team: (p.team || []).filter(x => x.email !== m.email).map(x => x.email) })} style={{ cursor: "pointer", color: DS.dim }}>✕</span>}</span>)}
            {manager && <select value="" onChange={e => e.target.value && saveProject({ team: [...(p.team || []).map(x => x.email), e.target.value] })} style={{ ...sel, padding: "4px 6px", fontSize: 12 }}><option value="">+ add</option>{people.filter(x => !(p.team || []).some(m => m.email === x.email)).map(x => <option key={x.email} value={x.email}>{x.name}</option>)}</select>}
          </div>
        </div>
        {manager ? <Field multiline minRows={2} value={p.summary || ""} onSave={(v) => saveProject({ summary: v })} placeholder="What this project is for and what 'done' looks like" />
          : p.summary && <div style={{ fontSize: 14, color: DS.mut, whiteSpace: "pre-wrap" }}>{p.summary}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
          <div style={{ flex: 1 }}><Progress done={done} total={data.tasks.length} /></div>
          <span style={{ fontSize: 12, color: DS.mut, whiteSpace: "nowrap" }}><b style={{ color: DS.text }}>{done}</b> of {data.tasks.length} done</span>
        </div>
      </Card>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ display: "inline-flex", border: "1px solid " + DS.lineStrong, borderRadius: 9, overflow: "hidden" }}>
          {[["board", "Board"], ["list", "By section"]].map(([k, l]) => <button key={k} onClick={() => setMode(k)} style={{ padding: "6px 12px", border: "none", background: mode === k ? DS.lime : "transparent", color: mode === k ? DS.bg : DS.mut, fontFamily: DS.font, fontWeight: 800, fontSize: 12, cursor: "pointer" }}>{l}</button>)}
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: DS.mut, cursor: "pointer" }}><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} style={{ accentColor: DS.lime }} />Only my cards</label>
        <div style={{ flex: 1 }} />
        <Btn small kind="primary" onClick={() => setAdding(mode === "board" ? "todo" : (sections[0] || ""))}>＋ Card</Btn>
      </div>

      {mode === "board" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(250px, 1fr))", gap: 10, overflowX: "auto", paddingBottom: 6 }}>
          {BOARD_STATUS.map(([k, label, color]) => {
            const col = tasks.filter(t => t.status === k);
            return (
              <div key={k} style={{ background: "rgba(0,0,0,0.12)", border: "1px solid " + DS.line, borderRadius: 12, padding: 8, minWidth: 250 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 4px 8px" }}>
                  <span style={{ width: 9, height: 9, borderRadius: 9, background: color }} /><b style={{ fontSize: 13 }}>{label}</b><span style={{ fontSize: 12, color: DS.mut }}>{col.length}</span>
                  <div style={{ flex: 1 }} /><span onClick={() => setAdding(k)} title="Add a card" style={{ cursor: "pointer", color: DS.mut, fontWeight: 800 }}>＋</span>
                </div>
                {adding === k && <QuickAdd onAdd={(title) => quickAdd(title, { status: k })} onClose={() => setAdding(null)} />}
                {col.map(t => <TaskTile key={t.id} t={t} today={today} onOpen={() => setOpenTask(t.id)} />)}
                {!col.length && adding !== k && <div style={{ fontSize: 12, color: DS.dim, padding: "6px 4px" }}>-</div>}
              </div>
            );
          })}
        </div>
      ) : (
        [...sections, ""].map(sec => {
          const list = tasks.filter(t => (t.section || "") === sec);
          if (!list.length && sec && adding !== sec) return null;
          if (!list.length && !sec && adding !== "") return null;
          return (
            <Card key={sec || "_none"} style={{ padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Label style={{ marginBottom: 6 }}>{sec || "Other"} · {list.length}</Label><div style={{ flex: 1 }} /><span onClick={() => setAdding(sec)} style={{ cursor: "pointer", color: DS.mut, fontWeight: 800 }}>＋</span></div>
              {adding === sec && <QuickAdd onAdd={(title) => quickAdd(title, { section: sec || null })} onClose={() => setAdding(null)} />}
              {list.map(t => (
                <div key={t.id} onClick={() => setOpenTask(t.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderTop: "1px solid " + DS.line, cursor: "pointer" }}>
                  <span style={{ width: 9, height: 9, borderRadius: 9, background: SMAP[t.status].color, flex: "0 0 auto" }} title={SMAP[t.status].label} />
                  <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 14, textDecoration: t.status === "done" ? "line-through" : "none", color: t.status === "done" ? DS.mut : DS.text }}>{t.title}</div>
                  <span style={{ fontSize: 11, color: SMAP[t.status].color, fontWeight: 700 }}>{SMAP[t.status].label}</span>
                  <Due date={t.due_date} today={today} done={t.status === "done"} />
                  {t.assignee_name ? <Avatar name={t.assignee_name} size={22} /> : <span style={{ width: 22 }} />}
                </div>
              ))}
            </Card>
          );
        })
      )}

      {data.updates.length > 0 && (
        <Card style={{ padding: 12, marginTop: 4 }}>
          <Label>Recent activity</Label>
          {data.updates.slice(0, 12).map(u => {
            const t = data.tasks.find(x => x.id === u.task_id);
            return <div key={u.id} style={{ fontSize: 12, color: DS.mut, padding: "4px 0", borderTop: "1px solid " + DS.line }}>
              <b style={{ color: DS.text }}>{u.author_name}</b> {u.kind === "comment" ? "commented" : ""}{t ? <> on <span onClick={() => setOpenTask(t.id)} style={{ color: DS.lime, cursor: "pointer" }}>{t.title}</span></> : ""}: <span style={{ color: DS.text }}>{u.body}</span> <span style={{ color: DS.dim }}>· {ago(u.created_at)}</span>
            </div>;
          })}
        </Card>
      )}

      {openTask && <TaskModal api={api} id={openTask} boot={boot} sections={sections} onOpenView={onOpenView} onEditSeries={onEditSeries}
        onClose={() => { setOpenTask(null); load(); onChanged(); }} onSaved={patchTask}
        onDeleted={(tid) => { setOpenTask(null); setData(x => ({ ...x, tasks: x.tasks.filter(o => o.id !== tid) })); onChanged(); }} />}
    </div>
  );
}

function QuickAdd({ onAdd, onClose }) {
  const [v, setV] = useState("");
  return (
    <div style={{ marginBottom: 8 }}>
      <input autoFocus value={v} onChange={e => setV(e.target.value)} placeholder="Card title - Enter to add"
        onKeyDown={e => { if (e.key === "Enter" && v.trim()) { onAdd(v); setV(""); } if (e.key === "Escape") onClose(); }}
        onBlur={() => { if (!v.trim()) onClose(); }} style={{ ...inputStyle, fontSize: 13, padding: "8px 9px" }} />
    </div>
  );
}

function TaskTile({ t, today, onOpen }) {
  const cl = t.checklist || [], doneCl = cl.filter(x => x.done).length;
  const late = t.status !== "done" && t.due_date && t.due_date < today;
  return (
    <div onClick={onOpen} style={{ background: DS.panel, border: "1px solid " + (late ? "rgba(255,107,90,0.6)" : DS.line), borderLeft: "3px solid " + (t.priority === "high" ? DS.orange : SMAP[t.status].color), borderRadius: 10, padding: "8px 9px", marginBottom: 7, cursor: "pointer" }}>
      {t.section && <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: DS.dim, marginBottom: 3 }}>{t.section}</div>}
      <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3, textDecoration: t.status === "done" ? "line-through" : "none", color: t.status === "done" ? DS.mut : DS.text }}>{t.priority === "high" && t.status !== "done" ? "🔥 " : ""}{t.title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7, fontSize: 11, color: DS.mut }}>
        {cl.length > 0 && <span title="Checklist">☑ {doneCl}/{cl.length}</span>}
        {t.files > 0 && <span title="Files">📎 {t.files}</span>}
        {t.comments > 0 && <span title="Comments">💬 {t.comments}</span>}
        <div style={{ flex: 1 }} />
        <Due date={t.due_date} today={today} done={t.status === "done"} />
        {t.assignee_name && <Avatar name={t.assignee_name} size={22} />}
      </div>
    </div>
  );
}

// ── New project: describe it to Claude, or start blank ──────────────────────
function NewProject({ api, boot, onClose, onCreated }) {
  const [brief, setBrief] = useState("");
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const people = boot.people;
  const ask = async () => { setBusy("draft"); setErr(""); try { const d = await api("ai_draft", { brief }); setDraft(d.draft); } catch (e) { setErr(e.message); } setBusy(""); };
  const blank = () => setDraft({ name: "", summary: "", owner_email: boot.me.email, start_date: null, due_date: null, tasks: [] });
  const create = async () => {
    if (!draft.name.trim()) { setErr("Give the project a name."); return; }
    setBusy("create"); setErr("");
    try { const d = await api("create_project", { project: { name: draft.name, summary: draft.summary, owner_email: draft.owner_email, start_date: draft.start_date, due_date: draft.due_date, team: [...new Set(draft.tasks.map(t => t.assignee_email).filter(Boolean))] }, tasks: draft.tasks.filter(t => t.title.trim()) }); onCreated(d.project.id); }
    catch (e) { setErr(e.message); setBusy(""); }
  };
  const setT = (i, patch) => setDraft(x => ({ ...x, tasks: x.tasks.map((t, j) => j === i ? { ...t, ...patch } : t) }));
  const small = { ...sel, padding: "6px 7px", fontSize: 12 };

  if (!draft) return (
    <Modal onClose={onClose} width={720}>
      <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>✦ New project</div>
      <div style={{ fontSize: 13, color: DS.mut, marginBottom: 10, lineHeight: 1.5 }}>Type it the way you'd say it: what it is, when it has to be done, the pieces, and who's helping. Claude drafts the project and its cards. You review and change anything before it's created.</div>
      <Grow value={brief} onChange={e => setBrief(e.target.value)} minRows={6} placeholder={EXAMPLE} autoFocus />
      {err && <div style={{ color: DS.orange, fontSize: 13, marginTop: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <Btn kind="primary" disabled={brief.trim().length < 8 || busy === "draft"} onClick={ask}>{busy === "draft" ? "Claude is drafting… (about 20 seconds)" : "✦ Draft it with Claude"}</Btn>
        <Btn kind="ghost" onClick={blank}>Start blank</Btn>
        <div style={{ flex: 1 }} />
        <Btn kind="quiet" onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );

  return (
    <Modal onClose={onClose} width={1000}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 19, fontWeight: 800, flex: 1 }}>Review the project</div>
        <Btn small kind="quiet" onClick={() => setDraft(null)}>‹ Back to the brief</Btn>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
        <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Project name" style={{ ...inputStyle, fontWeight: 800 }} />
        <select value={draft.owner_email || ""} onChange={e => setDraft({ ...draft, owner_email: e.target.value || null })} style={{ ...sel, width: "100%" }}><option value="">Owner…</option>{people.map(x => <option key={x.email} value={x.email}>{x.name}</option>)}</select>
        <input type="date" value={draft.start_date || ""} onChange={e => setDraft({ ...draft, start_date: e.target.value || null })} title="Start" style={{ ...sel, width: "100%" }} />
        <input type="date" value={draft.due_date || ""} onChange={e => setDraft({ ...draft, due_date: e.target.value || null })} title="Due" style={{ ...sel, width: "100%" }} />
      </div>
      <Grow value={draft.summary || ""} onChange={e => setDraft({ ...draft, summary: e.target.value })} minRows={2} placeholder="What it's for and what done looks like" />
      <Label style={{ marginTop: 14 }}>Cards · {draft.tasks.length}</Label>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead><tr style={{ fontSize: 11, color: DS.mut, textAlign: "left" }}><th style={{ padding: 4 }}>Section</th><th style={{ padding: 4 }}>Card</th><th style={{ padding: 4 }}>Who</th><th style={{ padding: 4 }}>Due</th><th style={{ padding: 4 }}>Priority</th><th /></tr></thead>
          <tbody>
            {draft.tasks.map((t, i) => (
              <tr key={i} style={{ borderTop: "1px solid " + DS.line, verticalAlign: "top" }}>
                <td style={{ padding: 4, width: 130 }}><input value={t.section || ""} onChange={e => setT(i, { section: e.target.value })} style={{ ...small, width: "100%" }} /></td>
                <td style={{ padding: 4 }}>
                  <input value={t.title} onChange={e => setT(i, { title: e.target.value })} style={{ ...small, width: "100%", fontWeight: 700, fontSize: 13 }} />
                  {(t.details || t.checklist?.length) ? <div style={{ fontSize: 11, color: DS.mut, marginTop: 3, lineHeight: 1.4 }}>{t.details}{t.checklist?.length ? ` (${t.checklist.length} steps)` : ""}</div> : null}
                </td>
                <td style={{ padding: 4, width: 150 }}><select value={t.assignee_email || ""} onChange={e => setT(i, { assignee_email: e.target.value || null })} style={{ ...small, width: "100%" }}><option value="">-</option>{people.map(x => <option key={x.email} value={x.email}>{x.name}</option>)}</select></td>
                <td style={{ padding: 4, width: 140 }}><input type="date" value={t.due_date || ""} onChange={e => setT(i, { due_date: e.target.value || null })} style={{ ...small, width: "100%" }} /></td>
                <td style={{ padding: 4, width: 90 }}><select value={t.priority || "normal"} onChange={e => setT(i, { priority: e.target.value })} style={{ ...small, width: "100%" }}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></td>
                <td style={{ padding: 4, width: 24 }}><span onClick={() => setDraft(x => ({ ...x, tasks: x.tasks.filter((_, j) => j !== i) }))} style={{ cursor: "pointer", color: DS.dim }}>✕</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Btn small kind="link" onClick={() => setDraft(x => ({ ...x, tasks: [...x.tasks, { section: x.tasks[x.tasks.length - 1]?.section || "", title: "", details: "", assignee_email: null, due_date: null, priority: "normal", checklist: [] }] }))} style={{ marginTop: 8 }}>＋ Add a card</Btn>
      {err && <div style={{ color: DS.orange, fontSize: 13, marginTop: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
        <Btn kind="primary" disabled={busy === "create"} onClick={create}>{busy === "create" ? "Creating…" : `Create project${draft.tasks.length ? " with " + draft.tasks.filter(t => t.title.trim()).length + " cards" : ""}`}</Btn>
        <span style={{ fontSize: 12, color: DS.mut }}>Everyone assigned gets one email with their cards{boot.settings.slack ? ", and Slack hears about it" : ""}.</span>
        <div style={{ flex: 1 }} />
        <Btn kind="quiet" onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );
}

// ── Settings: Slack, the emails, categories and departments ────────────────
function ListEditor({ label, items, onSave, busy }) {
  const [v, setV] = useState("");
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, color: DS.mut, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {items.map(x => <span key={x} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.06)", borderRadius: 20, padding: "4px 10px", fontSize: 13 }}>{x}<span onClick={() => !busy && items.length > 1 && onSave(items.filter(y => y !== x))} title="Remove" style={{ cursor: "pointer", color: DS.dim }}>✕</span></span>)}
        <input value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && v.trim() && !items.includes(v.trim())) { onSave([...items, v.trim()]); setV(""); } }} placeholder="+ Add (Enter)" style={{ ...sel, width: 150 }} />
      </div>
    </div>
  );
}
function Settings({ api, boot, onClose, onSaved }) {
  const s = boot.settings;
  const [hook, setHook] = useState("");
  const [ids, setIds] = useState(() => ({ ...(s.slackIds || {}) }));
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => { setBusy(true); setMsg(""); try { await fn(); setMsg(ok); await onSaved(); } catch (e) { setMsg("⚠ " + e.message); } setBusy(false); };
  return (
    <Modal onClose={onClose} width={680}>
      <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 12 }}>⚙ Tasks &amp; Projects settings</div>
      <Label>Slack</Label>
      <div style={{ fontSize: 13, color: DS.mut, lineHeight: 1.55, marginBottom: 8 }}>
        {s.slack ? <>✅ Connected{s.slackFromEnv ? " (from the server settings)" : ""}. New tasks, status changes, blockers, assignments, comments, help requests and files post one line each; a digest goes out every morning and a project check-in on Mondays.</> : <>Not connected yet. In Slack: <b>Apps → search "Incoming Webhooks"</b> (or api.slack.com/apps → your app → Incoming Webhooks) → <b>Add to Slack</b> → pick the channel (for example #dssc-tasks) → copy the Webhook URL and paste it here.</>}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={hook} onChange={e => setHook(e.target.value)} placeholder="https://hooks.slack.com/services/…" style={{ ...inputStyle, flex: "1 1 300px" }} />
        <Btn kind="primary" disabled={busy || !hook.trim()} onClick={() => run(() => api("settings", { slack_webhook: hook.trim() }), "Saved - check Slack for the test message.")}>Save &amp; test</Btn>
        {s.slack && <Btn kind="ghost" disabled={busy} onClick={() => run(() => api("test_slack"), "Sent a test to Slack.")}>Send a test</Btn>}
        {s.slack && !s.slackFromEnv && <Btn kind="quiet" disabled={busy} onClick={() => window.confirm("Stop posting to Slack?") && run(() => api("settings", { slack_webhook: "" }), "Slack disconnected.")}>Disconnect</Btn>}
      </div>
      <div style={{ fontSize: 13, color: DS.mut, lineHeight: 1.5, margin: "12px 0 6px" }}>
        <b style={{ color: DS.text }}>@mentions.</b> Add each person's Slack member ID so posts ping them (Slack: click their name → <b>⋮ More → Copy member ID</b>; it looks like U0123ABCD).
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 6 }}>
        {boot.people.map(p => (
          <label key={p.email} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <Avatar name={p.name} size={22} /><span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
            <input value={ids[p.email] || ""} onChange={e => setIds(x => ({ ...x, [p.email]: e.target.value.trim() }))} placeholder="U0123ABCD" style={{ ...sel, width: 120 }} />
          </label>
        ))}
      </div>
      <Btn small kind="ghost" disabled={busy} onClick={() => run(() => api("settings", { slack_ids: ids }), "Slack member IDs saved.")} style={{ marginTop: 8 }}>Save member IDs</Btn>

      <Label style={{ marginTop: 18 }}>Morning Slack digest</Label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
        <input type="checkbox" checked={s.dailyDigest} disabled={busy} onChange={e => run(() => api("settings", { daily_digest: e.target.checked }), e.target.checked ? "The morning digest is on." : "The morning digest is off.")} style={{ accentColor: DS.lime, width: 16, height: 16 }} />
        Every morning at 7:45, post each person's tasks due today, overdue and blocked, plus open help requests.
      </label>
      {s.lastDailyAt && <div style={{ fontSize: 12, color: DS.dim, marginTop: 6 }}>Last run {new Date(s.lastDailyAt).toLocaleString()}.</div>}

      <Label style={{ marginTop: 18 }}>Monday email</Label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
        <input type="checkbox" checked={s.weeklyEmail} disabled={busy} onChange={e => run(() => api("settings", { weekly_email: e.target.checked }), e.target.checked ? "The Monday email is on." : "The Monday email is off.")} style={{ accentColor: DS.lime, width: 16, height: 16 }} />
        Every Monday at 8am, email each person their tasks that are overdue, due this week, blocked, or haven't had an update in a week, plus a progress line for each project they own.
      </label>
      {s.lastWeeklyAt && <div style={{ fontSize: 12, color: DS.dim, marginTop: 6 }}>Last sent {new Date(s.lastWeeklyAt).toLocaleString()}.</div>}

      <Label style={{ marginTop: 18 }}>Categories &amp; departments</Label>
      <ListEditor label="Categories (what kind of work)" items={s.categories || []} busy={busy} onSave={(list) => run(() => api("settings", { categories: list }), "Categories saved.")} />
      <ListEditor label="Departments (who it touches; a task can be in several)" items={s.departments || []} busy={busy} onSave={(list) => run(() => api("settings", { departments: list }), "Departments saved.")} />

      {msg && <div style={{ marginTop: 12, fontSize: 13, color: msg.startsWith("⚠") ? DS.orange : DS.lime }}>{msg}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}><Btn kind="quiet" onClick={onClose}>Done</Btn></div>
    </Modal>
  );
}
