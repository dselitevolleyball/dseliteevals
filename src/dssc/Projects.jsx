// DSSC Projects (Drew, Oct 14 2026): "a project menu within the DSSC HQ ...
// to assign projects and track to-dos and completions" - e.g. Heatwave's
// Inaugural Winter Edition (coach, launch plan, marketing plan, brand/swag
// order, player selection) and DS Fall Fest Activations (Jonathan).
//
// Projects hold task cards: details, checklist, files, a comment thread,
// an assignee and helpers, a due date. Cards sit on a board (To do / In
// progress / Blocked / Done) or a list by section. "My cards" gathers
// everything assigned to you. Managers can describe a project in plain words
// and Claude drafts it (they review it before anything is created).
// Everything goes through /api/projects, which posts to Slack and emails
// assignees; /api/projects-weekly sends the Monday "needs an update" email.
import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Card, Label, Tag, inputStyle, Field, Grow } from "./DsscHub.jsx";

const STATUS = [["todo", "To do", "#A9C7C3"], ["doing", "In progress", "#B2D049"], ["blocked", "Blocked", "#FF7300"], ["done", "Done", "#2fbf9b"]];
const SMAP = Object.fromEntries(STATUS.map(([k, label, color]) => [k, { label, color }]));
const PSTATUS = [["planning", "Planning"], ["active", "Active"], ["on_hold", "On hold"], ["done", "Done"], ["archived", "Archived"]];
const PCOLOR = { planning: "#A9C7C3", active: "#B2D049", on_hold: "#FF7300", done: "#2fbf9b", archived: "#6F9995" };
const EXAMPLE = "Heatwave - Inaugural Winter Edition. We need to get everything together and launched: lock in a lead coach for each session, a launch plan, a marketing plan, finalize the brand order and swag, select the players, and plan the sessions. Hunter helps with coaches and players, Kristen with the swag order.";

async function realApi(action, payload = {}) {
  const { data: { session } = {} } = await supabase.auth.getSession();
  const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify({ action, ...payload }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || "Request failed (" + r.status + ")");
  return d;
}

