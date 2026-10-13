// Program Workbook (Drew, Oct 13 2026): "a way for Hunter to see the planning
// calendar and identify programming he wants to include in the generic
// titling, almost like a work book - looking at the same dates and times, and
// how long those things are open for, and then he can add titles, and lengths,
// and prices etc."
//
// The 2027 plan's generic blocks ("Volleyball Clinic" on Court 1, Mondays
// 5-6pm) are grouped into runs: the same program, court, weekday, start and
// length week after week (a gap of more than two weeks starts a new run). Runs
// at the same time and dates are shown together as one block with a line per
// court. Hunter types a title, length, sessions, price... into a line and it
// saves to dssc_plan_programs (kept apart from the bookings, so re-importing
// the workbook never wipes it). A run can hold more than one titled program
// (an 8-week session, then another): "+ Split" adds the next one.
// Titles show on the Planning Calendar in place of the generic name.
import { useMemo, useState } from "react";
import { supabase } from "../supabase";

const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", grn: "#22c55e", red: "#ef4444", amb: "#f59e0b" };
const PLAN = "2027";
// Rentals, DS Elite, holidays and contracted blocks aren't programs to title.
export const NOT_A_PROGRAM = /^(Rental|Day Rent|DSEV|TCG|Veritas|Privates|TWE|Booked|HOLIDAY)$/i;
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const STATUS = [["idea", "Idea", "#94a3b8"], ["planned", "Planned", "#3b82f6"], ["ready", "Ready", "#f59e0b"], ["published", "Published", "#22c55e"]];
const statusColor = (s) => (STATUS.find(x => x[0] === s) || STATUS[0])[2];
const wdOf = (d) => new Date(d + "T12:00:00").getDay();
const hm = (s) => { const h = Math.floor(s / 2), ap = h >= 12 ? "pm" : "am", h12 = ((h + 11) % 12) + 1; return h12 + (s % 2 ? ":30" : "") + ap; };
const fmtD = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
const courtName = (c) => (c === "FLEX" ? "Flex" : "Court " + c.slice(1));
const inp = { background: "#0f0f0f", border: "1px solid " + C.border, borderRadius: 6, color: C.text, fontFamily: "inherit", fontSize: 12, padding: "5px 6px", boxSizing: "border-box", colorScheme: "dark", width: "100%" };
const chip = (on) => ({ fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", border: "1px solid " + (on ? C.gold : C.border), background: on ? "rgba(233,30,140,0.15)" : "transparent", color: on ? C.gold : C.mut, whiteSpace: "nowrap" });

const keyOf = (program, court, weekday, start, slots) => [program, court, weekday, start, slots].join("|");

// Runs: one per program/court/weekday/start/length, split where it skips more
// than two weeks.
export function planRuns(rows) {
  const g = new Map();
  for (const r of rows || []) {
    if (NOT_A_PROGRAM.test(r.program || "")) continue;
    const k = keyOf(r.program, r.court, wdOf(r.date), r.start_slot, r.slots);
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(r.date);
  }
  const out = [];
  for (const [k, ds] of g) {
    const [program, court, weekday, start, slots] = k.split("|");
    const dates = [...new Set(ds)].sort();
    let cur = [dates[0]];
    const flush = () => out.push({ key: k, program, court, weekday: +weekday, start: +start, slots: +slots, from: cur[0], to: cur[cur.length - 1], dates: cur });
    for (let i = 1; i < dates.length; i++) {
      if ((Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 864e5 > 14) { flush(); cur = [dates[i]]; } else cur.push(dates[i]);
    }
    flush();
  }
  return out;
}

// For the calendar: the titled program a booking falls under, if any.
export function programIndex(recs) {
  const m = new Map();
  for (const r of recs || []) { const k = keyOf(r.program, r.court, r.weekday, r.start_slot, r.slots); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
}
export const programFor = (idx, b) => (idx.get(keyOf(b.program, b.court, wdOf(b.date), b.start_slot, b.slots)) || []).find(r => r.date_from <= b.date && r.date_to >= b.date && r.title);

const money = (n) => "$" + Math.round(n).toLocaleString();
const sessionsIn = (run, from, to) => run.dates.filter(d => d >= from && d <= to).length;
// What a program brings in when it fills: price x capacity, per session x
// sessions, per month x months it runs.
const atCapacity = (r, sessions) => {
  const p = Number(r.price), cap = Number(r.capacity);
  if (!(p > 0) || !(cap > 0)) return null;
  if (r.price_per === "session") return p * cap * (Number(r.sessions) || sessions || 0);
  if (r.price_per === "month") return p * cap * Math.max(1, Math.round(((Date.parse(r.date_to) - Date.parse(r.date_from)) / 864e5 + 1) / 30));
  return p * cap;
};

export default function PlanWorkbook({ rows, recs, reloadRecs, me, onJump }) {
  const runs = useMemo(() => planRuns(rows), [rows]);
  const allProgs = useMemo(() => [...new Set(runs.map(r => r.program))].sort(), [runs]);
  const [progs, setProgs] = useState(() => allProgs.filter(p => /volleyball|pod|aces|heatwave/i.test(p)));
  const [days, setDays] = useState([]);
  const [from, setFrom] = useState("2027-01-01");
  const [to, setTo] = useState("2027-12-31");
  const [show, setShow] = useState("all");      // all | untitled | titled | <status>
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");

  const recsFor = (run) => (recs || []).filter(r => keyOf(r.program, r.court, r.weekday, r.start_slot, r.slots) === run.key && r.date_from <= run.to && r.date_to >= run.from).sort((a, b) => a.date_from.localeCompare(b.date_from));
  const needle = q.trim().toLowerCase();

  // Blocks: runs at the same time over the same dates, one line per court.
  const blocks = useMemo(() => {
    const m = new Map();
    for (const run of runs) {
      if (progs.length && !progs.includes(run.program)) continue;
      if (days.length && !days.includes(run.weekday)) continue;
      if (run.to < from || run.from > to) continue;
      const k = [run.program, run.weekday, run.start, run.slots, run.from, run.to].join("|");
      if (!m.has(k)) m.set(k, { k, program: run.program, weekday: run.weekday, start: run.start, slots: run.slots, from: run.from, to: run.to, weeks: run.dates.length, runs: [] });
      m.get(k).runs.push(run);
    }
    const list = [...m.values()];
    for (const b of list) b.runs.sort((x, y) => x.court.localeCompare(y.court));
    return list.sort((a, b) => WD_ORDER.indexOf(a.weekday) - WD_ORDER.indexOf(b.weekday) || a.start - b.start || a.from.localeCompare(b.from) || a.program.localeCompare(b.program));
  }, [runs, progs, days, from, to]);

  const blockRecs = (b) => b.runs.flatMap(recsFor);
  const shownBlocks = blocks.filter(b => {
    const rs = blockRecs(b), titled = rs.some(r => r.title);
    if (show === "untitled" && titled) return false;
    if (show === "titled" && !titled) return false;
    if (STATUS.some(s => s[0] === show) && !rs.some(r => r.status === show)) return false;
    if (needle && ![b.program, ...rs.map(r => [r.title, r.coach, r.age_group, r.notes].join(" "))].join(" ").toLowerCase().includes(needle)) return false;
    return true;
  });

  // Totals over what's filtered.
  const inView = shownBlocks.flatMap(b => b.runs.flatMap(run => recsFor(run).map(r => ({ r, run }))));
  const titledCount = inView.filter(x => x.r.title).length;
  const revenue = inView.reduce((t, { r, run }) => t + (atCapacity(r, sessionsIn(run, r.date_from, r.date_to)) || 0), 0);
  const courtRuns = shownBlocks.reduce((t, b) => t + b.runs.length, 0);

  const saveRec = async (run, rec, patch) => {
    const row = { ...patch, updated_by: me, updated_at: new Date().toISOString() };
    const { error } = rec?.id
      ? await supabase.from("dssc_plan_programs").update(row).eq("id", rec.id)
      : await supabase.from("dssc_plan_programs").insert({ plan: PLAN, program: run.program, court: run.court, weekday: run.weekday, start_slot: run.start, slots: run.slots, date_from: rec?.date_from || run.from, date_to: rec?.date_to || run.to, status: "idea", ...row });
    if (error) { window.alert("Didn't save: " + error.message); return false; }
    await reloadRecs();
    return true;
  };
  const removeRec = async (rec) => {
    if (!window.confirm(`Clear "${rec.title || "this program"}"? The block goes back to its generic name.`)) return;
    const { error } = await supabase.from("dssc_plan_programs").delete().eq("id", rec.id);
    if (error) { window.alert("Didn't clear: " + error.message); return; }
    reloadRecs();
  };
  // + Split: a second program later in the same run (the first ends the week before).
  const split = async (run, rec) => {
    const rest = run.dates.filter(d => d > rec.date_to);
    if (!rest.length) { window.alert("Nothing left in this run after " + fmtD(rec.date_to) + ". Move its end date earlier first."); return; }
    await saveRec(run, { date_from: rest[0], date_to: run.to }, { title: null });
  };
  // Copy one court's program to the other courts in the block that have none yet.
  const copyAcross = async (b, run, rec) => {
    const targets = b.runs.filter(x => x !== run && !recsFor(x).some(r => r.date_from <= rec.date_to && r.date_to >= rec.date_from));
    if (!targets.length) { setMsg("Every other court in that block already has a program."); return; }
    const fields = ["title", "session_minutes", "sessions", "price", "price_per", "age_group", "level", "capacity", "coach", "status", "notes"];
    const base = Object.fromEntries(fields.map(f => [f, rec[f] ?? null]));
    const { error } = await supabase.from("dssc_plan_programs").insert(targets.map(x => ({ plan: PLAN, program: x.program, court: x.court, weekday: x.weekday, start_slot: x.start, slots: x.slots, date_from: rec.date_from, date_to: rec.date_to, ...base, updated_by: me })));
    if (error) { window.alert("Didn't copy: " + error.message); return; }
    setMsg(`Copied to ${targets.map(x => courtName(x.court)).join(", ")}.`);
    reloadRecs();
  };

  const exportCsv = () => {
    const head = ["Title", "Generic program", "Day", "Start", "End", "Session (min)", "Court", "From", "To", "Sessions", "Price", "Per", "Ages", "Level", "Capacity", "Coach", "Status", "At capacity", "Notes"];
    const lines = inView.filter(x => x.r.title).map(({ r, run }) => { const n = r.sessions || sessionsIn(run, r.date_from, r.date_to); const v = atCapacity(r, n); return [r.title, r.program, WD[r.weekday], hm(r.start_slot), hm(r.start_slot + r.slots), r.session_minutes || r.slots * 30, courtName(r.court), r.date_from, r.date_to, n, r.price ?? "", r.price_per || "", r.age_group || "", r.level || "", r.capacity ?? "", r.coach || "", r.status, v == null ? "" : Math.round(v), r.notes || ""]; });
    const csv = [head, ...lines].map(l => l.map(x => /[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "dssc-2027-programs.csv"; a.click();
  };

  const th = { padding: "6px 6px", fontSize: 10, fontWeight: 800, color: C.mut, textAlign: "left", textTransform: "uppercase", letterSpacing: 0.3, borderBottom: "1px solid " + C.border, background: C.card, position: "sticky", top: 0, zIndex: 1, whiteSpace: "nowrap" };
  return (
    <div>
      <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 12, marginBottom: 10, display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: C.mut, textTransform: "uppercase", minWidth: 60 }}>Programs</span>
          {allProgs.map(p => <button key={p} onClick={() => setProgs(progs.includes(p) ? progs.filter(x => x !== p) : [...progs, p])} style={chip(progs.includes(p))}>{p}</button>)}
          <button onClick={() => setProgs(progs.length === allProgs.length ? [] : allProgs)} style={{ ...chip(false), borderStyle: "dashed" }}>{progs.length === allProgs.length ? "None" : "All"}</button>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: C.mut, textTransform: "uppercase", minWidth: 60 }}>Days</span>
          {WD_ORDER.map(d => <button key={d} onClick={() => setDays(days.includes(d) ? days.filter(x => x !== d) : [...days, d])} style={chip(days.includes(d))}>{WD[d]}</button>)}
          <span style={{ fontSize: 10, fontWeight: 800, color: C.mut, textTransform: "uppercase", marginLeft: 8 }}>Dates</span>
          <input type="date" value={from} onChange={e => e.target.value && setFrom(e.target.value)} style={{ ...inp, width: 140 }} />
          <span style={{ color: C.mut }}>to</span>
          <input type="date" value={to} onChange={e => e.target.value && setTo(e.target.value)} style={{ ...inp, width: 140 }} />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: C.mut, textTransform: "uppercase", minWidth: 60 }}>Show</span>
          {[["all", "All"], ["untitled", "Still generic"], ["titled", "Titled"], ...STATUS.map(s => [s[0], s[1]])].map(([v, l]) => <button key={v} onClick={() => setShow(v)} style={chip(show === v)}>{l}</button>)}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search titles, coaches, ages…" style={{ ...inp, width: 220, marginLeft: 8 }} />
          <div style={{ flex: 1 }} />
          <button onClick={exportCsv} style={chip(false)}>⬇ CSV of titled programs</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: C.mut, marginBottom: 8 }}>
        <span><b style={{ color: C.text }}>{shownBlocks.length}</b> time blocks · <b style={{ color: C.text }}>{courtRuns}</b> court lines</span>
        <span><b style={{ color: C.grn }}>{titledCount}</b> titled</span>
        {revenue > 0 && <span>At capacity: <b style={{ color: C.grn }}>{money(revenue)}</b></span>}
        {msg && <span style={{ color: C.gold }}>{msg}</span>}
      </div>

      <div style={{ border: "1px solid " + C.border, borderRadius: 10, overflow: "auto", maxHeight: "72vh" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1250 }}>
          <thead><tr>
            <th style={{ ...th, width: 70 }}>Court</th><th style={{ ...th, width: 210 }}>Runs</th><th style={{ ...th, width: 200 }}>Title</th>
            <th style={{ ...th, width: 62 }}>Min</th><th style={{ ...th, width: 62 }}>Sessions</th><th style={{ ...th, width: 74 }}>Price</th><th style={{ ...th, width: 92 }}>Per</th>
            <th style={{ ...th, width: 80 }}>Ages</th><th style={{ ...th, width: 90 }}>Level</th><th style={{ ...th, width: 54 }}>Cap</th><th style={{ ...th, width: 110 }}>Coach</th>
            <th style={{ ...th, width: 100 }}>Status</th><th style={th}>Notes</th><th style={{ ...th, width: 92 }}></th>
          </tr></thead>
          <tbody>
            {shownBlocks.map(b => (
              <BlockRows key={b.k} b={b} recsFor={recsFor} saveRec={saveRec} removeRec={removeRec} split={split} copyAcross={copyAcross} onJump={onJump} />
            ))}
            {!shownBlocks.length && <tr><td colSpan={14} style={{ padding: 24, textAlign: "center", color: C.mut, fontSize: 13 }}>Nothing matches these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: C.mut, marginTop: 8, lineHeight: 1.6 }}>
        Each block is one generic program at the same time every week; each line is a court. Type in a line and it saves when you leave the box. Dates can be narrowed, and <b>+ Split</b> starts the next program in the same run. <b>Copy →</b> gives the other courts in the block the same program. Titles show on the calendar. "At capacity" = price × capacity (× sessions when priced per session, × months when per month).
      </div>
    </div>
  );
}

