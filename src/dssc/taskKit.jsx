// Pieces shared by Tasks & Projects (src/dssc/Projects.jsx, src/dssc/Tasks.jsx):
// the API call, formatting, small badges, the modal shell, and the task window
// itself - the same for a project card and a standalone task (Drew, Oct 28
// 2026: notes and details, deadlines, blockers, asking for help, and a way
// into the HQ screen the work happens in).
import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Label, Tag, inputStyle, Field, Grow } from "./DsscHub.jsx";
import { HQ_VIEWS, hqLabel, timeliness } from "../../shared/task-meta.js";
import { describeRepeat } from "../../shared/task-recurrence.js";

export async function realApi(action, payload = {}) {
  const { data: { session } = {} } = await supabase.auth.getSession();
  const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify({ action, ...payload }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || "Request failed (" + r.status + ")");
  return d;
}

export const STATUS = [["todo", "To do", "#A9C7C3"], ["doing", "In progress", "#B2D049"], ["blocked", "Blocked", "#FF7300"], ["done", "Done", "#2fbf9b"], ["skipped", "Skipped", "#6F9995"]];
export const SMAP = Object.fromEntries(STATUS.map(([k, label, color]) => [k, { label, color }]));
export const BOARD_STATUS = STATUS.slice(0, 4);
export const LATE = "#ff6b5a", HELP = "#c58bff";
export const isOpen = (t) => t && t.status !== "done" && t.status !== "skipped";