const fmtD = (ymd) => ymd ? new Date(ymd + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
const fmtDW = (ymd) => ymd ? new Date(ymd + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
const ago = (iso) => { const s = (Date.now() - Date.parse(iso)) / 1000; if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; if (s < 86400) return Math.floor(s / 3600) + "h ago"; if (s < 7 * 86400) return Math.floor(s / 86400) + "d ago"; return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
const initials = (name) => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
const kb = (n) => n == null ? "" : n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1024 / 1024).toFixed(1) + " MB";
const sel = { ...inputStyle, padding: "7px 9px", fontSize: 13, width: "auto", colorScheme: "dark" };

function Avatar({ name, size = 24, title }) {
  return <span title={title || name} style={{ width: size, height: size, borderRadius: size, background: DS.brier, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.42, fontWeight: 800, flex: "0 0 auto" }}>{initials(name)}</span>;
}
function Due({ date, today, done }) {
  if (!date) return null;
  const d = daysBetween(today, date);
  const late = !done && d < 0, close = !done && d >= 0 && d <= 3;
  return <span style={{ fontSize: 11, fontWeight: 700, color: late ? "#ff6b5a" : close ? DS.orange : DS.mut, whiteSpace: "nowrap" }}>{late ? `${-d}d late · ` : d === 0 && !done ? "today · " : ""}{fmtD(date)}</span>;
}
function Progress({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return <div style={{ height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 4, overflow: "hidden" }}><div style={{ width: pct + "%", height: 6, background: DS.lime }} /></div>;
}
function Modal({ onClose, children, width = 760 }) {
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "4vh 10px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: DS.panel, border: "1px solid " + DS.lineStrong, borderRadius: 16, width: "100%", maxWidth: width, padding: 18, boxSizing: "border-box", fontFamily: DS.font, color: DS.text }}>{children}</div>
    </div>
  );
}

export default function Projects({ coach, apiFn }) {
  const api = apiFn || realApi;
  const [boot, setBoot] = useState(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("projects");          // projects | mine
  const [selId, setSelId] = useState(null);
  const [openTask, setOpenTask] = useState(null);
  const [modal, setModal] = useState(null);             // "new" | "settings"
  const [showDone, setShowDone] = useState(false);

  const load = async () => { try { setBoot(await api("bootstrap", { archived: true })); setErr(""); } catch (e) { setErr(e.message); } };
  useEffect(() => {
    try { const p = new URLSearchParams(window.location.search); if (p.get("project")) setSelId(Number(p.get("project"))); if (p.get("task")) setOpenTask(Number(p.get("task"))); } catch { /* ignore */ }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Keep the address shareable: ?view=projects&project=..&task=..
  useEffect(() => {
    try { const u = new URL(window.location.href); selId ? u.searchParams.set("project", selId) : u.searchParams.delete("project"); openTask ? u.searchParams.set("task", openTask) : u.searchParams.delete("task"); window.history.replaceState(window.history.state, "", u); } catch { /* ignore */ }
  }, [selId, openTask]);

  if (err && !boot) return <div style={{ padding: 24, color: DS.orange, fontFamily: DS.font }}>{err}</div>;
  if (!boot) return <div style={{ padding: 24, color: DS.mut, fontFamily: DS.font }}>Loading projects…</div>;
  const manager = !!boot.me?.manager;

  if (selId) return (
    <ProjectView api={api} id={selId} boot={boot} openTask={openTask} setOpenTask={setOpenTask}
      onBack={() => { setSelId(null); setOpenTask(null); load(); }} onChanged={load} />
  );

  const visible = boot.projects.filter(p => showDone ? true : !["done", "archived"].includes(p.status));
  return (
    <div style={{ fontFamily: DS.font, color: DS.text, maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>📌 Projects</div>
        <div style={{ display: "inline-flex", border: "1px solid " + DS.lineStrong, borderRadius: 9, overflow: "hidden" }}>
          {[["projects", "Projects"], ["mine", `My cards${boot.myTasks.length ? " (" + boot.myTasks.length + ")" : ""}`]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ padding: "7px 13px", border: "none", background: tab === k ? DS.lime : "transparent", color: tab === k ? DS.bg : DS.mut, fontFamily: DS.font, fontWeight: 800, fontSize: 13, cursor: "pointer" }}>{l}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {manager && <Btn kind="primary" onClick={() => setModal("new")}>✦ New project</Btn>}
        {manager && <Btn kind="quiet" onClick={() => setModal("settings")} title="Slack updates and the Monday email">⚙ Slack &amp; email</Btn>}
      </div>

      {tab === "mine" ? <MyCards boot={boot} onOpen={(t) => { setSelId(t.project_id); setOpenTask(t.id); }} /> : (<>
        {!visible.length && <Card><div style={{ color: DS.mut, fontSize: 14 }}>{boot.projects.length ? "No open projects." : manager ? "No projects yet. Tap ✦ New project and describe one - Claude will draft the cards for you." : "No projects yet."}</div></Card>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {visible.map(p => <ProjectCard key={p.id} p={p} today={boot.today} onOpen={() => setSelId(p.id)} />)}
        </div>
        {boot.projects.some(p => ["done", "archived"].includes(p.status)) && <div style={{ marginTop: 12 }}><Btn kind="link" onClick={() => setShowDone(v => !v)}>{showDone ? "Hide finished projects" : "Show finished and archived projects"}</Btn></div>}
      </>)}

      {modal === "new" && <NewProject api={api} boot={boot} onClose={() => setModal(null)} onCreated={(id) => { setModal(null); load(); setSelId(id); }} />}
      {modal === "settings" && <Settings api={api} boot={boot} onClose={() => setModal(null)} onSaved={load} />}
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

function MyCards({ boot, onOpen }) {
  const today = boot.today, week = new Date(Date.parse(today + "T12:00:00Z") + 7 * 864e5).toISOString().slice(0, 10);
  const groups = [
    ["Overdue", boot.myTasks.filter(t => t.due_date && t.due_date < today)],
    ["This week", boot.myTasks.filter(t => t.due_date && t.due_date >= today && t.due_date <= week)],
    ["Later", boot.myTasks.filter(t => t.due_date && t.due_date > week)],
    ["No due date", boot.myTasks.filter(t => !t.due_date)],
  ].filter(g => g[1].length);
  if (!groups.length) return <Card><div style={{ color: DS.mut }}>Nothing assigned to you right now. 🎉</div></Card>;
  return groups.map(([title, list]) => (
    <Card key={title} style={{ padding: 12 }}>
      <Label>{title} · {list.length}</Label>
      {list.map(t => (
        <div key={t.id} onClick={() => onOpen(t)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderTop: "1px solid " + DS.line, cursor: "pointer" }}>
          <span style={{ width: 9, height: 9, borderRadius: 9, background: SMAP[t.status].color, flex: "0 0 auto" }} title={SMAP[t.status].label} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{t.title}</div>
            <div style={{ fontSize: 12, color: DS.mut }}>{t.project_name}{t.section ? " · " + t.section : ""} · {SMAP[t.status].label}</div>
          </div>
          <Due date={t.due_date} today={today} />
        </div>
      ))}
    </Card>
  ));
}

// ── One project: header, board / list, activity ─────────────────────────────
function ProjectView({ api, id, boot, openTask, setOpenTask, onBack, onChanged }) {
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
          {STATUS.map(([k, label, color]) => {
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

      {openTask && <TaskModal api={api} id={openTask} project={p} boot={boot} sections={sections}
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

// ── The card ────────────────────────────────────────────────────────────────
function TaskModal({ api, id, project, boot, sections, onClose, onSaved, onDeleted }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState("");
  const [newItem, setNewItem] = useState("");
  const fileRef = useRef(null);
  const people = boot.people, me = boot.me, today = boot.today;
  const load = async () => { try { setD(await api("task", { id })); setErr(""); } catch (e) { setErr(e.message); } };
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Modal onClose={onClose}><div style={{ color: DS.orange }}>{err}</div></Modal>;
  if (!d) return <Modal onClose={onClose}><div style={{ color: DS.mut }}>Loading the card…</div></Modal>;
  const t = d.task;
  const save = async (patch) => {
    setD(x => ({ ...x, task: { ...x.task, ...patch } }));
    try { const r = await api("save_task", { task: { id: t.id, ...patch } }); setD(x => ({ ...x, task: { ...x.task, ...r.task } })); onSaved(r.task); if (patch.status || "assignee_email" in patch || "due_date" in patch) load(); }
    catch (e) { window.alert(e.message); load(); }
  };
  const cl = t.checklist || [];
  const setCl = (next) => save({ checklist: next });
  const post = async () => { if (!comment.trim()) return; setBusy("comment"); try { await api("comment", { project_id: project.id, task_id: t.id, body: comment }); setComment(""); await load(); } catch (e) { window.alert(e.message); } setBusy(""); };
  const upload = async (files) => {
    setBusy("upload");
    try {
      for (const f of files) {
        if (f.size > 25 * 1024 * 1024) { window.alert(f.name + " is over 25 MB."); continue; }
        const u = await api("upload_url", { project_id: project.id, task_id: t.id, name: f.name, size: f.size, mime: f.type });
        if (!u.local) {
          const { error } = await supabase.storage.from("dssc-projects").uploadToSignedUrl(u.path, u.token, f, { contentType: f.type || "application/octet-stream" });
          if (error) throw new Error(error.message);
        }
        await api("file_done", { project_id: project.id, task_id: t.id, name: f.name, path: u.path, size: f.size, mime: f.type });
      }
      await load(); onSaved({ id: t.id, files: (d.files.length || 0) + files.length });
    } catch (e) { window.alert("Upload failed: " + e.message); }
    if (fileRef.current) fileRef.current.value = "";
    setBusy("");
  };
  const openFile = async (f, download) => { const w = window.open("", "_blank"); try { const { url } = await api("file_url", { id: f.id, download }); if (w) w.location = url; else window.location.href = url; } catch (e) { if (w) w.close(); window.alert(e.message); } };
  const delFile = async (f) => { if (!window.confirm("Remove " + f.name + "?")) return; try { await api("delete_file", { id: f.id }); await load(); } catch (e) { window.alert(e.message); } };
  const delCard = async () => { if (!window.confirm("Delete this card and its files? This can't be undone.")) return; try { await api("delete_task", { id: t.id }); onDeleted(t.id); } catch (e) { window.alert(e.message); } };
  const canDelete = me.manager || t.created_by === me.email;
  const row = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13, color: DS.mut };

  return (
    <Modal onClose={onClose}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: DS.dim, marginBottom: 2 }}>{project.name}{t.section ? " · " + t.section : ""}</div>
          <Field value={t.title} onSave={(v) => v.trim() && save({ title: v })} style={{ fontSize: 19, fontWeight: 800, background: "transparent", border: "1px solid transparent", padding: "3px 4px" }} />
        </div>
        <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: DS.mut, fontSize: 20, cursor: "pointer" }}>✕</button>
      </div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", margin: "10px 0 12px" }}>
        {STATUS.map(([k, label, color]) => (
          <button key={k} onClick={() => t.status !== k && save({ status: k })} style={{ padding: "7px 12px", borderRadius: 20, border: "1px solid " + (t.status === k ? color : DS.lineStrong), background: t.status === k ? color : "transparent", color: t.status === k ? DS.bg : DS.mut, fontFamily: DS.font, fontWeight: 800, fontSize: 12, cursor: "pointer" }}>{k === "done" && t.status !== "done" ? "✓ " : ""}{label}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 12 }}>
        <label style={{ ...row, flexDirection: "column", alignItems: "stretch", gap: 4 }}>Assigned to
          <select value={t.assignee_email || ""} onChange={e => save({ assignee_email: e.target.value || null })} style={{ ...sel, width: "100%" }}><option value="">Unassigned</option>{people.map(x => <option key={x.email} value={x.email}>{x.name}</option>)}</select>
        </label>
        <label style={{ ...row, flexDirection: "column", alignItems: "stretch", gap: 4 }}>Due
          <input type="date" value={t.due_date || ""} onChange={e => save({ due_date: e.target.value || null })} style={{ ...sel, width: "100%" }} />
        </label>
        <label style={{ ...row, flexDirection: "column", alignItems: "stretch", gap: 4 }}>Priority
          <select value={t.priority} onChange={e => save({ priority: e.target.value })} style={{ ...sel, width: "100%" }}><option value="low">Low</option><option value="normal">Normal</option><option value="high">🔥 High</option></select>
        </label>
        <label style={{ ...row, flexDirection: "column", alignItems: "stretch", gap: 4 }}>Section
          <input list={"sections-" + project.id} defaultValue={t.section || ""} onBlur={e => (e.target.value.trim() || null) !== (t.section || null) && save({ section: e.target.value.trim() || null })} placeholder="e.g. Marketing" style={{ ...sel, width: "100%" }} />
          <datalist id={"sections-" + project.id}>{sections.map(s => <option key={s} value={s} />)}</datalist>
        </label>
      </div>
      <div style={{ ...row, marginBottom: 12 }}>Helping
        {(t.helpers || []).map(h => <span key={h.email} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(255,255,255,0.06)", borderRadius: 20, padding: "2px 8px 2px 2px" }}><Avatar name={h.name} size={20} /><span style={{ color: DS.text, fontSize: 12 }}>{h.name}</span><span onClick={() => save({ helpers: (t.helpers || []).filter(x => x.email !== h.email).map(x => x.email) })} style={{ cursor: "pointer", color: DS.dim }}>✕</span></span>)}
        <select value="" onChange={e => e.target.value && save({ helpers: [...(t.helpers || []).map(x => x.email), e.target.value] })} style={{ ...sel, padding: "4px 6px", fontSize: 12 }}><option value="">+ add</option>{people.filter(x => x.email !== t.assignee_email && !(t.helpers || []).some(h => h.email === x.email)).map(x => <option key={x.email} value={x.email}>{x.name}</option>)}</select>
      </div>

      <Label>Details</Label>
      <Field multiline minRows={3} value={t.details || ""} onSave={(v) => save({ details: v })} placeholder="What needs to happen, links, decisions…" />

      <Label style={{ marginTop: 14 }}>Checklist {cl.length ? `· ${cl.filter(x => x.done).length}/${cl.length}` : ""}</Label>
      {cl.map((c, i) => (
        <div key={c.id || i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
          <input type="checkbox" checked={!!c.done} onChange={() => setCl(cl.map((x, j) => j === i ? { ...x, done: !x.done } : x))} style={{ accentColor: DS.lime, width: 16, height: 16 }} />
          <span style={{ flex: 1, fontSize: 14, textDecoration: c.done ? "line-through" : "none", color: c.done ? DS.mut : DS.text }}>{c.text}</span>
          <span onClick={() => setCl(cl.filter((_, j) => j !== i))} style={{ cursor: "pointer", color: DS.dim, fontSize: 12 }}>✕</span>
        </div>
      ))}
      <input value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && newItem.trim()) { setCl([...cl, { id: "c" + Date.now().toString(36), text: newItem.trim(), done: false }]); setNewItem(""); } }} placeholder="+ Add a step (Enter)" style={{ ...inputStyle, fontSize: 13, padding: "7px 9px", marginTop: 4 }} />

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}><Label style={{ marginBottom: 0 }}>Files</Label><div style={{ flex: 1 }} />
        <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={e => e.target.files?.length && upload([...e.target.files])} />
        <Btn small kind="ghost" disabled={busy === "upload"} onClick={() => fileRef.current?.click()}>{busy === "upload" ? "Uploading…" : "📎 Add files"}</Btn>
      </div>
      {d.files.length ? d.files.map(f => (
        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid " + DS.line, fontSize: 13 }}>
          <span onClick={() => openFile(f)} style={{ color: DS.lime, cursor: "pointer", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
          <span style={{ color: DS.dim, fontSize: 11, whiteSpace: "nowrap" }}>{kb(f.size)} · {f.uploaded_by} · {ago(f.created_at)}</span>
          <span onClick={() => openFile(f, true)} title="Download" style={{ cursor: "pointer" }}>⬇</span>
          {(me.manager || f.uploaded_by === me.name) && <span onClick={() => delFile(f)} title="Remove" style={{ cursor: "pointer", color: DS.dim }}>✕</span>}
        </div>
      )) : <div style={{ fontSize: 12, color: DS.dim, marginTop: 4 }}>No files yet - add a plan, a quote, a mockup, a photo…</div>}

      <Label style={{ marginTop: 16 }}>Updates</Label>
      {d.updates.map(u => u.kind === "comment" ? (
        <div key={u.id} style={{ display: "flex", gap: 8, padding: "7px 0", borderTop: "1px solid " + DS.line }}>
          <Avatar name={u.author_name} size={26} />
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12, color: DS.mut }}><b style={{ color: DS.text }}>{u.author_name}</b> · {ago(u.created_at)}</div><div style={{ fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{u.body}</div></div>
        </div>
      ) : (
        <div key={u.id} style={{ fontSize: 12, color: DS.dim, padding: "4px 0 4px 34px" }}>{u.author_name} · {u.body} · {ago(u.created_at)}</div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}><Grow value={comment} onChange={e => setComment(e.target.value)} minRows={2} placeholder="Post an update - where it stands, what's next, what you need" onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post(); }} /></div>
        <Btn kind="primary" disabled={!comment.trim() || busy === "comment"} onClick={post}>{busy === "comment" ? "…" : "Post"}</Btn>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: 11, color: DS.dim }}>
        <span>{t.created_by ? "Added by " + (people.find(x => x.email === t.created_by)?.name || t.created_by) + " · " : ""}{t.completed_at ? "Done " + ago(t.completed_at) : "Last update " + ago(t.last_activity_at)}</span>
        <div style={{ flex: 1 }} />
        {canDelete && <Btn small kind="quiet" onClick={delCard} style={{ color: "#ff6b5a" }}>Delete card</Btn>}
      </div>
      {t.due_date && t.status !== "done" && t.due_date < today && <div style={{ marginTop: 8, fontSize: 12, color: "#ff6b5a" }}>This card is past due. Post an update or move the date.</div>}
    </Modal>
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

// ── Slack + Monday email ────────────────────────────────────────────────────
function Settings({ api, boot, onClose, onSaved }) {
  const s = boot.settings;
  const [hook, setHook] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => { setBusy(true); setMsg(""); try { await fn(); setMsg(ok); onSaved(); } catch (e) { setMsg("⚠ " + e.message); } setBusy(false); };
  return (
    <Modal onClose={onClose} width={620}>
      <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 12 }}>⚙ Slack &amp; email</div>
      <Label>Slack</Label>
      <div style={{ fontSize: 13, color: DS.mut, lineHeight: 1.55, marginBottom: 8 }}>
        {s.slack ? <>✅ Connected{s.slackFromEnv ? " (from the server settings)" : ""}. New cards, status changes, assignments, comments and files post one line each, and a weekly digest goes out Monday mornings.</> : <>Not connected yet. In Slack: <b>Apps → search "Incoming Webhooks"</b> (or api.slack.com/apps → your app → Incoming Webhooks) → <b>Add to Slack</b> → pick the channel (for example #dssc-projects) → copy the Webhook URL and paste it here.</>}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={hook} onChange={e => setHook(e.target.value)} placeholder="https://hooks.slack.com/services/…" style={{ ...inputStyle, flex: "1 1 300px" }} />
        <Btn kind="primary" disabled={busy || !hook.trim()} onClick={() => run(() => api("settings", { slack_webhook: hook.trim() }), "Saved - check Slack for the test message.")}>Save &amp; test</Btn>
        {s.slack && <Btn kind="ghost" disabled={busy} onClick={() => run(() => api("test_slack"), "Sent a test to Slack.")}>Send a test</Btn>}
        {s.slack && !s.slackFromEnv && <Btn kind="quiet" disabled={busy} onClick={() => window.confirm("Stop posting to Slack?") && run(() => api("settings", { slack_webhook: "" }), "Slack disconnected.")}>Disconnect</Btn>}
      </div>
      <Label style={{ marginTop: 18 }}>Monday email</Label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
        <input type="checkbox" checked={s.weeklyEmail} disabled={busy} onChange={e => run(() => api("settings", { weekly_email: e.target.checked }), e.target.checked ? "The Monday email is on." : "The Monday email is off.")} style={{ accentColor: DS.lime, width: 16, height: 16 }} />
        Every Monday at 8am, email each person their cards that are overdue, due this week, blocked, or haven't had an update in a week, plus a progress line for each project they own.
      </label>
      {s.lastWeeklyAt && <div style={{ fontSize: 12, color: DS.dim, marginTop: 6 }}>Last sent {new Date(s.lastWeeklyAt).toLocaleString()}.</div>}
      {msg && <div style={{ marginTop: 12, fontSize: 13, color: msg.startsWith("⚠") ? DS.orange : DS.lime }}>{msg}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}><Btn kind="quiet" onClick={onClose}>Done</Btn></div>
    </Modal>
  );
}