function BlockRows({ b, recsFor, saveRec, removeRec, split, copyAcross, onJump }) {
  const len = b.slots * 30;
  return (<>
    <tr>
      <td colSpan={14} style={{ padding: "9px 8px 5px", borderTop: "2px solid " + C.border, background: "#101010" }}>
        <span style={{ fontWeight: 800, color: C.gold }}>{WD[b.weekday]} {hm(b.start)}–{hm(b.start + b.slots)}</span>
        <span style={{ fontWeight: 800 }}> · {b.program}</span>
        <span style={{ color: C.mut, fontSize: 12 }}> · {len} min · <a href="#" onClick={e => { e.preventDefault(); onJump(b.from); }} style={{ color: C.mut }} title="Open this day on the calendar">{fmtD(b.from)}{b.from !== b.to ? " – " + fmtD(b.to) : ""}</a> · {b.weeks} week{b.weeks === 1 ? "" : "s"} · {b.runs.length} court{b.runs.length === 1 ? "" : "s"}</span>
      </td>
    </tr>
    {b.runs.map(run => { const rs = recsFor(run); return (rs.length ? rs : [null]).map((rec, i) => (
      <Line key={run.key + run.from + (rec?.id || "new")} run={run} rec={rec} first={i === 0} b={b} saveRec={saveRec} removeRec={removeRec} split={split} copyAcross={copyAcross} />
    )); })}
  </>);
}