export const fmtD = (ymd) => ymd ? new Date(ymd + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
export const fmtDW = (ymd) => ymd ? new Date(ymd + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
export const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
export const plusDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const ago = (iso) => { const s = (Date.now() - Date.parse(iso)) / 1000; if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; if (s < 86400) return Math.floor(s / 3600) + "h ago"; if (s < 7 * 86400) return Math.floor(s / 86400) + "d ago"; return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
export const initials = (name) => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
export const firstName = (name) => String(name || "").split(/\s+/)[0] || name || "";
const kb = (n) => n == null ? "" : n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1024 / 1024).toFixed(1) + " MB";
export const sel = { ...inputStyle, padding: "7px 9px", fontSize: 13, width: "auto", colorScheme: "dark" };

export function Avatar({ name, size = 24, title, ring }) {
  return <span title={title || name} style={{ width: size, height: size, borderRadius: size, background: DS.brier, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.42, fontWeight: 800, flex: "0 0 auto", boxShadow: ring ? "0 0 0 2px " + ring : "none" }}>{initials(name)}</span>;
}
export function Due({ date, today, done }) {
  if (!date) return null;
  const d = daysBetween(today, date);
  const late = !done && d < 0, close = !done && d >= 0 && d <= 3;
  return <span style={{ fontSize: 11, fontWeight: 700, color: late ? LATE : close ? DS.orange : DS.mut, whiteSpace: "nowrap" }}>{late ? `${-d}d late · ` : d === 0 && !done ? "today · " : ""}{fmtD(date)}</span>;
}
export function Progress({ done, total, color = DS.lime }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return <div style={{ height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 4, overflow: "hidden" }}><div style={{ width: pct + "%", height: 6, background: color }} /></div>;
}
export function Modal({ onClose, children, width = 760 }) {
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "4vh 10px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: DS.panel, border: "1px solid " + DS.lineStrong, borderRadius: 16, width: "100%", maxWidth: width, padding: 18, boxSizing: "border-box", fontFamily: DS.font, color: DS.text }}>{children}</div>
    </div>
  );
}
export const chip = (on, color = DS.lime) => ({ fontFamily: DS.font, fontSize: 12, fontWeight: 700, padding: "5px 11px", borderRadius: 999, cursor: "pointer", border: "1px solid " + (on ? color : DS.line), background: on ? color + "22" : "transparent", color: on ? color : DS.mut, whiteSpace: "nowrap" });
export function Seg({ value, onChange, options, small }) {
  return (
    <div style={{ display: "inline-flex", border: "1px solid " + DS.lineStrong, borderRadius: 9, overflowX: "auto", overflowY: "hidden", flex: "0 1 auto", maxWidth: "100%" }}>
      {options.map(([k, l]) => <button key={k} onClick={() => onChange(k)} style={{ padding: small ? "5px 10px" : "7px 13px", border: "none", background: value === k ? DS.lime : "transparent", color: value === k ? DS.bg : DS.mut, fontFamily: DS.font, fontWeight: 800, fontSize: small ? 12 : 13, cursor: "pointer", whiteSpace: "nowrap" }}>{l}</button>)}
    </div>
  );
}
// Category, departments and the little flags a task carries.
export function TaskBadges({ t, compact }) {
  return (
    <>
      {t.series_id && <span title="Repeating task" style={{ fontSize: 11 }}>🔁</span>}
      {t.help_requested_at && <span title={"Asked for help: " + (t.help_note || "")} style={{ fontSize: 11, color: HELP, fontWeight: 800 }}>🙋{compact ? "" : " help"}</span>}
      {t.status === "blocked" && compact && <span title={t.blocker ? "Blocked on: " + t.blocker : "Blocked"} style={{ fontSize: 11, color: DS.orange, fontWeight: 800 }}>⛔</span>}
      {t.category && <Tag color="#7FD1C3">{t.category}</Tag>}
      {!compact && (t.departments || []).map(d => <Tag key={d} color={DS.mut}>{d}</Tag>)}
      {t.hq_view && <span title={"Opens " + hqLabel(t.hq_view)} style={{ fontSize: 11, color: DS.dim }}>↗ {compact ? "" : hqLabel(t.hq_view)}</span>}
    </>
  );
}
const TIME_LABEL = { on_time: ["On time", "#2fbf9b"], late: ["Done late", DS.orange], missed: ["Missed", LATE], overdue: ["Overdue", LATE] };

// ── The task window ─────────────────────────────────────────────────────────
// boot: the bootstrap (me, people, projects, settings). onOpenView(view) jumps
// to another HQ screen; onEditSeries(series) opens the repeat's settings.
export function TaskModal({ api, id, boot, sections = [], onClose, onSaved, onDeleted, onOpenView, onEditSeries }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState("");
  const [newItem, setNewItem] = useState("");
  const [asking, setAsking] = useState(null);           // { from, note } while the help form is open
  const fileRef = useRef(null);
  const people = boot.people, me = boot.me, today = boot.today, st = boot.settings || {};
  const load = async () => { try { setD(await api("task", { id })); setErr(""); } catch (e) { setErr(e.message); } };
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Modal onClose={onClose}><div style={{ color: DS.orange }}>{err}</div></Modal>;
  if (!d) return <Modal onClose={onClose}><div style={{ color: DS.mut }}>Loading the task…</div></Modal>;
  const t = d.task, project = d.project, series = d.series;
  const save = async (patch) => {
    setD(x => ({ ...x, task: { ...x.task, ...patch } }));
    try { const r = await api("save_task", { task: { id: t.id, ...patch } }); setD(x => ({ ...x, task: { ...x.task, ...r.task } })); onSaved?.(r.task); if (patch.status || "assignee_email" in patch || "due_date" in patch || "project_id" in patch) load(); }
    catch (e) { window.alert(e.message); load(); }
  };
  const setStatus = (k) => {
    if (t.status === k) return;
    if (k === "blocked") {
      const why = window.prompt("What's it blocked on? (who or what you're waiting for)", t.blocker || "");
      if (why === null) return;
      save({ status: "blocked", blocker: why.trim() || null });
    } else save({ status: k });
  };
  const cl = t.checklist || [];
  const setCl = (next) => save({ checklist: next });
  const post = async () => { if (!comment.trim()) return; setBusy("comment"); try { await api("comment", { task_id: t.id, body: comment }); setComment(""); await load(); } catch (e) { window.alert(e.message); } setBusy(""); };
  const askHelp = async () => { if (!asking?.note.trim()) return; setBusy("help"); try { await api("help", { task_id: t.id, note: asking.note.trim(), from_email: asking.from || null }); setAsking(null); await load(); onSaved?.({ id: t.id, help_requested_at: new Date().toISOString(), help_note: asking.note.trim() }); } catch (e) { window.alert(e.message); } setBusy(""); };
  const helpDone = async () => { setBusy("help"); try { await api("help_done", { task_id: t.id }); await load(); onSaved?.({ id: t.id, help_requested_at: null, help_note: null, help_from: null }); } catch (e) { window.alert(e.message); } setBusy(""); };
  const upload = async (files) => {
    setBusy("upload");
    try {
      for (const f of files) {
        if (f.size > 25 * 1024 * 1024) { window.alert(f.name + " is over 25 MB."); continue; }
        const where = { project_id: t.project_id || undefined, task_id: t.id };
        const u = await api("upload_url", { ...where, name: f.name, size: f.size, mime: f.type });
        if (!u.local) {
          const { error } = await supabase.storage.from("dssc-projects").uploadToSignedUrl(u.path, u.token, f, { contentType: f.type || "application/octet-stream" });
          if (error) throw new Error(error.message);
        }
        await api("file_done", { ...where, name: f.name, path: u.path, size: f.size, mime: f.type });
      }
      await load(); onSaved?.({ id: t.id, files: (d.files.length || 0) + files.length });
    } catch (e) { window.alert("Upload failed: " + e.message); }
    if (fileRef.current) fileRef.current.value = "";
    setBusy("");
  };
  const openFile = async (f, download) => { const w = window.open("", "_blank"); try { const { url } = await api("file_url", { id: f.id, download }); if (w) w.location = url; else window.location.href = url; } catch (e) { if (w) w.close(); window.alert(e.message); } };
  const delFile = async (f) => { if (!window.confirm("Remove " + f.name + "?")) return; try { await api("delete_file", { id: f.id }); await load(); } catch (e) { window.alert(e.message); } };
  const delCard = async () => { if (!window.confirm("Delete this task and its files? This can't be undone.")) return; try { await api("delete_task", { id: t.id }); onDeleted?.(t.id); } catch (e) { window.alert(e.message); } };
  const canDelete = me.manager || t.created_by === me.email;
  const row = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13, color: DS.mut };
  const col = { ...row, flexDirection: "column", alignItems: "stretch", gap: 4 };
  const cats = [...new Set([...(st.categories || []), ...(t.category ? [t.category] : [])])];
  const depts = [...new Set([...(st.departments || []), ...(t.departments || [])])];
  const projects = (boot.projects || []).filter(p => !["archived"].includes(p.status) || p.id === t.project_id);
  const tl = timeliness(t, today);
  const pName = (email) => people.find(p => p.email === email)?.name || email;

  return (
    <Modal onClose={onClose}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: DS.dim, marginBottom: 2 }}>{project ? "📌 " + project.name + (t.section ? " · " + t.section : "") : "Task"}{series ? " · 🔁 " + describeRepeat(series) : ""}</div>
          <Field value={t.title} onSave={(v) => v.trim() && save({ title: v })} style={{ fontSize: 19, fontWeight: 800, background: "transparent", border: "1px solid transparent", padding: "3px 4px" }} />
        </div>
        <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: DS.mut, fontSize: 20, cursor: "pointer" }}>✕</button>
      </div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", margin: "10px 0 12px", alignItems: "center" }}>
        {BOARD_STATUS.map(([k, label, color]) => (
          <button key={k} onClick={() => setStatus(k)} style={{ padding: "7px 12px", borderRadius: 20, border: "1px solid " + (t.status === k ? color : DS.lineStrong), background: t.status === k ? color : "transparent", color: t.status === k ? DS.bg : DS.mut, fontFamily: DS.font, fontWeight: 800, fontSize: 12, cursor: "pointer" }}>{k === "done" && t.status !== "done" ? "✓ " : ""}{label}</button>
        ))}
        {(t.series_id || t.status === "skipped") && <button onClick={() => setStatus("skipped")} title="Pass on this one (it counts as missed)" style={{ padding: "7px 12px", borderRadius: 20, border: "1px solid " + (t.status === "skipped" ? SMAP.skipped.color : DS.lineStrong), background: t.status === "skipped" ? SMAP.skipped.color : "transparent", color: t.status === "skipped" ? DS.bg : DS.mut, fontFamily: DS.font, fontWeight: 800, fontSize: 12, cursor: "pointer" }}>Skip this one</button>}
        <div style={{ flex: 1 }} />
        {tl && <Tag color={TIME_LABEL[tl][1]}>{TIME_LABEL[tl][0]}</Tag>}
      </div>

      {t.status === "blocked" && (
        <div style={{ background: "rgba(255,115,0,0.08)", border: "1px solid rgba(255,115,0,0.35)", borderRadius: 10, padding: "8px 10px", marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: DS.orange, marginBottom: 4 }}>⛔ Blocked on</div>
          <Field multiline minRows={1} value={t.blocker || ""} placeholder="Who or what it's waiting for" onSave={(v) => save({ blocker: v })} style={{ fontSize: 13, padding: "6px 8px" }} />
        </div>
      )}

      {t.help_requested_at ? (
        <div style={{ background: "rgba(197,139,255,0.10)", border: "1px solid rgba(197,139,255,0.4)", borderRadius: 10, padding: "8px 10px", marginBottom: 12, display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200, fontSize: 13 }}><b style={{ color: HELP }}>🙋 {pName(t.help_by)} asked {t.help_from ? pName(t.help_from) : "the team"} for help</b> <span style={{ color: DS.dim }}>· {ago(t.help_requested_at)}</span><div style={{ marginTop: 3, whiteSpace: "pre-wrap" }}>{t.help_note}</div></div>
          <Btn small kind="primary" disabled={busy === "help"} onClick={helpDone}>Help sorted</Btn>
        </div>
      ) : asking ? (
        <div style={{ background: "rgba(197,139,255,0.08)", border: "1px solid rgba(197,139,255,0.35)", borderRadius: 10, padding: 10, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6, fontSize: 13, color: DS.mut }}>🙋 Ask
            <select value={asking.from} onChange={e => setAsking(a => ({ ...a, from: e.target.value }))} style={sel}><option value="">anyone on the team</option>{people.filter(p => p.email !== me.email).map(p => <option key={p.email} value={p.email}>{p.name}</option>)}</select>
            for help</div>
          <Grow value={asking.note} onChange={e => setAsking(a => ({ ...a, note: e.target.value }))} minRows={2} placeholder="What you need: a decision, a hand, an answer…" autoFocus />
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Btn small kind="primary" disabled={!asking.note.trim() || busy === "help"} onClick={askHelp}>{busy === "help" ? "Sending…" : "Ask for help"}</Btn>
            <Btn small kind="quiet" onClick={() => setAsking(null)}>Cancel</Btn>
            <span style={{ fontSize: 12, color: DS.dim }}>{asking.from ? "They get a Slack message" : "Drew gets a Slack message"}{st.slack ? " and the channel hears about it" : ""}.</span>
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {!t.help_requested_at && !asking && isOpen(t) && <Btn small kind="ghost" onClick={() => setAsking({ from: "", note: "" })} style={{ color: HELP, borderColor: "rgba(197,139,255,0.45)" }}>🙋 Ask for help</Btn>}
        {t.hq_view && onOpenView && <Btn small kind="ghost" onClick={() => { onClose(); onOpenView(t.hq_view); }}>Open {hqLabel(t.hq_view)} ↗</Btn>}
        {t.link_url && <a href={t.link_url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Btn small kind="ghost">Open link ↗</Btn></a>}
        {series && onEditSeries && <Btn small kind="quiet" onClick={() => onEditSeries(series)}>🔁 Edit the repeat</Btn>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 12 }}>
        <label style={col}>Assigned to
          <select value={t.assignee_email || ""} onChange={e => save({ assignee_email: e.target.value || null })} style={{ ...sel, width: "100%" }}><option value="">Unassigned</option>{people.map(x => <option key={x.email} value={x.email}>{x.name}</option>)}</select>
        </label>
        <label style={col}>Due
          <input type="date" value={t.due_date || ""} onChange={e => save({ due_date: e.target.value || null })} style={{ ...sel, width: "100%" }} />
        </label>
        <label style={col}>Priority
          <select value={t.priority} onChange={e => save({ priority: e.target.value })} style={{ ...sel, width: "100%" }}><option value="low">Low</option><option value="normal">Normal</option><option value="high">🔥 High</option></select>
        </label>
        <label style={col}>Category
          <select value={t.category || ""} onChange={e => save({ category: e.target.value || null })} style={{ ...sel, width: "100%" }}><option value="">-</option>{cats.map(c => <option key={c} value={c}>{c}</option>)}</select>
        </label>
        <label style={col}>Project
          <select value={t.project_id || ""} onChange={e => save({ project_id: e.target.value ? Number(e.target.value) : null })} style={{ ...sel, width: "100%" }}><option value="">None (standalone)</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </label>
        {t.project_id ? (
          <label style={col}>Section
            <input list={"sections-" + t.project_id} defaultValue={t.section || ""} onBlur={e => (e.target.value.trim() || null) !== (t.section || null) && save({ section: e.target.value.trim() || null })} placeholder="e.g. Marketing" style={{ ...sel, width: "100%" }} />
            <datalist id={"sections-" + t.project_id}>{sections.map(s => <option key={s} value={s} />)}</datalist>
          </label>
        ) : null}
        <label style={col}>HQ screen
          <select value={t.hq_view || ""} onChange={e => save({ hq_view: e.target.value || null })} style={{ ...sel, width: "100%" }}><option value="">-</option>{HQ_VIEWS.map(([k, l, g]) => <option key={k} value={k}>{g} · {l}</option>)}</select>
        </label>
      </div>
      <div style={{ ...row, marginBottom: 10 }}>Departments
        {depts.map(dep => { const on = (t.departments || []).includes(dep); return <button key={dep} onClick={() => save({ departments: on ? (t.departments || []).filter(x => x !== dep) : [...(t.departments || []), dep] })} style={chip(on, "#7FD1C3")}>{on ? "✓ " : ""}{dep}</button>; })}
      </div>
      <div style={{ ...row, marginBottom: 10 }}>Helping
        {(t.helpers || []).map(h => <span key={h.email} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(255,255,255,0.06)", borderRadius: 20, padding: "2px 8px 2px 2px" }}><Avatar name={h.name} size={20} /><span style={{ color: DS.text, fontSize: 12 }}>{h.name}</span><span onClick={() => save({ helpers: (t.helpers || []).filter(x => x.email !== h.email).map(x => x.email) })} style={{ cursor: "pointer", color: DS.dim }}>✕</span></span>)}
        <select value="" onChange={e => e.target.value && save({ helpers: [...(t.helpers || []).map(x => x.email), e.target.value] })} style={{ ...sel, padding: "4px 6px", fontSize: 12 }}><option value="">+ add</option>{people.filter(x => x.email !== t.assignee_email && !(t.helpers || []).some(h => h.email === x.email)).map(x => <option key={x.email} value={x.email}>{x.name}</option>)}</select>
      </div>
      <div style={{ ...row, marginBottom: 12 }}>Link
        <input key={t.link_url || ""} defaultValue={t.link_url || ""} onBlur={e => (e.target.value.trim() || null) !== (t.link_url || null) && save({ link_url: e.target.value.trim() || null })} placeholder="https://… (a doc, a sheet, a Playbook page)" style={{ ...sel, flex: 1, minWidth: 200 }} />
      </div>

      <Label>Details &amp; notes</Label>
      <Field multiline minRows={3} value={t.details || ""} onSave={(v) => save({ details: v })} placeholder="What needs to happen, links, decisions, notes…" />

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

      <Label style={{ marginTop: 16 }}>Updates &amp; feedback</Label>
      {d.updates.map(u => u.kind === "comment" ? (
        <div key={u.id} style={{ display: "flex", gap: 8, padding: "7px 0", borderTop: "1px solid " + DS.line }}>
          <Avatar name={u.author_name} size={26} />
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12, color: DS.mut }}><b style={{ color: DS.text }}>{u.author_name}</b> · {ago(u.created_at)}</div><div style={{ fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{u.body}</div></div>
        </div>
      ) : (
        <div key={u.id} style={{ fontSize: 12, color: u.kind === "help" ? HELP : DS.dim, padding: "4px 0 4px 34px" }}>{u.author_name} · {u.body} · {ago(u.created_at)}</div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}><Grow value={comment} onChange={e => setComment(e.target.value)} minRows={2} placeholder="Post an update or feedback - where it stands, what's next, what you need" onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post(); }} /></div>
        <Btn kind="primary" disabled={!comment.trim() || busy === "comment"} onClick={post}>{busy === "comment" ? "…" : "Post"}</Btn>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: 11, color: DS.dim, flexWrap: "wrap" }}>
        <span>{t.created_by ? "Added by " + pName(t.created_by) + " · " : ""}{t.completed_at ? (t.status === "done" ? "Done" + (t.completed_by ? " by " + t.completed_by : "") : "Skipped") + " " + ago(t.completed_at) : "Last update " + ago(t.last_activity_at)}</span>
        <div style={{ flex: 1 }} />
        {canDelete && <Btn small kind="quiet" onClick={delCard} style={{ color: LATE }}>Delete task</Btn>}
      </div>
      {tl === "overdue" && <div style={{ marginTop: 8, fontSize: 12, color: LATE }}>This task is past due. Post an update, move the date, flag the blocker or ask for help.</div>}
    </Modal>
  );
}
