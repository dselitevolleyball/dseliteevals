// DSSC Planning Calendar (Drew, Oct 12 2026): "a visual representation of my
// detailed planning work book for 2027 … this should allow Hunter to figure out
// what to plan, how many courts are available and what is on all of the
// courts" — drawn like Court Availability (which Drew likes).
//
// Data: dssc_plan_bookings, one row per court per booking, loaded from the
// workbook by scripts/import-dssc-plan.mjs (source 'workbook') plus whatever is
// added here (source 'app'). Courts: Warehouse I C1-C4, Warehouse II C5-C6,
// Flex. Day = every court in half hours with an "open courts" column; Week =
// each court's free windows per day; Month = open court-hours per day; "Find
// open courts" lists the dates with N courts free for a whole time window.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import PlanWorkbook, { programIndex, programFor } from "./PlanWorkbook.jsx";

const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", grn: "#22c55e", red: "#ef4444", amb: "#f59e0b" };
const PLAN = "2027";
const COURTS = [
  { id: "C1", label: "Court 1", venue: "Warehouse I" }, { id: "C2", label: "Court 2", venue: "Warehouse I" },
  { id: "C3", label: "Court 3", venue: "Warehouse I" }, { id: "C4", label: "Court 4", venue: "Warehouse I" },
  { id: "C5", label: "Court 5", venue: "Warehouse II" }, { id: "C6", label: "Court 6", venue: "Warehouse II" },
  { id: "FLEX", label: "Flex", venue: "Flex" },
];
const VENUES = [["Warehouse I", 4], ["Warehouse II", 2], ["Flex", 1]];
const S0 = 14, S1 = 44;                       // 7:00am … 10:00pm in half hours
const SLOTS = Array.from({ length: S1 - S0 }, (_, i) => S0 + i);
// Program families → colors (DS Elite pink like Court Availability).
const FAMILY = [
  [/^DSEV|DS Elite/i, { bg: "rgba(233,30,140,0.20)", bd: "#e91e8c", fg: "#f9a8d4", name: "DS Elite (DSEV)" }],
  [/^Volleyball|Pod|ACES|Austin Sports|Womens|Heatwave/i, { bg: "rgba(178,208,73,0.20)", bd: "#B2D049", fg: "#d9ef8a", name: "Volleyball programs" }],
  [/^Basketball|Storm/i, { bg: "rgba(59,130,246,0.20)", bd: "#3b82f6", fg: "#93c5fd", name: "Basketball" }],
  [/Camp/i, { bg: "rgba(168,85,247,0.22)", bd: "#a855f7", fg: "#d8b4fe", name: "Camps" }],
  [/Rental|Day Rent|TCG|Veritas|TWE|Booked|Privates/i, { bg: "rgba(249,115,22,0.20)", bd: "#f97316", fg: "#fdba74", name: "Rentals & contracted" }],
  [/HOLIDAY/i, { bg: "rgba(148,163,184,0.18)", bd: "#64748b", fg: "#cbd5e1", name: "Holiday / closed" }],
  [/./, { bg: "rgba(45,212,191,0.18)", bd: "#2dd4bf", fg: "#99f6e4", name: "Other (pick-up, open gym…)" }],
];
const famOf = (p) => FAMILY.find(([re]) => re.test(p || ""))[1];
const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const addDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };
const weekStart = (ymd) => { const d = new Date(ymd + "T12:00:00"); d.setDate(d.getDate() - d.getDay()); return iso(d); };
const fmtDay = (ymd, long) => new Date(ymd + "T12:00:00").toLocaleDateString(undefined, long ? { weekday: "long", month: "long", day: "numeric", year: "numeric" } : { weekday: "short", month: "short", day: "numeric" });
const hm = (s) => { const h = Math.floor(s / 2), m = s % 2 ? "30" : "00", ap = h >= 12 ? "p" : "a", h12 = ((h + 11) % 12) + 1; return h12 + (m === "00" ? "" : ":" + m) + ap; };
const hmLong = (s) => { const h = Math.floor(s / 2), ap = h >= 12 ? "pm" : "am", h12 = ((h + 11) % 12) + 1; return h12 + ":" + (s % 2 ? "30" : "00") + " " + ap; };
const btn = (on) => ({ padding: "7px 14px", border: "none", background: on ? C.gold : "transparent", color: on ? "#000" : C.mut, fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" });
const inp = { background: "#0f0f0f", border: "1px solid " + C.border, borderRadius: 8, color: C.text, fontFamily: "inherit", fontSize: 13, padding: "7px 9px", boxSizing: "border-box", colorScheme: "dark" };
const lbl = { fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: C.mut, marginBottom: 4, display: "block" };
const kept = { date: null, mode: "week" };

export default function DsscPlanner({ coach }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [date, setDate] = useState(kept.date || "2027-01-04");
  const [mode, setMode] = useState(kept.mode);
  const [hidden, setHidden] = useState([]);          // family names switched off
  const [edit, setEdit] = useState(null);            // booking form state
  const [find, setFind] = useState(null);            // find-open-courts state
  const [busy, setBusy] = useState(false);
  useEffect(() => { kept.date = date; kept.mode = mode; }, [date, mode]);
  const me = coach?.display_name || coach?.email || null;
  // Hunter's titled programs (Workbook tab) show in place of the generic name.
  const [recs, setRecs] = useState([]);
  const loadRecs = async () => { const { data, error } = await supabase.from("dssc_plan_programs").select("*").eq("plan", PLAN); if (!error) setRecs(data || []); };
  useEffect(() => { loadRecs(); }, []);
  const recIdx = useMemo(() => programIndex(recs), [recs]);
  const nameOf = (b) => programFor(recIdx, b)?.title || b.label || b.program;

  const load = async () => {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("dssc_plan_bookings").select("*").eq("plan", PLAN).order("id").range(from, from + 999);
      if (error) { setErr(error.message); return; }
      out.push(...(data || [])); if (!data || data.length < 1000) break;
    }
    setRows(out);
  };
  useEffect(() => { load(); }, []);

  const byDate = useMemo(() => { const m = new Map(); for (const r of rows || []) { if (!m.has(r.date)) m.set(r.date, []); m.get(r.date).push(r); } return m; }, [rows]);
  const programs = useMemo(() => [...new Set((rows || []).map(r => r.program))].sort(), [rows]);
  const visible = (b) => !hidden.includes(famOf(b.program).name);

  // A day's grid: court → slot → booking (first one wins; a second one is a clash).
  const gridFor = (d) => {
    const cells = Object.fromEntries(COURTS.map(c => [c.id, {}])), clash = [];
    for (const b of (byDate.get(d) || [])) for (let s = b.start_slot; s < b.start_slot + b.slots; s++) {
      if (!cells[b.court]) continue;
      if (cells[b.court][s]) { if (cells[b.court][s].id !== b.id) clash.push([b.court, s]); continue; }
      cells[b.court][s] = b;
    }
    const closed = (byDate.get(d) || []).some(b => /HOLIDAY/i.test(b.program) && b.slots >= 16);
    const free = Object.fromEntries(COURTS.map(c => { const w = []; let s0 = null; for (const s of SLOTS) { const f = !cells[c.id][s]; if (f && s0 == null) s0 = s; else if (!f && s0 != null) { w.push([s0, s]); s0 = null; } } if (s0 != null) w.push([s0, S1]); return [c.id, w]; }));
    const openAt = Object.fromEntries(SLOTS.map(s => [s, COURTS.filter(c => !cells[c.id][s]).length]));
    const openHours = COURTS.reduce((t, c) => t + free[c.id].reduce((x, [a, b]) => x + (b - a) / 2, 0), 0);
    return { cells, free, openAt, openHours, closed, clash };
  };
  const windows = (w) => w.filter(([a, b]) => b - a >= 2).map(([a, b]) => hm(a) + "–" + hm(b));

  // ---- add / edit ----
  const startAdd = (d, court, slot) => setEdit({ id: null, date: d, courts: court ? [court] : [], start: slot ?? 34, end: Math.min((slot ?? 34) + 2, S1), program: "", label: "", note: "", repeatUntil: "" });
  const startEdit = (b) => setEdit({ id: b.id, series: b.series, date: b.date, courts: [b.court], start: b.start_slot, end: b.start_slot + b.slots, program: b.program, label: b.label || "", note: b.note || "", source: b.source });
  const clashesFor = (e) => {
    const out = [];
    const dates = []; for (let d = e.date; d <= (e.repeatUntil || e.date) && dates.length < 60; d = addDays(d, 7)) dates.push(d);
    for (const d of dates) for (const c of e.courts) for (const b of (byDate.get(d) || [])) if (b.court === c && b.id !== e.id && b.start_slot < e.end && b.start_slot + b.slots > e.start) out.push(`${fmtDay(d)} ${c === "FLEX" ? "Flex" : "Court " + c.slice(1)}: ${nameOf(b)} ${hm(b.start_slot)}–${hm(b.start_slot + b.slots)}`);
    return { dates, out };
  };
  const save = async () => {
    const e = edit; if (!e.program.trim() || !e.courts.length || e.end <= e.start) { window.alert("Pick a program, at least one court, and an end after the start."); return; }
    const { dates, out } = clashesFor(e);
    if (out.length && !window.confirm(`That overlaps ${out.length} booking${out.length === 1 ? "" : "s"}:\n\n${out.slice(0, 12).join("\n")}${out.length > 12 ? "\n…" : ""}\n\nSave anyway?`)) return;
    setBusy(true);
    const base = { plan: PLAN, start_slot: e.start, slots: e.end - e.start, program: e.program.trim(), label: e.label.trim() || null, note: e.note.trim() || null, updated_at: new Date().toISOString() };
    let error;
    if (e.id) ({ error } = await supabase.from("dssc_plan_bookings").update({ ...base, date: e.date, court: e.courts[0], source: "app" }).eq("id", e.id));
    else {
      const series = dates.length * e.courts.length > 1 ? "s" + Date.now().toString(36) : null;
      ({ error } = await supabase.from("dssc_plan_bookings").insert(dates.flatMap(d => e.courts.map(c => ({ ...base, date: d, court: c, source: "app", series, created_by: me })))));
    }
    setBusy(false);
    if (error) { window.alert("Save failed: " + error.message); return; }
    setEdit(null); load();
  };
  const remove = async (all) => {
    const e = edit;
    if (!window.confirm(all ? "Delete every booking added with this one (all its weeks and courts)?" : "Delete this booking?" + (e.source === "workbook" ? "\n\nIt came from the workbook, so a re-import would bring it back." : ""))) return;
    setBusy(true);
    const q = supabase.from("dssc_plan_bookings").delete();
    const { error } = all && e.series ? await q.eq("series", e.series) : await q.eq("id", e.id);
    setBusy(false);
    if (error) { window.alert("Delete failed: " + error.message); return; }
    setEdit(null); load();
  };

  // ---- find open courts ----
  const runFind = (f) => {
    const hits = [];
    for (let d = f.from; d <= f.to; d = addDays(d, 1)) {
      const wd = new Date(d + "T12:00:00").getDay(); if (!f.days.includes(wd)) continue;
      const g = gridFor(d); if (g.closed) continue;
      const open = COURTS.filter(c => (!f.venue || c.venue === f.venue) && SLOTS.filter(s => s >= f.start && s < f.end).every(s => !g.cells[c.id][s]));
      if (open.length >= f.need) hits.push({ d, open });
    }
    setFind({ ...f, hits });
  };

  const nav = (n) => {
    if (mode !== "month") { setDate(addDays(date, mode === "week" ? 7 * n : n)); return; }
    const d = new Date(date + "T12:00:00"); d.setMonth(d.getMonth() + n, 1); setDate(iso(d));
  };
  const legend = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 11, color: C.mut, margin: "0 0 10px" }}>
      {FAMILY.map(([, v]) => { const off = hidden.includes(v.name); return (
        <button key={v.name} onClick={() => setHidden(h => off ? h.filter(x => x !== v.name) : [...h, v.name])} title={off ? "Show" : "Hide"} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", color: off ? "#555" : C.mut, cursor: "pointer", fontFamily: "inherit", fontSize: 11, padding: 0, textDecoration: off ? "line-through" : "none" }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: v.bg, border: "1px solid " + v.bd, opacity: off ? 0.3 : 1 }} />{v.name}</button>); })}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: "rgba(34,197,94,0.10)", border: "1px solid rgba(34,197,94,0.5)" }} />Open</span>
    </div>
  );

  const dayView = () => {
    const g = gridFor(date);
    const th = { padding: "6px 4px", fontSize: 11, fontWeight: 800, color: C.mut, textAlign: "center", borderBottom: "1px solid " + C.border, background: C.bg, position: "sticky", top: 0, zIndex: 1 };
    const sep = (ci) => ci === 4 || ci === 6 ? "2px solid " + C.border : "1px solid #1a1a1a";
    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 12 }}>
          {COURTS.map(c => { const w = windows(g.free[c.id]); return (
            <div key={c.id} style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 10, padding: "8px 10px" }}>
              <div style={{ fontSize: 12, fontWeight: 800 }}>{c.label} <span style={{ color: C.mut, fontWeight: 600 }}>· {c.venue}</span></div>
              <div style={{ fontSize: 12, color: w.length ? C.grn : C.mut, marginTop: 2, lineHeight: 1.5 }}>{w.length ? "Open " + w.join(", ") : "No open hour"}</div>
            </div>); })}
        </div>
        {g.clash.length > 0 && <div style={{ fontSize: 12, color: C.red, marginBottom: 8 }}>⚠ Double-booked: {[...new Set(g.clash.map(([c, s]) => (c === "FLEX" ? "Flex" : "Court " + c.slice(1)) + " " + hm(s)))].slice(0, 8).join(", ")}</div>}
        <div style={{ overflowX: "auto", border: "1px solid " + C.border, borderRadius: 10 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 720, tableLayout: "fixed" }}>
            <thead>
              <tr><th style={{ ...th, width: 54 }} rowSpan={2}>Time</th>{VENUES.map(([v, n], i) => <th key={v} colSpan={n} style={{ ...th, borderLeft: i ? "2px solid " + C.border : undefined }}>{v}</th>)}<th style={{ ...th, width: 58, borderLeft: "2px solid " + C.border }} rowSpan={2} title="Courts open in this half hour">Open</th></tr>
              <tr>{COURTS.map((c, ci) => <th key={c.id} style={{ ...th, top: 27, borderLeft: ci ? sep(ci) : undefined }}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {SLOTS.map((s, si) => (
                <tr key={s}>
                  <td style={{ fontSize: 10, color: C.mut, padding: "0 6px", borderTop: s % 2 === 0 ? "1px solid " + C.border : "1px dotted #1f1f1f", height: 22, verticalAlign: "top", whiteSpace: "nowrap" }}>{s % 2 === 0 ? hm(s) : ""}</td>
                  {COURTS.map((c, ci) => {
                    const col = g.cells[c.id], b = col[s] && visible(col[s]) ? col[s] : null;
                    const same = (x, y) => (!x && !y) || (x && y && x.id === y.id);
                    const prev = si > 0 ? (col[s - 1] && visible(col[s - 1]) ? col[s - 1] : null) : undefined;
                    if (si > 0 && same(prev, b)) return null;
                    let n = 1; while (si + n < SLOTS.length && same(col[s + n] && visible(col[s + n]) ? col[s + n] : null, b)) n++;
                    const f = b && famOf(b.program);
                    return (
                      <td key={c.id} rowSpan={n} onClick={() => b ? startEdit(b) : startAdd(date, c.id, s)} title={b ? `${nameOf(b)} · ${hm(b.start_slot)}–${hm(b.start_slot + b.slots)}${b.note ? " · " + b.note : ""} — click to edit` : "Open — click to plan something here"}
                        style={{ padding: 2, borderLeft: ci ? sep(ci) : "1px solid #1a1a1a", verticalAlign: "top", cursor: "pointer" }}>
                        <div style={b
                          ? { height: "100%", minHeight: n * 22 - 4, borderRadius: 6, background: f.bg, border: (b.source === "app" ? "1px dashed " : "1px solid ") + f.bd, color: f.fg, padding: "3px 5px", fontSize: 11, fontWeight: 700, lineHeight: 1.25, overflow: "hidden" }
                          : { height: "100%", minHeight: n * 22 - 4, borderRadius: 6, background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.25)", color: "#4ade80", padding: "3px 5px", fontSize: 10, fontWeight: 700 }}>
                          {b ? <>{nameOf(b)}{n >= 2 && <div style={{ fontWeight: 500, opacity: 0.8 }}>{hm(b.start_slot)}–{hm(b.start_slot + b.slots)}{b.note ? " · " + b.note : ""}</div>}</> : n >= 2 ? "Open " + hm(s) + "–" + hm(s + n) : ""}
                        </div>
                      </td>);
                  })}
                  <td style={{ borderLeft: "2px solid " + C.border, borderTop: s % 2 === 0 ? "1px solid " + C.border : "1px dotted #1f1f1f", textAlign: "center", fontSize: 11, fontWeight: 800, color: g.openAt[s] ? C.grn : "#555", background: `rgba(34,197,94,${(g.openAt[s] / COURTS.length) * 0.22})` }}>{g.openAt[s]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const weekView = () => {
    const wk = weekStart(date), dates = Array.from({ length: 7 }, (_, i) => addDays(wk, i));
    const grids = Object.fromEntries(dates.map(d => [d, gridFor(d)]));
    const th = { padding: "7px 8px", fontSize: 11, fontWeight: 800, color: C.mut, textAlign: "left", borderBottom: "1px solid " + C.border, background: C.bg, whiteSpace: "nowrap" };
    return (
      <div style={{ overflowX: "auto", border: "1px solid " + C.border, borderRadius: 10 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
          <thead>
            <tr><th style={th}>Court</th>{dates.map(d => <th key={d} style={{ ...th, cursor: "pointer", color: d === date ? C.gold : C.mut }} onClick={() => { setDate(d); setMode("day"); }}>{fmtDay(d)}</th>)}</tr>
            <tr><td style={{ ...th, color: C.grn }}>Open court-hours</td>{dates.map(d => <td key={d} style={{ ...th, color: grids[d].closed ? C.mut : C.grn }}>{grids[d].closed ? "Closed" : grids[d].openHours + " of " + (COURTS.length * (S1 - S0)) / 2}</td>)}</tr>
          </thead>
          <tbody>
            {COURTS.map(c => (
              <tr key={c.id}>
                <td style={{ padding: 8, fontSize: 12, fontWeight: 800, borderTop: "1px solid " + C.border, whiteSpace: "nowrap", verticalAlign: "top" }}>{c.label}<div style={{ fontSize: 10, color: C.mut, fontWeight: 600 }}>{c.venue}</div></td>
                {dates.map(d => { const g = grids[d]; const list = (byDate.get(d) || []).filter(b => b.court === c.id && visible(b)).sort((a, b) => a.start_slot - b.start_slot); const w = windows(g.free[c.id]); return (
                  <td key={d} onClick={() => { setDate(d); setMode("day"); }} style={{ padding: 6, fontSize: 11, borderTop: "1px solid " + C.border, borderLeft: "1px solid #1a1a1a", verticalAlign: "top", cursor: "pointer", lineHeight: 1.45 }}>
                    {list.map(b => { const f = famOf(b.program); return <div key={b.id} style={{ background: f.bg, borderLeft: "3px solid " + f.bd, color: f.fg, borderRadius: 4, padding: "1px 5px", marginBottom: 2, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hm(b.start_slot)} {nameOf(b)}</div>; })}
                    {w.length > 0 && <div style={{ color: C.grn, marginTop: 2 }}>{w.map(x => <div key={x}>Open {x}</div>)}</div>}
                  </td>); })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const monthView = () => {
    const first = date.slice(0, 8) + "01", start = weekStart(first);
    const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    const max = COURTS.length * (S1 - S0) / 2;
    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => <div key={d} style={{ fontSize: 11, fontWeight: 800, color: C.mut, padding: "0 4px" }}>{d}</div>)}
          {days.map(d => { const inMonth = d.slice(0, 7) === first.slice(0, 7); const g = gridFor(d); const pct = g.closed ? 0 : g.openHours / max;
            const progs = {}; for (const b of (byDate.get(d) || [])) if (visible(b)) progs[nameOf(b)] = (progs[nameOf(b)] || 0) + b.slots / 2;
            const top = Object.entries(progs).sort((a, b) => b[1] - a[1]).slice(0, 3);
            return (
              <div key={d} onClick={() => { setDate(d); setMode("day"); }} style={{ minHeight: 96, background: C.card, border: "1px solid " + (d === date ? C.gold : C.border), borderRadius: 8, padding: 6, cursor: "pointer", opacity: inMonth ? 1 : 0.35, overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 800 }}><span>{+d.slice(8)}</span><span style={{ color: g.closed ? C.mut : C.grn }}>{g.closed ? "Closed" : g.openHours + "h open"}</span></div>
                <div style={{ height: 5, background: "#222", borderRadius: 3, margin: "4px 0 5px" }}><div style={{ height: 5, width: (pct * 100) + "%", background: C.grn, borderRadius: 3 }} /></div>
                {top.map(([n, h]) => { const f = famOf((byDate.get(d) || []).find(b => nameOf(b) === n)?.program); return <div key={n} style={{ fontSize: 10, color: f.fg, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n} · {h}h</div>; })}
              </div>); })}
        </div>
        <div style={{ fontSize: 11, color: C.mut, marginTop: 8 }}>Bar = share of court time still open (7 courts × 7am–10pm = {max} court-hours a day). Hours under a program are court-hours.</div>
      </div>
    );
  };

  const findPanel = () => {
    const f = find || { from: date, to: addDays(date, 90), days: [1, 2, 3, 4], start: 34, end: 38, need: 2, venue: "" };
    const set = (patch) => setFind({ ...f, ...patch, hits: undefined });
    const times = Array.from({ length: S1 - S0 + 1 }, (_, i) => S0 + i);
    return (
      <div style={{ background: C.card, border: "1px solid " + C.gold, borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}><b style={{ color: C.gold }}>🔎 Find open courts</b><span style={{ fontSize: 12, color: C.mut }}>Dates with enough courts free for the whole window.</span><div style={{ flex: 1 }} /><button onClick={() => setFind(false)} style={{ background: "none", border: "none", color: C.mut, cursor: "pointer" }}>✕</button></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label><span style={lbl}>From</span><input type="date" value={f.from} onChange={e => set({ from: e.target.value })} style={inp} /></label>
          <label><span style={lbl}>To</span><input type="date" value={f.to} onChange={e => set({ to: e.target.value })} style={inp} /></label>
          <div><span style={lbl}>Days</span><div style={{ display: "flex", gap: 3 }}>{["S", "M", "T", "W", "T", "F", "S"].map((n, i) => <button key={i} onClick={() => set({ days: f.days.includes(i) ? f.days.filter(x => x !== i) : [...f.days, i] })} style={{ ...btn(f.days.includes(i)), padding: "6px 9px", border: "1px solid " + C.border, borderRadius: 6 }}>{n}</button>)}</div></div>
          <label><span style={lbl}>Start</span><select value={f.start} onChange={e => set({ start: +e.target.value })} style={inp}>{times.slice(0, -1).map(s => <option key={s} value={s}>{hmLong(s)}</option>)}</select></label>
          <label><span style={lbl}>End</span><select value={f.end} onChange={e => set({ end: +e.target.value })} style={inp}>{times.filter(s => s > f.start).map(s => <option key={s} value={s}>{hmLong(s)}</option>)}</select></label>
          <label><span style={lbl}>Courts needed</span><select value={f.need} onChange={e => set({ need: +e.target.value })} style={inp}>{[1, 2, 3, 4, 5, 6, 7].map(n => <option key={n}>{n}</option>)}</select></label>
          <label><span style={lbl}>Building</span><select value={f.venue} onChange={e => set({ venue: e.target.value })} style={inp}><option value="">Any</option>{VENUES.map(([v]) => <option key={v}>{v}</option>)}</select></label>
          <button onClick={() => runFind(f)} style={{ ...btn(true), borderRadius: 8 }}>Search</button>
        </div>
        {f.hits && (
          <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.7, maxHeight: 260, overflowY: "auto" }}>
            <b>{f.hits.length} date{f.hits.length === 1 ? "" : "s"}</b> with {f.need}+ court{f.need === 1 ? "" : "s"} open {hmLong(f.start)}–{hmLong(f.end)}{f.venue ? " in " + f.venue : ""}:
            {f.hits.map(h => <div key={h.d} onClick={() => { setDate(h.d); setMode("day"); }} style={{ cursor: "pointer" }}><span style={{ color: C.gold }}>{fmtDay(h.d)}</span> <span style={{ color: C.mut }}>— {h.open.map(c => c.label).join(", ")}</span></div>)}
          </div>
        )}
      </div>
    );
  };

  const editPanel = () => {
    const e = edit, times = Array.from({ length: S1 - S0 + 1 }, (_, i) => S0 + i);
    const set = (p) => setEdit({ ...e, ...p });
    const { out } = clashesFor(e);
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setEdit(null)}>
        <div onClick={ev => ev.stopPropagation()} style={{ background: C.card, border: "1px solid " + C.gold, borderRadius: 14, padding: 16, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.gold, marginBottom: 10 }}>{e.id ? "Edit booking" : "Plan something"}{e.source === "workbook" && <span style={{ fontSize: 11, color: C.mut, fontWeight: 600 }}> · from the workbook</span>}</div>
          <div style={{ display: "grid", gap: 10 }}>
            <label><span style={lbl}>Program</span><input list="dssc-plan-programs" value={e.program} onChange={ev => set({ program: ev.target.value })} placeholder="Volleyball Clinic, Rental, DSEV…" style={{ ...inp, width: "100%" }} /><datalist id="dssc-plan-programs">{programs.map(p => <option key={p} value={p} />)}</datalist></label>
            <label><span style={lbl}>Name on the calendar (optional)</span><input value={e.label} onChange={ev => set({ label: ev.target.value })} placeholder="e.g. U12 Setter Clinic" style={{ ...inp, width: "100%" }} /></label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <label><span style={lbl}>Date</span><input type="date" value={e.date} onChange={ev => set({ date: ev.target.value })} style={inp} /></label>
              <label><span style={lbl}>Start</span><select value={e.start} onChange={ev => set({ start: +ev.target.value, end: Math.max(e.end, +ev.target.value + 1) })} style={inp}>{times.slice(0, -1).map(s => <option key={s} value={s}>{hmLong(s)}</option>)}</select></label>
              <label><span style={lbl}>End</span><select value={e.end} onChange={ev => set({ end: +ev.target.value })} style={inp}>{times.filter(s => s > e.start).map(s => <option key={s} value={s}>{hmLong(s)}</option>)}</select></label>
            </div>
            <div><span style={lbl}>{e.id ? "Court" : "Courts"}</span><div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{COURTS.map(c => { const on = e.courts.includes(c.id); return <button key={c.id} onClick={() => set({ courts: e.id ? [c.id] : on ? e.courts.filter(x => x !== c.id) : [...e.courts, c.id] })} style={{ ...btn(on), border: "1px solid " + C.border, borderRadius: 6, padding: "6px 10px" }}>{c.label}</button>; })}</div></div>
            {!e.id && <label><span style={lbl}>Repeat every week until (optional)</span><input type="date" value={e.repeatUntil} min={e.date} onChange={ev => set({ repeatUntil: ev.target.value })} style={inp} /></label>}
            <label><span style={lbl}>Note</span><input value={e.note} onChange={ev => set({ note: ev.target.value })} placeholder="Coach, renter, anything Hunter should know" style={{ ...inp, width: "100%" }} /></label>
            {out.length > 0 && <div style={{ fontSize: 12, color: C.amb, lineHeight: 1.5 }}>⚠ Overlaps {out.length}: {out.slice(0, 4).join(" · ")}{out.length > 4 ? " …" : ""}</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button disabled={busy} onClick={save} style={{ ...btn(true), borderRadius: 8 }}>{busy ? "Saving…" : "Save"}</button>
              <button onClick={() => setEdit(null)} style={{ ...btn(false), border: "1px solid " + C.border, borderRadius: 8 }}>Cancel</button>
              <div style={{ flex: 1 }} />
              {e.id && <button disabled={busy} onClick={() => remove(false)} style={{ ...btn(false), border: "1px solid " + C.red, color: C.red, borderRadius: 8 }}>Delete</button>}
              {e.id && e.series && <button disabled={busy} onClick={() => remove(true)} style={{ ...btn(false), border: "1px solid " + C.red, color: C.red, borderRadius: 8 }}>Delete all repeats</button>}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const title = mode === "workbook" ? "Program workbook: give the generic blocks real titles, lengths and prices" : mode === "day" ? fmtDay(date, true) : mode === "week" ? "Week of " + fmtDay(weekStart(date), true) : new Date(date + "T12:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return (
    <div style={{ maxWidth: 1300, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.gold }}>🗓 2027 Planning Calendar</h2>
        <div style={{ flex: 1 }} />
        <button onClick={() => nav(-1)} aria-label="Previous" style={{ ...btn(false), border: "1px solid " + C.border, borderRadius: 8 }}>‹</button>
        <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} style={inp} />
        <button onClick={() => nav(1)} aria-label="Next" style={{ ...btn(false), border: "1px solid " + C.border, borderRadius: 8 }}>›</button>
        <div style={{ display: "inline-flex", border: "1px solid " + C.border, borderRadius: 8, overflow: "hidden" }}>
          {["day", "week", "month", "workbook"].map(m => <button key={m} onClick={() => setMode(m)} style={btn(mode === m)}>{m === "workbook" ? "📒 Workbook" : m[0].toUpperCase() + m.slice(1)}</button>)}
        </div>
        <button onClick={() => setFind(find ? false : { from: date, to: addDays(date, 90), days: [1, 2, 3, 4], start: 34, end: 38, need: 2, venue: "" })} style={{ ...btn(!!find), border: "1px solid " + (find ? C.gold : C.border), borderRadius: 8 }}>🔎 Find open courts</button>
        <button onClick={() => startAdd(date)} style={{ ...btn(false), border: "1px solid " + C.border, borderRadius: 8 }}>＋ Plan</button>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{title}</div>
      {find && findPanel()}
      {mode !== "workbook" && legend}
      {err ? <div style={{ color: C.red, padding: 16 }}>{err}</div>
        : !rows ? <div style={{ padding: 24, color: C.mut, textAlign: "center" }}>Loading the 2027 plan…</div>
        : mode === "workbook" ? <PlanWorkbook rows={rows} recs={recs} reloadRecs={loadRecs} me={me} onJump={(d) => { setDate(d); setMode("day"); }} />
        : mode === "day" ? dayView() : mode === "week" ? weekView() : monthView()}
      {rows && (
        <div style={{ fontSize: 11, color: C.mut, marginTop: 10, lineHeight: 1.6 }}>
          Drew's 2027 workbook ("2027 Detailed Yearly Schedule"), moved onto the 2027 calendar, {rows.length.toLocaleString()} court-bookings. Click an open space to plan into it, or a booking to change it. Dashed = added here; solid = from the workbook. Warehouse I is Courts 1–4, Warehouse II is Courts 5–6, plus the Flex. Showing 7am–10pm.
        </div>
      )}
      {edit && editPanel()}
    </div>
  );
}