function Line({ run, rec, first, b, saveRec, removeRec, split, copyAcross }) {
  const init = () => ({ title: rec?.title || "", session_minutes: rec?.session_minutes ?? "", sessions: rec?.sessions ?? "", price: rec?.price ?? "", price_per: rec?.price_per || "program", age_group: rec?.age_group || "", level: rec?.level || "", capacity: rec?.capacity ?? "", coach: rec?.coach || "", status: rec?.status || "idea", notes: rec?.notes || "", date_from: rec?.date_from || run.from, date_to: rec?.date_to || run.to });
  const [d, setD] = useState(init);
  const nums = new Set(["session_minutes", "sessions", "price", "capacity"]);
  const val = (k, v) => (nums.has(k) ? (v === "" || v == null ? null : Number(v)) : (typeof v === "string" ? v.trim() || null : v));
  // A line with no program yet is saved the first time something real is typed
  // (title, a number, coach...), carrying the dates/status/per picked so far.
  const META_KEYS = ["date_from", "date_to", "price_per", "status"];
  const commit = async (k, v = d[k]) => {
    const next = { ...d, [k]: v };
    if (next.date_from > next.date_to) { window.alert("The end date is before the start."); setD(init()); return; }
    const now = val(k, v);
    if (!rec) {
      if (META_KEYS.includes(k) || now == null) return;
      const all = Object.fromEntries(Object.keys(next).map(f => [f, val(f, next[f])]));
      await saveRec(run, { date_from: next.date_from, date_to: next.date_to }, all);
      return;
    }
    if (String(now ?? "") === String(rec[k] ?? "")) return;
    await saveRec(run, rec, { [k]: now });
  };
  const bind = (k, extra = {}) => ({ value: d[k], onChange: e => setD({ ...d, [k]: e.target.value }), onBlur: () => commit(k), onKeyDown: e => { if (e.key === "Enter") e.currentTarget.blur(); }, style: { ...inp, ...extra } });
  const sessions = sessionsIn(run, d.date_from, d.date_to);
  const td = { padding: "4px 5px", borderTop: "1px solid #1c1c1c", verticalAlign: "middle" };
  const titled = !!rec?.title;
  return (
    <tr style={{ background: titled ? "rgba(34,197,94,0.04)" : undefined }}>
      <td style={{ ...td, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", color: first ? C.text : C.mut }}>{first ? courtName(run.court) : "↳"}</td>
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
          <input type="date" min={run.from} max={run.to} value={d.date_from} onChange={e => setD({ ...d, date_from: e.target.value })} onBlur={() => commit("date_from")} style={{ ...inp, width: 98, fontSize: 11, padding: "4px 3px" }} />
          <input type="date" min={run.from} max={run.to} value={d.date_to} onChange={e => setD({ ...d, date_to: e.target.value })} onBlur={() => commit("date_to")} style={{ ...inp, width: 98, fontSize: 11, padding: "4px 3px" }} />
        </div>
      </td>
      <td style={td}><input {...bind("title", { fontWeight: 700 })} placeholder={b.program} /></td>
      <td style={td}><input type="number" min="0" step="15" {...bind("session_minutes")} placeholder={String(run.slots * 30)} /></td>
      <td style={td}><input type="number" min="0" {...bind("sessions")} placeholder={String(sessions)} title={`${sessions} on the calendar between these dates`} /></td>
      <td style={td}><input type="number" min="0" step="1" {...bind("price")} placeholder="$" /></td>
      <td style={td}>
        <select value={d.price_per} onChange={e => { setD({ ...d, price_per: e.target.value }); commit("price_per", e.target.value); }} style={inp}>
          <option value="program">program</option><option value="session">session</option><option value="month">month</option>
        </select>
      </td>
      <td style={td}><input {...bind("age_group")} placeholder="U12–U14" /></td>
      <td style={td}><input list="plan-levels" {...bind("level")} placeholder="All" /><datalist id="plan-levels"><option value="Beginner" /><option value="Intermediate" /><option value="Advanced" /><option value="Regional" /><option value="National" /><option value="All levels" /></datalist></td>
      <td style={td}><input type="number" min="0" {...bind("capacity")} placeholder="#" /></td>
      <td style={td}><input {...bind("coach")} placeholder="Coach" /></td>
      <td style={td}>
        <select value={d.status} onChange={e => { setD({ ...d, status: e.target.value }); commit("status", e.target.value); }} style={{ ...inp, color: statusColor(d.status), fontWeight: 700 }}>
          {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </td>
      <td style={td}><input {...bind("notes")} placeholder="Notes" /></td>
      <td style={{ ...td, whiteSpace: "nowrap", fontSize: 11 }}>
        {rec && <button onClick={() => split(run, rec)} title="Start another program later in this run" style={{ background: "none", border: "none", color: C.gold, cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 700, padding: "0 3px" }}>+ Split</button>}
        {rec && b.runs.length > 1 && <button onClick={() => copyAcross(b, run, rec)} title="Give the other courts in this block the same program" style={{ background: "none", border: "none", color: C.mut, cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 700, padding: "0 3px" }}>Copy →</button>}
        {rec && <button onClick={() => removeRec(rec)} title="Clear this program" aria-label="Clear" style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 12, padding: "0 3px" }}>✕</button>}
      </td>
    </tr>
  );
}
