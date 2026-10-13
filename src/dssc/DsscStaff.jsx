// DSSC staff hours (Drew, 13 Oct 2026): interns and other staff who aren't
// tied to a class clock in, say what they're working on, and clock out.
//   StaffClock      — "My Hours": clock in / out, add a past shift, fix a
//                     shift they forgot to clock out of, this week's total.
//   StaffHoursAdmin — DSSC admins: everyone's shifts by week; fix times,
//                     close open shifts, add/delete, approve.
// After 4 hours on the clock, api/staff-clock-reminder.js texts them a link
// back here. Rows live in dssc_staff_shifts.

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Card, Label, Tag, inputStyle, nrm } from "./DsscHub.jsx";

const pad = (n) => String(n).padStart(2, "0");
// <input type="datetime-local"> speaks local wall-clock time.
export const toLocalInput = (iso) => { if (!iso) return ""; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
export const shiftHours = (r, now = Date.now()) => { if (!r?.clock_in) return 0; const end = r.clock_out ? new Date(r.clock_out).getTime() : now; return Math.max(0, Math.round(((end - new Date(r.clock_in).getTime()) / 3600000) * 4) / 4); };
const fmtWhen = (iso) => iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—";
const fmtDur = (ms) => { const m = Math.max(0, Math.floor(ms / 60000)); return `${Math.floor(m / 60)}h ${pad(m % 60)}m`; };
// Week = Monday..Sunday, local.
export const weekStart = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const meName = (coach) => coach?.display_name || coach?.email || "";

const shell = (children) => (
  <div style={{ margin: "-14px -18px", padding: "16px 16px 48px", background: DS.bg, minHeight: "calc(100vh - 56px)", fontFamily: DS.font, color: DS.text }}>
    <div style={{ maxWidth: 860, margin: "0 auto" }}>{children}</div>
  </div>
);
const Status = ({ r }) => r.rejected ? <Tag color={DS.orange}>Rejected</Tag> : r.approved ? <Tag color={DS.lime}>Approved</Tag> : !r.clock_out ? <Tag color={DS.orange} fill>On the clock</Tag> : <Tag color={DS.mut}>Waiting approval</Tag>;

// ── My Hours ─────────────────────────────────────────────────────────────────
export function StaffClock({ coach, isDirector }) {
  const email = nrm(coach?.email);
  const [rows, setRows] = useState(null);
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [past, setPast] = useState(null);     // { in, out, task } for "add a past shift"
  const [fix, setFix] = useState(null);       // { id, out } for "I forgot to clock out"
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 30000); return () => clearInterval(t); }, []);

  const load = useCallback(async () => {
    if (!email) return;
    const since = addDays(weekStart(), -35).toISOString();
    const { data, error } = await supabase.from("dssc_staff_shifts").select("*").ilike("person_email", email).gte("clock_in", since).order("clock_in", { ascending: false });
    if (error) setMsg({ err: error.message }); else setRows(data || []);
  }, [email]);
  useEffect(() => { load(); }, [load]);

  const open = (rows || []).find(r => !r.clock_out);
  const wk = weekStart();
  const thisWeek = (rows || []).filter(r => new Date(r.clock_in) >= wk && !r.rejected);
  const weekTotal = thisWeek.reduce((t, r) => t + shiftHours(r), 0);

  const act = async (fn, ok) => { setBusy(true); setMsg(null); try { const { error } = await fn(); if (error) throw error; setMsg({ ok }); await load(); } catch (e) { setMsg({ err: e.message }); } setBusy(false); };
  const clockIn = () => act(() => supabase.from("dssc_staff_shifts").insert({ person_email: coach.email, person_name: meName(coach), clock_in: new Date().toISOString(), task: task.trim() || null, source: "app", created_by: meName(coach) }), "Clocked in.");
  const clockOut = () => act(() => supabase.from("dssc_staff_shifts").update({ clock_out: new Date().toISOString(), task: (task.trim() || open.task || null) }).eq("id", open.id), "Clocked out.");
  const saveFix = () => {
    const out = fromLocalInput(fix.out);
    if (!out || new Date(out) <= new Date(open.clock_in)) { setMsg({ err: "Pick a clock-out time after you clocked in." }); return; }
    if (new Date(out) > new Date()) { setMsg({ err: "That time is in the future." }); return; }
    act(() => supabase.from("dssc_staff_shifts").update({ clock_out: out, edited_by: meName(coach), edited_at: new Date().toISOString() }).eq("id", fix.id), "Clock-out fixed.").then(() => setFix(null));
  };
  const savePast = () => {
    const a = fromLocalInput(past.in), b = fromLocalInput(past.out);
    if (!a || !b || new Date(b) <= new Date(a)) { setMsg({ err: "The end has to be after the start." }); return; }
    if (new Date(b) > new Date()) { setMsg({ err: "A past shift can't end in the future - clock in instead." }); return; }
    if ((new Date(b) - new Date(a)) / 3600000 > 16) { setMsg({ err: "That's over 16 hours - check the dates." }); return; }
    act(() => supabase.from("dssc_staff_shifts").insert({ person_email: coach.email, person_name: meName(coach), clock_in: a, clock_out: b, task: (past.task || "").trim() || null, source: "past", created_by: meName(coach) }), "Shift added.").then(() => setPast(null));
  };
  const removeMine = (r) => { if (window.confirm("Delete this shift?")) act(() => supabase.from("dssc_staff_shifts").delete().eq("id", r.id), "Deleted."); };

  if (!email) return shell(<div>Sign in first.</div>);
  const elapsed = open ? Date.now() - new Date(open.clock_in).getTime() : 0;
  return shell(<>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
      <img src={import.meta.env.BASE_URL + "dssc/logo-horizontal-white.png"} alt="Dripping Springs Sports Club" style={{ height: 30, width: "auto" }} />
      <div style={{ flex: 1 }} />
      <div style={{ textAlign: "right" }}><div style={{ fontSize: 13, fontWeight: 700 }}>{meName(coach)}</div><div style={{ fontSize: 11, color: DS.mut }}>This week: {weekTotal.toFixed(2)}h</div></div>
    </div>

    <Card accent={open ? DS.orange : DS.lime}>
      <Label>{open ? "You're on the clock" : "Clock in"}</Label>
      {open ? (<>
        <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1 }}>{fmtDur(elapsed)}</div>
        <div style={{ fontSize: 13, color: DS.mut, margin: "6px 0 12px" }}>Since {fmtWhen(open.clock_in)}{open.task ? " · " + open.task : ""}</div>
        {elapsed > 4 * 3600000 && <div style={{ fontSize: 13, color: DS.orange, fontWeight: 700, marginBottom: 10 }}>That's over 4 hours. If you already left, use "I forgot to clock out" and enter when you actually stopped.</div>}
        <input value={task} onChange={e => setTask(e.target.value)} placeholder={open.task ? "Update what you worked on (optional)" : "What did you work on?"} style={{ ...inputStyle, marginBottom: 10 }} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn kind="warn" disabled={busy} onClick={clockOut} style={{ fontSize: 15, padding: "12px 20px" }}>Clock out now</Btn>
          <Btn disabled={busy} onClick={() => setFix({ id: open.id, out: toLocalInput(new Date(Math.min(Date.now(), new Date(open.clock_in).getTime() + 4 * 3600000)).toISOString()) })}>I forgot to clock out</Btn>
        </div>
        {fix && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: DS.panel2, border: "1px solid " + DS.line }}>
            <div style={{ fontSize: 13, marginBottom: 6 }}>When did you actually stop working?</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input type="datetime-local" value={fix.out} onChange={e => setFix({ ...fix, out: e.target.value })} style={{ ...inputStyle, width: "auto" }} />
              <Btn kind="primary" disabled={busy} onClick={saveFix}>Save clock-out</Btn>
              <Btn kind="quiet" onClick={() => setFix(null)}>Cancel</Btn>
            </div>
          </div>
        )}
      </>) : (<>
        <input value={task} onChange={e => setTask(e.target.value)} placeholder="What are you working on? (front desk, camp setup, social media...)" style={{ ...inputStyle, marginBottom: 10 }} />
        <Btn kind="primary" disabled={busy} onClick={clockIn} style={{ fontSize: 16, padding: "13px 24px" }}>Clock in</Btn>
      </>)}
      {msg?.ok && <div style={{ fontSize: 13, color: DS.lime, fontWeight: 700, marginTop: 10 }}>{msg.ok}</div>}
      {msg?.err && <div style={{ fontSize: 13, color: DS.orange, fontWeight: 700, marginTop: 10 }}>{msg.err}</div>}
    </Card>

    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Label style={{ marginBottom: 0 }}>Forgot to clock in?</Label>
        <div style={{ flex: 1 }} />
        {!past && <Btn small onClick={() => { const end = new Date(); end.setMinutes(0, 0, 0); const start = new Date(end.getTime() - 3 * 3600000); setPast({ in: toLocalInput(start.toISOString()), out: toLocalInput(end.toISOString()), task: "" }); }}>+ Add a past shift</Btn>}
      </div>
      {past ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: DS.mut, width: 40 }}>Start</span><input type="datetime-local" value={past.in} onChange={e => setPast({ ...past, in: e.target.value })} style={{ ...inputStyle, width: "auto" }} />
            <span style={{ fontSize: 12, color: DS.mut, width: 30 }}>End</span><input type="datetime-local" value={past.out} onChange={e => setPast({ ...past, out: e.target.value })} style={{ ...inputStyle, width: "auto" }} />
          </div>
          <input value={past.task} onChange={e => setPast({ ...past, task: e.target.value })} placeholder="What did you work on?" style={inputStyle} />
          <div style={{ display: "flex", gap: 8 }}><Btn kind="primary" disabled={busy} onClick={savePast}>Add shift</Btn><Btn kind="quiet" onClick={() => setPast(null)}>Cancel</Btn></div>
        </div>
      ) : <div style={{ fontSize: 13, color: DS.mut }}>Add a shift you worked but didn't clock in for. Your administrator sees it was added afterwards.</div>}
    </Card>

    <Card>
      <Label>My recent shifts</Label>
      {rows == null ? <div style={{ color: DS.mut, fontSize: 13 }}>Loading…</div> : !rows.length ? <div style={{ color: DS.mut, fontSize: 13 }}>No shifts yet.</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map(r => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "9px 12px", borderRadius: 10, background: DS.panel2, border: "1px solid " + DS.line }}>
              <div style={{ minWidth: 150 }}><div style={{ fontSize: 13, fontWeight: 700 }}>{new Date(r.clock_in).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div><div style={{ fontSize: 12, color: DS.mut }}>{fmtTime(r.clock_in)} – {r.clock_out ? fmtTime(r.clock_out) : "now"}</div></div>
              <div style={{ flex: 1, minWidth: 140, fontSize: 13 }}>{r.task || <i style={{ color: DS.dim }}>no task noted</i>}{r.source === "past" && <span style={{ color: DS.dim, fontSize: 11 }}> · added after</span>}</div>
              <div style={{ fontSize: 14, fontWeight: 800, minWidth: 48, textAlign: "right" }}>{shiftHours(r).toFixed(2)}h</div>
              <Status r={r} />
              {!r.approved && r.clock_out && <Btn kind="quiet" small onClick={() => removeMine(r)} style={{ color: DS.orange }}>✕</Btn>}
            </div>
          ))}
        </div>
      )}
      {isDirector && <div style={{ fontSize: 12, color: DS.mut, marginTop: 10 }}>Everyone's shifts are under Staff Hours.</div>}
    </Card>
  </>);
}

// ── Staff Hours (admins) ─────────────────────────────────────────────────────
export function StaffHoursAdmin({ coach }) {
  const [wk, setWk] = useState(() => weekStart());
  const [rows, setRows] = useState(null);
  const [people, setPeople] = useState([]);
  const [edit, setEdit] = useState(null);     // { id?, person_email, person_name, in, out, task }
  const [msg, setMsg] = useState(null);
  const me = meName(coach);
  const load = useCallback(async () => {
    const [{ data, error }, { data: ppl }] = await Promise.all([
      supabase.from("dssc_staff_shifts").select("*").gte("clock_in", wk.toISOString()).lt("clock_in", addDays(wk, 7).toISOString()).order("clock_in"),
      supabase.from("dssc_people").select("email,first_name,last_name,role,active").eq("active", true).order("first_name"),
    ]);
    if (error) setMsg({ err: error.message }); setRows(data || []); setPeople(ppl || []);
  }, [wk]);
  useEffect(() => { load(); }, [load]);
  // Anyone still clocked in from an earlier week shows here too, so nobody is left on the clock.
  const [stale, setStale] = useState([]);
  useEffect(() => { supabase.from("dssc_staff_shifts").select("*").is("clock_out", null).lt("clock_in", wk.toISOString()).then(({ data }) => setStale(data || [])); }, [wk, rows]);

  const byPerson = useMemo(() => { const m = new Map(); for (const r of [...stale, ...(rows || [])]) { const k = nrm(r.person_email); if (!m.has(k)) m.set(k, { name: r.person_name || r.person_email, email: r.person_email, rows: [] }); m.get(k).rows.push(r); } return [...m.values()].sort((a, b) => a.name.localeCompare(b.name)); }, [rows, stale]);
  const run = async (fn) => { setMsg(null); const { error } = await fn(); if (error) setMsg({ err: error.message }); await load(); };
  const approve = (r, ok) => run(() => supabase.from("dssc_staff_shifts").update(ok ? { approved: true, rejected: false, approved_by: me, approved_at: new Date().toISOString() } : { approved: false, rejected: true, approved_by: me, approved_at: new Date().toISOString() }).eq("id", r.id));
  const approveAll = (p) => run(() => supabase.from("dssc_staff_shifts").update({ approved: true, rejected: false, approved_by: me, approved_at: new Date().toISOString() }).in("id", p.rows.filter(r => r.clock_out && !r.approved && !r.rejected).map(r => r.id)));
  const del = (r) => { if (window.confirm(`Delete ${r.person_name}'s shift on ${fmtWhen(r.clock_in)}?`)) run(() => supabase.from("dssc_staff_shifts").delete().eq("id", r.id)); };
  const save = async () => {
    const a = fromLocalInput(edit.in), b = edit.out ? fromLocalInput(edit.out) : null;
    if (!edit.person_email) { setMsg({ err: "Pick who the shift is for." }); return; }
    if (!a || (b && new Date(b) <= new Date(a))) { setMsg({ err: "The end has to be after the start." }); return; }
    const patch = { clock_in: a, clock_out: b, task: (edit.task || "").trim() || null, edited_by: me, edited_at: new Date().toISOString() };
    await run(() => edit.id ? supabase.from("dssc_staff_shifts").update(patch).eq("id", edit.id)
      : supabase.from("dssc_staff_shifts").insert({ ...patch, person_email: edit.person_email, person_name: edit.person_name, source: "admin", created_by: me }));
    setEdit(null);
  };
  const total = (p) => p.rows.filter(r => !r.rejected).reduce((t, r) => t + shiftHours(r), 0);
  const label = `${wk.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(wk, 6).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const editor = edit && (
    <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: DS.panel2, border: "1px dashed " + DS.lime, display: "grid", gap: 8 }}>
      {!edit.id && (
        <select value={edit.person_email} onChange={e => { const p = people.find(x => x.email === e.target.value); setEdit({ ...edit, person_email: e.target.value, person_name: p ? `${p.first_name} ${p.last_name || ""}`.trim() : e.target.value }); }} style={inputStyle}>
          <option value="">Who worked?</option>
          {people.map(p => <option key={p.email} value={p.email}>{p.first_name} {p.last_name || ""} · {p.role}</option>)}
        </select>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: DS.mut }}>In</span><input type="datetime-local" value={edit.in} onChange={e => setEdit({ ...edit, in: e.target.value })} style={{ ...inputStyle, width: "auto" }} />
        <span style={{ fontSize: 12, color: DS.mut }}>Out</span><input type="datetime-local" value={edit.out || ""} onChange={e => setEdit({ ...edit, out: e.target.value })} style={{ ...inputStyle, width: "auto" }} />
      </div>
      <input value={edit.task || ""} onChange={e => setEdit({ ...edit, task: e.target.value })} placeholder="What they worked on" style={inputStyle} />
      <div style={{ display: "flex", gap: 8 }}><Btn kind="primary" onClick={save}>Save</Btn><Btn kind="quiet" onClick={() => setEdit(null)}>Cancel</Btn></div>
    </div>
  );
  return shell(<>
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
      <div style={{ fontSize: 24, fontWeight: 800 }}>Staff hours</div>
      <div style={{ flex: 1 }} />
      <Btn small onClick={() => setWk(addDays(wk, -7))}>‹</Btn>
      <span style={{ fontSize: 13, fontWeight: 700, minWidth: 120, textAlign: "center" }}>{label}</span>
      <Btn small onClick={() => setWk(addDays(wk, 7))}>›</Btn>
      <Btn small kind="primary" onClick={() => setEdit({ person_email: "", person_name: "", in: toLocalInput(new Date(Date.now() - 3 * 3600000).toISOString()), out: toLocalInput(new Date().toISOString()), task: "" })}>+ Add a shift</Btn>
    </div>
    {!edit?.id && editor}
    {msg?.err && <div style={{ color: DS.orange, fontWeight: 700, fontSize: 13, margin: "8px 0" }}>{msg.err}</div>}
    {rows == null ? <div style={{ color: DS.mut }}>Loading…</div> : !byPerson.length ? <Card><div style={{ color: DS.mut, fontSize: 13 }}>No staff shifts this week.</div></Card> : byPerson.map(p => (
      <Card key={p.email}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{p.name}</div>
          <span style={{ fontSize: 13, color: DS.mut }}>{total(p).toFixed(2)}h</span>
          <div style={{ flex: 1 }} />
          {p.rows.some(r => r.clock_out && !r.approved && !r.rejected) && <Btn small kind="primary" onClick={() => approveAll(p)}>Approve all</Btn>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {p.rows.map(r => (
            <div key={r.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 11px", borderRadius: 10, background: DS.panel2, border: "1px solid " + (!r.clock_out ? DS.orange : DS.line) }}>
                <div style={{ minWidth: 160, fontSize: 13 }}><b>{new Date(r.clock_in).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</b><div style={{ color: DS.mut, fontSize: 12 }}>{fmtTime(r.clock_in)} – {r.clock_out ? fmtTime(r.clock_out) : "still clocked in"}</div></div>
                <div style={{ flex: 1, minWidth: 140, fontSize: 13 }}>{r.task || <i style={{ color: DS.dim }}>no task</i>}<span style={{ color: DS.dim, fontSize: 11 }}>{r.source === "past" ? " · added after" : r.source === "admin" ? " · added by admin" : ""}{r.edited_by ? ` · edited by ${r.edited_by}` : ""}{r.reminder_sent_at && !r.clock_out ? " · 4-hr text sent" : ""}</span></div>
                <div style={{ fontWeight: 800, minWidth: 48, textAlign: "right" }}>{shiftHours(r).toFixed(2)}h</div>
                <Status r={r} />
                <Btn small kind="quiet" onClick={() => setEdit({ id: r.id, in: toLocalInput(r.clock_in), out: r.clock_out ? toLocalInput(r.clock_out) : "", task: r.task || "" })}>{r.clock_out ? "Fix" : "Clock out"}</Btn>
                {r.clock_out && !r.approved && <Btn small kind="primary" onClick={() => approve(r, true)}>Approve</Btn>}
                {r.clock_out && !r.rejected && <Btn small kind="quiet" onClick={() => approve(r, false)} style={{ color: DS.orange }}>Reject</Btn>}
                <Btn small kind="quiet" onClick={() => del(r)} style={{ color: DS.orange }}>✕</Btn>
              </div>
              {edit?.id === r.id && editor}
            </div>
          ))}
        </div>
      </Card>
    ))}
  </>);
}
