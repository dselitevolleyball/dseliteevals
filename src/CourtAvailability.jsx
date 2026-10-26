// Court availability (Drew, Oct 12 2026): every court, hour by hour - what's
// booked in Playbook (DSSC programs and holds), where DS Elite is practicing,
// and the open time. Playbook comes from /api/court-availability (the public
// calendar, resolved to courts); DS Elite from the same day-schedule builder
// the Day Schedule uses, plus scrimmages and the in-house tournament.
// `loaders` can be swapped (the dev harness uses sample data).
import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { supabase } from "./supabase";
import { loadDseCourtInputs } from "../shared/court-inputs.js";
import { COURTS, buildCourtDay, fmtHour, dseBlock, applyHides, hidesOn, describeChange } from "../shared/courts.js";

const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", grn: "#22c55e" };
const KIND = {
  dssc: { bg: "rgba(178,208,73,0.20)", bd: "#B2D049", fg: "#d9ef8a", name: "DSSC program" },
  empty: { bg: "rgba(56,189,248,0.10)", bd: "#38bdf8", fg: "#7dd3fc", name: "DSSC class, 0 signed up", dash: true },
  hold: { bg: "rgba(249,115,22,0.20)", bd: "#f97316", fg: "#fdba74", name: "Hold / rental" },
  dse: { bg: "rgba(233,30,140,0.20)", bd: "#e91e8c", fg: "#f9a8d4", name: "DS Elite" },
  tourn: { bg: "rgba(245,158,11,0.22)", bd: "#f59e0b", fg: "#fcd34d", name: "In-House Tournament" },
  open: { bg: "rgba(34,197,94,0.07)", bd: "rgba(233,30,140,0.55)", fg: "#4ade80", name: "Open (held for DS Elite, no team)", dash: true },
};
const START_H = 7, END_H = 22;
// Pixels per half hour. Every block is exactly n rows tall (text that doesn't
// fit is clipped; the full text is on hover), so a long label can't stretch
// its rows and pull the courts out of line with the time column.
const ROW = 24;
const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const addDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };
const weekStart = (ymd) => { const d = new Date(ymd + "T12:00:00"); d.setDate(d.getDate() - d.getDay()); return iso(d); }; // Sunday
const fmtDay = (ymd, long) => new Date(ymd + "T12:00:00").toLocaleDateString(undefined, long ? { weekday: "long", month: "long", day: "numeric" } : { weekday: "short", month: "short", day: "numeric" });
const fmtMD = (ymd) => new Date(ymd + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
const short = (h) => fmtHour(h).replace(":00", "").replace("am", "a").replace("pm", "p");
const windows = (w) => w.filter(([s, e]) => e - s >= 0.5).map(([s, e]) => short(s) + "–" + short(e));

const postCourts = async (body) => {
  const { data: { session } = {} } = await supabase.auth.getSession();
  const r = await fetch("/api/court-availability", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify(body) });
  const o = await r.json().catch(() => ({}));
  if (!r.ok || o.error) throw new Error(o.error || "Didn't save (" + r.status + ")");
  return o;
};

// Live data: Playbook bookings for the week + DS Elite for each day.
export const liveLoaders = {
  bookings: async (start, days) => {
    const { data: { session } = {} } = await supabase.auth.getSession();
    const r = await fetch(`/api/court-availability?start=${start}&days=${days}`, { headers: { Authorization: "Bearer " + (session?.access_token || "") } });
    const o = await r.json().catch(() => ({}));
    if (!r.ok || o.error) throw new Error(o.error || "Playbook pull failed (" + r.status + ")");
    return o;
  },
  dse: (dates) => loadDseCourtInputs(supabase, dates),
  // Playbook's Events export (events.csv) -> the timed rentals for its dates.
  importRentals: async (rows, range = {}) => {
    const { data: { session } = {} } = await supabase.auth.getSession();
    const r = await fetch("/api/court-availability", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify({ action: "import-rentals", rows, from: range.from, to: range.to, exportedAt: range.exportedAt }) });
    const o = await r.json().catch(() => ({}));
    if (!r.ok || o.error) throw new Error(o.error || "Upload failed (" + r.status + ")");
    return o;
  },
  // Hide a block on the chart (one date, or every week on that weekday), or show it again.
  hide: async (row) => postCourts({ action: "hide", ...row }),          // row.move = { courts, start, end } moves it instead
  editMove: async (id, move) => postCourts({ action: "edit-move", id, move }),
  unhide: async (id) => postCourts({ action: "unhide", id }),          // hidden: show again · moved: put back
  // The change log for Playbook, and emailing it to Jonathan.
  changes: async () => postCourts({ action: "changes" }),
  sendChanges: async (keys, note) => postCourts({ action: "send-changes", keys, note }),
  // DS Elite's court-hours for a month: in use vs held in Playbook.
  usage: async (month) => {
    const { data: { session } = {} } = await supabase.auth.getSession();
    const r = await fetch("/api/court-availability?usage=" + month, { headers: { Authorization: "Bearer " + (session?.access_token || "") } });
    const o = await r.json().catch(() => ({}));
    if (!r.ok || o.error) throw new Error(o.error || "Couldn't load the month (" + r.status + ")");
    return o;
  },
  // The no-login link for open-gym members (only open vs booked time).
  link: async () => {
    const { data: { session } = {} } = await supabase.auth.getSession();
    const r = await fetch("/api/court-availability?link=1", { headers: { Authorization: "Bearer " + (session?.access_token || "") } });
    const o = await r.json().catch(() => ({}));
    if (!r.ok || !o.url) throw new Error(o.error || "Couldn't get the link");
    return o.url;
  },
};

// Kept across visits, so opening a class card and coming back lands on the
// same day without pulling Playbook again.
const kept = { date: null, mode: "day", cache: {} };

export default function CourtAvailability({ loaders = liveLoaders, onOpenClass }) {
  const [date, setDate] = useState(kept.date || iso(new Date()));
  const [mode, setMode] = useState(kept.mode);
  const [showHolds, setShowHolds] = useState(true);
  // Client view (Drew, Oct 12): what members would see - only open vs booked,
  // no program, renter or team names, rentals always counted as booked.
  const [pub, setPub] = useState(false);
  const [memberLink, setMemberLink] = useState("");
  const [copied, setCopied] = useState(false);   // shown once fetched, also copied
  const [cache, setCache] = useState(loaders === liveLoaders ? kept.cache : {});      // weekStart -> { bookings, dse, offCourt, at } | { error }
  useEffect(() => { kept.date = date; kept.mode = mode; if (loaders === liveLoaders) kept.cache = Object.fromEntries(Object.entries(cache).filter(([, v]) => !v.error)); }, [date, mode, cache]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(null);       // week being pulled
  const [hideAsk, setHideAsk] = useState(null); // { date, hide, label, change } - the block being moved or hidden
  const [hideBusy, setHideBusy] = useState(false);
  const [moveForm, setMoveForm] = useState(null); // { courts:[...], start, end }
  const [pbChanges, setPbChanges] = useState(null); // { pending, sent } - the change log for Playbook
  const [pbOpen, setPbOpen] = useState(false);
  const [pbPick, setPbPick] = useState({});      // key -> false when unticked
  const [pbNote, setPbNote] = useState("");
  const [pbBusy, setPbBusy] = useState(false);
  // Month usage: what DS Elite actually uses (and owes DSSC) vs what's held.
  const [useOpen, setUseOpen] = useState(false);
  const [useMonth, setUseMonth] = useState(null);
  const [useData, setUseData] = useState({});    // month -> result | { loading } | { error }
  const [rate, setRate] = useState(() => { try { return localStorage.getItem("courts.rate") || ""; } catch { return ""; } });
  const loadPb = () => { if (loaders.changes) loaders.changes().then(setPbChanges).catch(() => {}); };
  useEffect(loadPb, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [reload, setReload] = useState(0);
  // Rentals upload (Drew, Oct 14 2026): Playbook's Events export carries every
  // Rented Session with its time and court, which nothing else gives HQ.
  const [rentImp, setRentImp] = useState(null);  // { pending } | { loading } | result | { error }
  const fileRef = useRef(null);
  // Read the file, then ask which dates the export was made for: rentals HQ has
  // in that range are replaced, so one cancelled at either end drops out too.
  const pickRentals = (f) => {
    if (!f) return;
    Papa.parse(f, { header: true, skipEmptyLines: true, complete: ({ data: rows }) => {
      if (fileRef.current) fileRef.current.value = "";
      const ds = rows.map(r => String(Object.entries(r).find(([k]) => /^\s*date\s*$/i.test(k))?.[1] || "").trim()).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
      // An export with nothing in it (every rental cancelled) still clears its
      // dates, once the uploader says which dates those were.
      const first = ds[0] || null, last = ds[ds.length - 1] || null;
      setRentImp({ pending: true, rows, name: f.name, exportedAt: f.lastModified ? new Date(f.lastModified).toISOString() : null, first, last, from: first || "", to: last || "" });
    }, error: (e) => setRentImp({ error: e.message }) });
  };
  const uploadRentals = async () => {
    const p = rentImp; if (!p?.pending) return;
    if (!p.from || !p.to || p.from > p.to) { window.alert("Pick the dates you exported from Playbook."); return; }
    if (p.first && (p.from > p.first || p.to < p.last)) { window.alert("The range has to include every date in the file (" + fmtMD(p.first) + " – " + fmtMD(p.last) + ")."); return; }
    if (!p.first && !window.confirm("There are no rentals in this file. Clear HQ's rentals for " + fmtMD(p.from) + " – " + fmtMD(p.to) + "?")) return;
    setRentImp({ loading: true });
    try { const o = await loaders.importRentals(p.rows, { from: p.from, to: p.to, exportedAt: p.exportedAt }); setRentImp(o); kept.cache = {}; setCache({}); setReload(r => r + 1); }
    catch (e) { setRentImp({ error: e.message }); }
  };
  const wk = weekStart(date);
  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(wk, i)), [wk]);

  useEffect(() => {
    if (cache[wk] && !reload) return;
    let live = true; const mine = wk; setBusy(mine);
    Promise.all([loaders.bookings(wk, 7), loaders.dse(dates)])
      .then(([b, dse]) => { if (live) setCache(c => ({ ...c, [wk]: { bookings: b.bookings || [], reservations: b.reservations || [], hides: b.hides || [], offCourt: b.offCourt || 0, rosterAt: b.rosterAt || null, rentals: b.rentals || null, dse, at: new Date() } })); })
      .catch(e => { if (live) setCache(c => ({ ...c, [wk]: { error: e.message } })); })
      .finally(() => { setBusy(b => (b === mine ? null : b)); if (live) setReload(0); });
    return () => { live = false; };
  }, [wk, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = cache[wk];
  const loading = busy === wk;
  // Clinics & Camps classes carry their sign-ups (the board's numbers). A class
  // with nobody signed up gets its own color, and dropEmpty builds the day
  // without them - the extra court time we'd have if those classes didn't run.
  const isEmpty = (b) => b.kind === "dssc" && b.signups === 0;
  const gridFor = (d, dropEmpty) => {
    if (!data || data.error) return null;
    const dse = data.dse[d] || { teams: [], scrims: [], tourn: [] };
    // Hidden blocks come off first, matched on Playbook's own labels.
    const shown = applyHides(d, { bookings: data.bookings.filter(b => b.date === d), reserved: dseBlock(d, data.reservations || []) }, data.hides || []);
    const bookings = shown.bookings.filter(b => (pub || showHolds || b.kind !== "hold") && !(dropEmpty && isEmpty(b)))
      .map(b => ({ courts: b.courts, start: b.start, end: b.end, kind: isEmpty(b) ? "empty" : b.kind, label: b.label, origin: b.origin, change: b.change, detail: (b.signups != null ? b.signups + " signed up this date" + (b.category ? " · " : "") : "") + (b.category || ""), ref: b.clinicId ? { cid: b.clinicId, sid: b.sessionId } : null }))
      .concat(dse.tourn || []);
    return { ...buildCourtDay({ bookings, teams: dse.teams, scrims: dse.scrims, reserved: shown.reserved, startHour: START_H, endHour: END_H, releaseHeld: !pub }), cancelled: dse.cancelled, phase: dse.phase };
  };

  // Court time that only opens up if the empty classes are dropped, per court.
  const extraFree = (d, g) => {
    if (pub || !g || !data.bookings.some(b => b.date === d && isEmpty(b))) return {};
    const alt = gridFor(d, true);
    return Object.fromEntries(COURTS.map(c => { const w = []; let s0 = null;
      g.slots.forEach((h, i) => { const x = g.cells[c.id][i] && !alt.cells[c.id][i]; if (x && s0 == null) s0 = h; else if (!x && s0 != null) { w.push([s0, h]); s0 = null; } });
      if (s0 != null) w.push([s0, END_H]); return [c.id, w]; }));
  };
  const emptyOn = (ds) => (data && !data.error ? data.bookings.filter(b => ds.includes(b.date) && isEmpty(b)) : []);
  const emptyList = (ds, title) => { const e = emptyOn(ds); if (pub || !e.length) return null; return (
    <div style={{ fontSize: 12, color: KIND.empty.fg, margin: "0 0 10px", padding: "8px 10px", border: "1px dashed " + KIND.empty.bd, borderRadius: 10, lineHeight: 1.6 }}>
      <b>{title} ({e.length}):</b>{" "}
      {e.map((b, i) => <span key={i}>{i ? " · " : ""}{ds.length > 1 ? fmtDay(b.date) + " " : ""}{short(b.start)}–{short(b.end)} {b.label} <span style={{ color: C.mut }}>({courtNames(b.courts)})</span></span>)}
    </div>); };

  // Reservations Playbook has with no time (rentals): listed on their day, not drawn.
  const untimed = (d) => {
    if (!data || data.error) return [];
    const sun = new Date(d + "T12:00:00").getDay() === 0;
    return (data.reservations || []).filter(r => r.date === d && !(sun && r.internal) && !r.timed && !r.covered);
  };
  const courtNames = (cs) => cs.map(c => c.replace("V", "Court ")).join(" + ");
  const btn = (on) => ({ padding: "7px 14px", border: "none", background: on ? C.gold : "transparent", color: on ? "#000" : C.mut, fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" });
  const nav = (n) => setDate(addDays(date, mode === "week" ? 7 * n : n));
  const legend = pub ? (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 11, color: C.mut, margin: "0 0 10px" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: "rgba(34,197,94,0.10)", border: "1px solid rgba(34,197,94,0.5)" }} />Open</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: "#1c1c1c", border: "1px solid #3a3a3a" }} />Booked</span>
    </div>
  ) : (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 11, color: C.mut, margin: "0 0 10px" }}>
      {Object.entries(KIND).map(([k, v]) => <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: v.bg, border: (v.dash ? "1px dashed " : "1px solid ") + v.bd }} />{v.name}</span>)}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, border: "1px dashed " + KIND.dse.bd }} />DS Elite, court not set</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: "rgba(34,197,94,0.10)", border: "1px solid rgba(34,197,94,0.5)" }} />Free</span>
    </div>
  );

  const dayView = () => {
    const g = gridFor(date); if (!g) return null;
    const xf = extraFree(date, g);
    // Playbook reservations with no time (rentals): tagged on their court's
    // column, and that court's free time is outlined - it may not really be free.
    const resOn = Object.fromEntries(COURTS.map(c => [c.id, untimed(date).filter(r => r.courts.includes(c.id))]));
    const th = { padding: "6px 6px", fontSize: 11, fontWeight: 800, color: C.mut, textAlign: "center", borderBottom: "1px solid " + C.border, background: C.bg, position: "sticky", top: 0, zIndex: 1 };
    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 12 }}>
          {COURTS.map(c => { const w = windows(g.free[c.id]); return (
            <div key={c.id} style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 10, padding: "8px 10px" }}>
              <div style={{ fontSize: 12, fontWeight: 800 }}>{c.label} <span style={{ color: C.mut, fontWeight: 600 }}>· {c.building}</span></div>
              <div style={{ fontSize: 12, color: w.length ? C.grn : C.mut, marginTop: 2, lineHeight: 1.5 }}>{w.length ? (pub ? "Open " : "Free ") + w.join(", ") : "No open time"}</div>
              {windows(xf[c.id] || []).length > 0 && <div style={{ fontSize: 11, color: KIND.empty.fg, marginTop: 2, lineHeight: 1.5 }} title="Booked by a class with nobody signed up">+ {windows(xf[c.id]).join(", ")} if empty classes drop</div>}
            </div>); })}
        </div>
        {emptyList([date], "No sign-ups today")}
        {untimed(date).length > 0 && (
          <div style={{ fontSize: 12, color: "#fdba74", marginBottom: 8, lineHeight: 1.6 }}>
            {pub ? "Also reserved today (time not shown): " : "Also reserved today - Playbook reservation, time not on the calendar: "}
            {untimed(date).map((r, i) => <span key={i}>{i ? " · " : ""}<b>{courtNames(r.courts)}</b>{pub ? "" : " (" + r.who + ")"}</span>)}
          </div>
        )}
        {!pub && g.cancelled && <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 8 }}>DS Elite practices are off this day: {g.cancelled}</div>}
        {!pub && g.issues.length > 0 && <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 8 }}>⚠ {g.issues.join(" · ")}</div>}
        {!pub && (g.usage.used > 0 || g.usage.held > 0) && <div style={{ fontSize: 12, color: C.mut, marginBottom: 8 }}>
          <b style={{ color: KIND.dse.fg }}>DS Elite today: {g.usage.used} court-hours in use</b>{g.usage.held > 0 ? <> of {g.usage.held} held in Playbook · <b style={{ color: g.usage.heldUnused ? "#4ade80" : C.mut }}>{g.usage.heldUnused} held hours open</b> (not used, so not owed)</> : null}
        </div>}
        <div style={{ overflowX: "auto", border: "1px solid " + C.border, borderRadius: 10 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 620, tableLayout: "fixed" }}>
            <thead>
              <tr><th style={{ ...th, width: 58 }} rowSpan={2}>Time</th><th style={th} colSpan={4}>Warehouse I</th><th style={{ ...th, borderLeft: "2px solid " + C.border }} colSpan={2}>Warehouse II</th></tr>
              <tr>{COURTS.map((c, i) => <th key={c.id} style={{ ...th, top: 27, borderLeft: i === 4 ? "2px solid " + C.border : undefined }}>{c.label}
                {resOn[c.id].map((r, j) => <div key={j} title="Playbook reservation - the time isn't on the calendar" style={{ marginTop: 3, padding: "2px 4px", borderRadius: 5, background: KIND.hold.bg, border: "1px dashed " + KIND.hold.bd, color: KIND.hold.fg, fontSize: 10, fontWeight: 700, lineHeight: 1.25 }}>{pub ? "Reserved" : r.who} · time?</div>)}
              </th>)}</tr>
            </thead>
            <tbody>
              {g.slots.map((h, si) => (
                <tr key={h}>
                  <td style={{ fontSize: 10, color: C.mut, padding: "0 6px", borderTop: Number.isInteger(h) ? "1px solid " + C.border : "1px dotted #1f1f1f", height: ROW, boxSizing: "border-box", verticalAlign: "top", whiteSpace: "nowrap" }}>{Number.isInteger(h) ? fmtHour(h) : ""}</td>
                  {COURTS.map((c, ci) => {
                    const col = g.cells[c.id], cell = col[si];
                    const same = (a, b) => (!a && !b) || (a && b && (pub || a.key === b.key));
                    if (si > 0 && same(col[si - 1], cell)) return null;     // merged into the cell above
                    let n = 1; while (si + n < col.length && same(col[si + n], cell)) n++;
                    const k = cell && KIND[cell.kind];
                    const run = col.slice(si, si + n), conflict = run.some(x => x && x.conflict), also = [...new Set(run.flatMap(x => (x && x.also) || []))];
                    return (
                      <td key={c.id} rowSpan={n} title={pub ? (cell ? "Booked" : "Open") : cell ? cell.label + (cell.detail ? " · " + cell.detail : "") + (also.length ? " · also: " + also.join(", ") : "") + (cell.ref && onOpenClass ? " - click to open the class card" : "") : "Free"}
                        onClick={!pub && cell?.ref && onOpenClass ? () => onOpenClass(cell.ref.cid, cell.ref.sid) : undefined}
                        style={{ padding: 2, borderLeft: ci === 4 ? "2px solid " + C.border : "1px solid #1a1a1a", verticalAlign: "top" }}>
                        <div style={cell && pub
                          ? { boxSizing: "border-box", height: n * ROW - 4, overflow: "hidden", borderRadius: 6, background: "#1c1c1c", border: "1px solid #3a3a3a", color: "#8a8a8a", padding: "3px 5px", fontSize: 11, fontWeight: 700 }
                          : cell
                          ? { boxSizing: "border-box", height: n * ROW - 4, overflow: "hidden", position: "relative", borderRadius: 6, background: k.bg, border: (cell.auto || k.dash ? "1px dashed " : "1px solid ") + (conflict ? "#ef4444" : k.bd), color: k.fg, cursor: cell.ref && onOpenClass ? "pointer" : undefined, padding: n === 1 ? "2px 5px" : "3px 5px", fontSize: 11, fontWeight: 700, lineHeight: 1.25 }
                          : { boxSizing: "border-box", height: n * ROW - 4, overflow: "hidden", borderRadius: 6, background: "rgba(34,197,94,0.07)", border: resOn[c.id].length ? "1px dashed " + KIND.hold.bd : "1px solid rgba(34,197,94,0.25)", color: "#4ade80", padding: "3px 5px", fontSize: 10, fontWeight: 700 }}>
                          {!pub && cell?.hide && <button onClick={(e) => { e.stopPropagation(); openBlock({ date, hide: cell.hide, label: cell.label, change: cell.change, now: cell.change ? { courts: cell.change.to_courts, start: cell.change.to_start_h, end: cell.change.to_end_h } : null }); }} title="Move or hide this block" aria-label={"Move or hide " + cell.label}
                            style={{ position: "absolute", top: 1, right: 2, width: 20, height: 18, padding: 0, border: "none", borderRadius: 4, background: "rgba(0,0,0,0.35)", color: "inherit", fontSize: 13, lineHeight: "16px", cursor: "pointer", opacity: 0.8 }}>⋯</button>}
                          {cell && pub ? "Booked" : cell?.open ? <>{"Open" + (n >= 2 ? " " + short(h) + "–" + short(g.slots[si + n - 1] + 0.5) : "")}{n >= 2 ? <div style={{ fontWeight: 500, opacity: 0.85, color: "#f9a8d4" }}>held for DS Elite, no team</div> : null}</> : cell ? <>{conflict ? "⚠ " : ""}{cell.kind === "empty" && n < 2 ? "0 · " : ""}{cell.label}{n >= 2 && cell.detail ? <div style={{ fontWeight: 500, opacity: 0.8 }}>{cell.detail}</div> : null}</> : (n >= 2 ? (pub ? "Open " : "Free ") + short(h) + "–" + short(g.slots[si + n - 1] + 0.5) : "")}{!cell && n >= 2 && resOn[c.id].length ? <div style={{ color: KIND.hold.fg, fontWeight: 600 }}>? reserved sometime today</div> : null}
                        </div>
                      </td>);
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!pub && hiddenList(date)}
        {!pub && hideAsk && hidePrompt()}
      </div>
    );
  };

  // ── Moving and hiding blocks ──────────────────────────────────────────────
  // A move or hide is saved in HQ (court_block_hides) and listed under
  // "Playbook changes" until it's emailed to Jonathan to make in Playbook.
  const weekdayOf = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" });
  const spanText = (h) => short(h.start ?? h.start_h) + "–" + short(h.end ?? h.end_h);
  const afterHideChange = () => { kept.cache = {}; setCache({}); setReload(r => r + 1); loadPb(); };
  const openBlock = (a) => { setHideAsk(a); const at = a.now || a.hide; setMoveForm({ courts: [...at.courts], start: at.start, end: at.end }); };
  const closeBlock = () => { if (!hideBusy) { setHideAsk(null); setMoveForm(null); } };
  const busyDo = async (fn, what) => {
    setHideBusy(true);
    try { await fn(); setHideAsk(null); setMoveForm(null); afterHideChange(); }
    catch (e) { window.alert("Couldn't " + what + ": " + e.message); }
    finally { setHideBusy(false); }
  };
  const blockRow = (a, weekly, move) => ({ kind: a.hide.kind, label: a.hide.label, start: a.hide.start, end: a.hide.end, courts: a.hide.courts, date: a.date, weekly, ...(move ? { move } : {}) });
  const doHide = (weekly) => busyDo(() => loaders.hide(blockRow(hideAsk, weekly)), "hide it");
  const doMove = (weekly) => {
    const m = moveForm, a = hideAsk;
    if (!m.courts.length || !(m.end > m.start)) { window.alert("Pick at least one court and an end time after the start."); return; }
    if (a.change) return busyDo(() => loaders.editMove(a.change.id, m), "move it");
    return busyDo(() => loaders.hide(blockRow(a, weekly, m)), "move it");
  };
  const showAgain = async (h) => {
    const verb = h.action === "move" ? "puts it back" : "shows it again";
    if (h.weekly && !window.confirm("This " + verb + " on every " + weekdayOf(h.date) + ", not just this day. Go ahead?")) return;
    try { await loaders.unhide(h.id); afterHideChange(); }
    catch (e) { window.alert("Couldn't undo it: " + e.message); }
  };
  const HALF = Array.from({ length: (23 - 6) * 2 + 1 }, (_, i) => 6 + i / 2);
  const hidePrompt = () => {
    const a = hideAsk, wd = weekdayOf(a.date), m = moveForm || { courts: [], start: 0, end: 0 };
    const b2 = (primary) => ({ padding: "10px 12px", borderRadius: 8, border: primary ? "none" : "1px solid " + C.border, background: primary ? C.gold : "transparent", color: primary ? "#000" : C.text, fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: hideBusy ? "default" : "pointer", textAlign: "left" });
    const sel = { background: C.bg, color: C.text, border: "1px solid " + C.border, borderRadius: 8, padding: "7px 8px", fontFamily: "inherit", fontSize: 13, colorScheme: "dark" };
    const sect = { fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: C.mut, margin: "14px 0 6px" };
    const toggleCourt = (id) => setMoveForm(f => ({ ...f, courts: f.courts.includes(id) ? f.courts.filter(x => x !== id) : COURTS.map(c => c.id).filter(x => x === id || f.courts.includes(x)) }));
    return (
      <div onClick={closeBlock} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 16, width: "100%", maxWidth: 420, maxHeight: "90vh", overflowY: "auto" }}>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>{a.label}</div>
          <div style={{ fontSize: 12, color: C.mut, lineHeight: 1.5 }}>
            {a.change ? <>Moved in HQ from {courtNames(a.hide.courts)}, {spanText(a.hide)}{a.change.weekly ? " (every " + weekdayOf(a.change.date) + ")" : ""}.</> : <>{courtNames(a.hide.courts)}, {spanText(a.hide)} · {fmtDay(a.date)}</>}
            {" "}Changes show on this chart and the members' page and go on the Playbook change list for Jonathan; Playbook itself doesn't change until he does it.
          </div>

          <div style={sect}>{a.change ? "Move it somewhere else" : "Move to"}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {COURTS.map(c => <button key={c.id} onClick={() => toggleCourt(c.id)} style={{ padding: "6px 9px", borderRadius: 8, fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer", border: "1px solid " + (m.courts.includes(c.id) ? C.gold : C.border), background: m.courts.includes(c.id) ? "rgba(233,30,140,0.15)" : "transparent", color: C.text }}>{c.label}</button>)}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 12, color: C.mut }}>
            <select value={m.start} onChange={e => setMoveForm(f => ({ ...f, start: +e.target.value }))} style={sel} aria-label="Start">{HALF.map(h => <option key={h} value={h}>{fmtHour(h)}</option>)}</select>
            to
            <select value={m.end} onChange={e => setMoveForm(f => ({ ...f, end: +e.target.value }))} style={sel} aria-label="End">{HALF.map(h => <option key={h} value={h}>{fmtHour(h)}</option>)}</select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            {a.change
              ? <button disabled={hideBusy} onClick={() => doMove(false)} style={b2(true)}>Save the move</button>
              : <>
                <button disabled={hideBusy} onClick={() => doMove(false)} style={b2(true)}>Move just {fmtDay(a.date)}</button>
                <button disabled={hideBusy} onClick={() => doMove(true)} style={b2(false)}>Move every {wd} from {fmtMD(a.date)} on</button>
              </>}
          </div>

          <div style={sect}>{a.change ? "Undo" : "Or hide it"}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {a.change
              ? <button disabled={hideBusy} onClick={() => showAgain(a.change).then(() => { setHideAsk(null); setMoveForm(null); })} style={b2(false)}>Put it back where Playbook has it</button>
              : <>
                <button disabled={hideBusy} onClick={() => doHide(false)} style={b2(false)}>Hide just {fmtDay(a.date)}</button>
                <button disabled={hideBusy} onClick={() => doHide(true)} style={b2(false)}>Hide every {wd} from {fmtMD(a.date)} on</button>
              </>}
            <button disabled={hideBusy} onClick={closeBlock} style={{ ...b2(false), border: "none", color: C.mut, textAlign: "center" }}>Cancel</button>
          </div>
        </div>
      </div>
    );
  };
  const hiddenList = (d) => {
    const on = hidesOn(d, data?.hides || []);
    if (!on.length) return null;
    const link = { background: "none", border: "none", padding: 0, color: C.gold, fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer" };
    const row = (h) => <span key={h.id}>{h.kind === "dse" ? "DS Elite courts" : h.label} {spanText(h)}, {courtNames(h.courts)}{h.action === "move" ? <> → {courtNames(h.to_courts)}, {short(h.to_start_h)}–{short(h.to_end_h)}</> : null}{h.weekly ? " (every " + weekdayOf(h.date) + ")" : ""}{" "}
      <button onClick={() => showAgain(h)} style={link}>{h.action === "move" ? "Put back" : "Show again"}</button></span>;
    const hid = on.filter(h => h.action !== "move"), mov = on.filter(h => h.action === "move");
    return (
      <div style={{ marginTop: 10, fontSize: 12, color: C.mut, lineHeight: 1.7 }}>
        {mov.length > 0 && <div><b style={{ color: C.text }}>Moved on this day:</b> {mov.map((h, i) => <span key={h.id}>{i ? " · " : ""}{row(h)}</span>)}</div>}
        {hid.length > 0 && <div><b style={{ color: C.text }}>Hidden on this day:</b> {hid.map((h, i) => <span key={h.id}>{i ? " · " : ""}{row(h)}</span>)}</div>}
      </div>
    );
  };

  // ── DS Elite usage by month ───────────────────────────────────────────────
  const loadUsage = (m) => { setUseData(u => ({ ...u, [m]: { loading: true } })); loaders.usage(m).then(o => setUseData(u => ({ ...u, [m]: o }))).catch(e => setUseData(u => ({ ...u, [m]: { error: e.message } }))); };
  const shiftMonth = (m, k) => { const [y, mo] = m.split("-").map(Number); const d = new Date(y, mo - 1 + k, 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
  const usagePanel = () => {
    const m = useMonth, u = useData[m] || {};
    const go = (k) => { const n = shiftMonth(m, k); setUseMonth(n); if (!useData[n]) loadUsage(n); };
    const r = Number(String(rate).replace(/[$,\s]/g, "")) || 0;
    const money = (x) => "$" + Math.round(x).toLocaleString();
    const td = { padding: "5px 8px", fontSize: 12, borderTop: "1px solid " + C.border, fontVariantNumeric: "tabular-nums" };
    return (
      <div onClick={() => setUseOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 16, width: "100%", maxWidth: 620, maxHeight: "90vh", overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 16, fontWeight: 800, flex: 1 }}>DS Elite court usage</div>
            <button onClick={() => go(-1)} aria-label="Previous month" style={{ ...btn(false), border: "1px solid " + C.border, borderRadius: 8 }}>‹</button>
            <div style={{ fontSize: 14, fontWeight: 800, minWidth: 120, textAlign: "center" }}>{new Date(m + "-15T12:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" })}</div>
            <button onClick={() => go(1)} aria-label="Next month" style={{ ...btn(false), border: "1px solid " + C.border, borderRadius: 8 }}>›</button>
          </div>
          <div style={{ fontSize: 12, color: C.mut, margin: "6px 0 12px", lineHeight: 1.5 }}>Court-hours DS Elite teams are actually on (from HQ's practice schedule, two teams sharing a court count once), against what's held for DS Elite in Playbook. Held hours with no team are open and not owed.</div>
          {u.loading && <div style={{ color: C.mut, fontSize: 13 }}>Adding up the month…</div>}
          {u.error && <div style={{ color: "#ef4444", fontSize: 13 }}>{u.error} <button onClick={() => loadUsage(m)} style={{ ...btn(false), border: "1px solid #ef4444", borderRadius: 8, color: "#ef4444" }}>Retry</button></div>}
          {u.days && <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              {[["In use", u.total.used + "h", KIND.dse.fg], ["Held in Playbook", u.total.held + "h", C.text], ["Held, no team", u.total.heldUnused + "h", "#4ade80"]].map(([l, v, col]) => (
                <div key={l} style={{ background: C.bg, border: "1px solid " + C.border, borderRadius: 10, padding: "8px 12px", minWidth: 120 }}><div style={{ fontSize: 22, fontWeight: 900, color: col }}>{v}</div><div style={{ fontSize: 11, color: C.mut, fontWeight: 700 }}>{l}</div></div>))}
              <label style={{ background: C.bg, border: "1px solid " + C.border, borderRadius: 10, padding: "8px 12px", fontSize: 11, color: C.mut, fontWeight: 700 }}>Rate per court-hour<br />
                <span style={{ fontSize: 14, color: C.text }}>$ <input value={rate} onChange={e => { setRate(e.target.value); try { localStorage.setItem("courts.rate", e.target.value); } catch { /* private window */ } }} inputMode="decimal" placeholder="0" style={{ width: 70, background: "transparent", color: C.text, border: "none", borderBottom: "1px solid " + C.border, fontFamily: "inherit", fontSize: 14 }} /></span></label>
              {r > 0 && <div style={{ background: C.bg, border: "1px solid " + KIND.dse.bd, borderRadius: 10, padding: "8px 12px", minWidth: 120 }}><div style={{ fontSize: 22, fontWeight: 900, color: KIND.dse.fg }}>{money(u.total.used * r)}</div><div style={{ fontSize: 11, color: C.mut, fontWeight: 700 }}>owed for hours in use{u.total.heldUnused ? " · " + money(u.total.heldUnused * r) + " held but not used" : ""}</div></div>}
            </div>
            <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr>{["Date", "Teams", "In use", "Held", "Open"].map(h => <th key={h} style={{ ...td, textAlign: "left", color: C.mut, fontSize: 11, borderTop: "none" }}>{h}</th>)}</tr></thead>
              <tbody>{u.days.filter(d => d.used || d.held || d.cancelled).map(d => (
                <tr key={d.date} onClick={() => { setDate(d.date); setMode("day"); setUseOpen(false); }} style={{ cursor: "pointer" }}>
                  <td style={td}>{fmtDay(d.date)}{d.cancelled ? <span style={{ color: "#f59e0b" }}> · off</span> : null}</td>
                  <td style={td}>{d.teams || ""}</td>
                  <td style={{ ...td, color: KIND.dse.fg, fontWeight: 700 }}>{d.used}h</td>
                  <td style={td}>{d.held}h</td>
                  <td style={{ ...td, color: d.heldUnused ? "#4ade80" : C.mut }}>{d.heldUnused}h</td>
                </tr>))}</tbody>
            </table></div>
          </>}
          <button onClick={() => setUseOpen(false)} style={{ width: "100%", marginTop: 12, padding: "9px", borderRadius: 10, border: "1px solid " + C.border, background: "transparent", color: C.text, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Close</button>
        </div>
      </div>
    );
  };

  // ── Playbook changes: the list for Jonathan ───────────────────────────────
  const pbPanel = () => {
    const pend = pbChanges?.pending || [], sent = pbChanges?.sent || [];
    const picked = pend.filter(c => pbPick[c.key] !== false);
    const send = async () => {
      if (!picked.length) return;
      if (!window.confirm("Email " + picked.length + " change" + (picked.length === 1 ? "" : "s") + " to Jonathan to make in Playbook? You get a copy.")) return;
      setPbBusy(true);
      try { const o = await loaders.sendChanges(picked.map(c => c.key), pbNote); setPbNote(""); setPbPick({}); loadPb(); window.alert("Sent to " + o.to + "."); }
      catch (e) { window.alert(e.message); }
      finally { setPbBusy(false); }
    };
    const line = (c) => { const l = c.line || describeChange(c); return <><b style={{ color: C.text }}>{l.when}:</b> {l.text}</>; };
    return (
      <div onClick={() => !pbBusy && setPbOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 16, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto" }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Playbook changes</div>
          <div style={{ fontSize: 12, color: C.mut, margin: "4px 0 12px", lineHeight: 1.5 }}>What's been moved, hidden or added here that Playbook doesn't have yet. Send it to Jonathan DelaRosa to make in Playbook; each change drops off this list once it's sent.</div>
          {!pend.length && <div style={{ fontSize: 13, color: C.mut, padding: "8px 0" }}>Nothing waiting. Move or hide a block (⋯ on the chart) and it lands here.</div>}
          {pend.map(c => (
            <label key={c.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: C.mut, padding: "7px 0", borderTop: "1px solid " + C.border, cursor: "pointer", lineHeight: 1.45 }}>
              <input type="checkbox" checked={pbPick[c.key] !== false} onChange={e => setPbPick(p => ({ ...p, [c.key]: e.target.checked }))} style={{ accentColor: C.gold, marginTop: 3 }} />
              <span>{line(c)}</span>
            </label>
          ))}
          {pend.length > 0 && <>
            <textarea value={pbNote} onChange={e => setPbNote(e.target.value)} rows={2} placeholder="Add a note for Jonathan (optional)" style={{ width: "100%", boxSizing: "border-box", marginTop: 10, background: C.bg, color: C.text, border: "1px solid " + C.border, borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
            <button disabled={pbBusy || !picked.length} onClick={send} style={{ width: "100%", marginTop: 10, padding: "11px", borderRadius: 10, border: "none", background: C.gold, color: "#000", fontFamily: "inherit", fontSize: 14, fontWeight: 800, cursor: pbBusy ? "default" : "pointer", opacity: picked.length ? 1 : 0.5 }}>
              {pbBusy ? "Sending…" : "Email " + picked.length + " change" + (picked.length === 1 ? "" : "s") + " to Jonathan"}
            </button>
          </>}
          {sent.length > 0 && <details style={{ marginTop: 14 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: C.mut }}>Already sent ({sent.length})</summary>
            {sent.map(c => <div key={c.key} style={{ fontSize: 12, color: C.mut, padding: "5px 0", borderTop: "1px solid " + C.border, lineHeight: 1.45 }}>{line(c)} <span style={{ opacity: 0.7 }}>· sent {new Date(c.sent_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div>)}
          </details>}
          <button onClick={() => setPbOpen(false)} disabled={pbBusy} style={{ width: "100%", marginTop: 10, padding: "9px", borderRadius: 10, border: "1px solid " + C.border, background: "transparent", color: C.text, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Close</button>
        </div>
      </div>
    );
  };

  const weekView = () => {
    if (!data || data.error) return null;
    const th = { padding: "7px 8px", fontSize: 11, fontWeight: 800, color: C.mut, textAlign: "left", borderBottom: "1px solid " + C.border, background: C.bg, whiteSpace: "nowrap" };
    const grids = Object.fromEntries(dates.map(d => [d, gridFor(d)]));
    const extra = Object.fromEntries(dates.map(d => [d, extraFree(d, grids[d])]));
    return (<>
      {emptyList(dates, "Classes with no sign-ups this week")}
      <div style={{ overflowX: "auto", border: "1px solid " + C.border, borderRadius: 10 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 820 }}>
          <thead><tr><th style={th}>Court</th>{dates.map(d => <th key={d} style={{ ...th, cursor: "pointer", color: d === date ? C.gold : C.mut }} onClick={() => { setDate(d); setMode("day"); }}>{fmtDay(d)}</th>)}</tr></thead>
          <tbody>
            {COURTS.map(c => (
              <tr key={c.id}>
                <td style={{ padding: "8px", fontSize: 12, fontWeight: 800, borderTop: "1px solid " + C.border, whiteSpace: "nowrap" }}>{c.label}<div style={{ fontSize: 10, color: C.mut, fontWeight: 600 }}>{c.building}</div></td>
                {dates.map(d => { const w = windows(grids[d].free[c.id]); return (
                  <td key={d} onClick={() => { setDate(d); setMode("day"); }} style={{ padding: "8px", fontSize: 11, borderTop: "1px solid " + C.border, borderLeft: "1px solid #1a1a1a", verticalAlign: "top", cursor: "pointer", color: w.length ? C.grn : C.mut, lineHeight: 1.6 }}>
                    {w.length ? w.map(x => <div key={x}>{x}</div>) : "Booked"}
                    {windows(extra[d][c.id] || []).map(x => <div key={"e" + x} style={{ color: KIND.empty.fg, fontSize: 10 }} title="Opens up if the class with nobody signed up doesn't run">+ {x} (empty class)</div>)}
                    {untimed(d).some(r => r.courts.includes(c.id)) && <div style={{ color: "#fdba74", fontSize: 10 }} title="A Playbook reservation with no time on the calendar">+ reserved (time?)</div>}
                  </td>); })}
              </tr>
            ))}
            {!pub && <tr>
              <td style={{ padding: "8px", fontSize: 12, fontWeight: 800, borderTop: "2px solid " + C.border, color: KIND.dse.fg, whiteSpace: "nowrap" }}>DS Elite<div style={{ fontSize: 10, color: C.mut, fontWeight: 600 }}>used / held</div></td>
              {dates.map(d => { const u = grids[d].usage; return <td key={d} style={{ padding: "8px", fontSize: 11, borderTop: "2px solid " + C.border, borderLeft: "1px solid #1a1a1a", color: C.mut, lineHeight: 1.6 }}>
                {u.used || u.held ? <><b style={{ color: KIND.dse.fg }}>{u.used}h</b> of {u.held}h{u.heldUnused ? <div style={{ color: "#4ade80" }}>{u.heldUnused}h open</div> : null}</> : "—"}</td>; })}
            </tr>}
          </tbody>
        </table>
      </div>
      {!pub && (() => { const t = dates.reduce((a, d) => { const u = grids[d].usage; return { used: a.used + u.used, held: a.held + u.held, open: a.open + u.heldUnused }; }, { used: 0, held: 0, open: 0 });
        return <div style={{ fontSize: 12, color: C.mut, marginTop: 8 }}>This week DS Elite uses <b style={{ color: KIND.dse.fg }}>{t.used} court-hours</b> of the {t.held} held in Playbook; <b style={{ color: "#4ade80" }}>{t.open} held hours</b> have no team on them.</div>; })()}
    </>);
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.gold }}>🏟 Court Availability</h2>
        <div style={{ flex: 1 }} />
        <button onClick={() => nav(-1)} aria-label="Previous" style={{ ...btn(false), border: "1px solid " + C.border, borderRadius: 8 }}>‹</button>
        <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} style={{ background: C.bg, color: C.text, border: "1px solid " + C.border, borderRadius: 8, padding: "6px 8px", fontFamily: "inherit", fontSize: 13, colorScheme: "dark" }} />
        <button onClick={() => nav(1)} aria-label="Next" style={{ ...btn(false), border: "1px solid " + C.border, borderRadius: 8 }}>›</button>
        <div style={{ display: "inline-flex", border: "1px solid " + C.border, borderRadius: 8, overflow: "hidden" }}>
          <button onClick={() => setMode("day")} style={btn(mode === "day")}>Day</button>
          <button onClick={() => setMode("week")} style={btn(mode === "week")}>Week</button>
        </div>
        <button onClick={async () => { try { const u = memberLink || await loaders.link(); setMemberLink(u); try { await navigator.clipboard.writeText(u); setCopied(true); } catch { setCopied(false); /* copy blocked: the link shows below */ } } catch (e) { window.alert(e.message); } }}
          title="The no-login link for open-gym members: open court time only, no names" style={{ ...btn(false), border: "1px solid " + C.border, borderRadius: 8 }}>🔗 Members&rsquo; link</button>
        {!pub && loaders.usage && <button onClick={() => { const m = (useMonth || date.slice(0, 7)); setUseMonth(m); setUseOpen(true); if (!useData[m]) loadUsage(m); }} title="DS Elite court-hours in use vs held, per month" style={{ ...btn(false), border: "1px solid " + C.border, borderRadius: 8 }}>💵 DS Elite usage</button>}
        {useOpen && usagePanel()}
        {!pub && loaders.changes && <button onClick={() => { loadPb(); setPbOpen(true); }} title="Moves, hides and added rentals to send to Jonathan for Playbook" style={{ ...btn(false), border: "1px solid " + ((pbChanges?.pending || []).length ? C.gold : C.border), borderRadius: 8 }}>📝 Playbook changes{(pbChanges?.pending || []).length ? " (" + pbChanges.pending.length + ")" : ""}</button>}
        {pbOpen && pbPanel()}
        <button onClick={() => setPub(v => !v)} title="Show only open vs booked time - what members would see" style={{ ...btn(pub), border: "1px solid " + (pub ? C.gold : C.border), borderRadius: 8 }}>👁 Client view</button>
        {!pub && <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: C.mut, cursor: "pointer" }}><input type="checkbox" checked={showHolds} onChange={e => setShowHolds(e.target.checked)} style={{ accentColor: C.gold }} />Holds &amp; rentals</label>}
        {!pub && loaders.importRentals && <>
          <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={e => pickRentals(e.target.files?.[0])} />
          <button onClick={() => fileRef.current?.click()} disabled={!!rentImp?.loading} title="Upload Playbook's Events export (events.csv): every rented session with its time and court" style={{ ...btn(false), border: "1px solid " + C.border, borderRadius: 8 }}>{rentImp?.loading ? "Uploading…" : "⬆ Rentals"}</button>
        </>}
        <button onClick={() => setReload(r => r + 1)} disabled={loading} title="Pull Playbook again" style={{ ...btn(false), border: "1px solid " + C.border, borderRadius: 8 }}>{loading ? "…" : "⟳"}</button>
      </div>
      {memberLink && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 10px", marginBottom: 10, borderRadius: 10, border: "1px solid #B2D049", background: "rgba(178,208,73,0.10)", fontSize: 12 }}>
          <span style={{ color: "#d9ef8a", fontWeight: 800 }}>Members&rsquo; link{copied ? " (copied)" : " (select to copy)"}:</span>
          <a href={memberLink} target="_blank" rel="noreferrer" style={{ color: "#d9ef8a", wordBreak: "break-all", flex: 1, minWidth: 200 }}>{memberLink}</a>
          <span style={{ color: C.mut }}>Open court time only - no names. Send it to open-gym families.</span>
          <button onClick={() => setMemberLink("")} aria-label="Hide" style={{ background: "none", border: "none", color: C.mut, cursor: "pointer", fontSize: 14 }}>✕</button>
        </div>
      )}
      {rentImp?.pending && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 12px", marginBottom: 10, borderRadius: 10, fontSize: 12, lineHeight: 1.5, border: "1px solid #f97316", background: "rgba(249,115,22,0.08)", color: "#fdba74" }}>
          <div style={{ flex: "1 1 260px" }}><b>{rentImp.name}</b>: {rentImp.first ? <>rentals {fmtMD(rentImp.first)} – {fmtMD(rentImp.last)}.</> : "no rentals in it."} Which dates did you export from Playbook? HQ's rentals in that range are replaced by this file.</div>
          <input type="date" value={rentImp.from} max={rentImp.first || undefined} onChange={e => e.target.value && setRentImp({ ...rentImp, from: e.target.value })} style={{ background: C.bg, color: C.text, border: "1px solid " + C.border, borderRadius: 8, padding: "5px 7px", fontFamily: "inherit", fontSize: 12, colorScheme: "dark" }} />
          <span>to</span>
          <input type="date" value={rentImp.to} min={rentImp.last || undefined} onChange={e => e.target.value && setRentImp({ ...rentImp, to: e.target.value })} style={{ background: C.bg, color: C.text, border: "1px solid " + C.border, borderRadius: 8, padding: "5px 7px", fontFamily: "inherit", fontSize: 12, colorScheme: "dark" }} />
          <button onClick={uploadRentals} style={{ ...btn(true), borderRadius: 8 }}>Upload</button>
          <button onClick={() => setRentImp(null)} style={{ ...btn(false), border: "1px solid " + C.border, borderRadius: 8 }}>Cancel</button>
        </div>
      )}
      {rentImp && !rentImp.loading && !rentImp.pending && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 10px", marginBottom: 10, borderRadius: 10, fontSize: 12, lineHeight: 1.5, border: "1px solid " + (rentImp.error ? "#ef4444" : "#f97316"), background: rentImp.error ? "rgba(239,68,68,0.08)" : "rgba(249,115,22,0.08)", color: rentImp.error ? "#fca5a5" : "#fdba74" }}>
          <div style={{ flex: 1 }}>
            {rentImp.error ? <>Rentals upload failed: {rentImp.error}</> : <>
              <b>Rentals loaded</b> for {fmtMD(rentImp.window.from)} – {fmtMD(rentImp.window.to)}: {rentImp.added} rented session{rentImp.added === 1 ? "" : "s"}{rentImp.replaced ? ` (replacing ${rentImp.replaced} from the last upload for those dates)` : ""}.
              {rentImp.unplaced?.length > 0 && <div>No court in Playbook, so not drawn: {rentImp.unplaced.map(u => u.date.slice(5) + " " + u.time + " " + u.label).join(" · ")}</div>}
              {rentImp.bad?.length > 0 && <div>Couldn't read {rentImp.bad.length} row{rentImp.bad.length === 1 ? "" : "s"}.</div>}
            </>}
          </div>
          <button onClick={() => setRentImp(null)} aria-label="Hide" style={{ background: "none", border: "none", color: C.mut, cursor: "pointer", fontSize: 14 }}>✕</button>
        </div>
      )}
      {data && !data.error && !pub && (() => {
        // Days this week (today on) that no upload covers: their rentals don't show.
        const wins = data.rentals?.windows || [], today = iso(new Date());
        const gaps = dates.filter(d => d >= today && !wins.some(w => d >= w.from && d <= w.to));
        if (!gaps.length) return null;
        const span = gaps.length === 1 ? fmtMD(gaps[0]) : fmtMD(gaps[0]) + " – " + fmtMD(gaps[gaps.length - 1]);
        return <div style={{ fontSize: 12, color: "#fdba74", marginBottom: 8, lineHeight: 1.5 }}>{data.rentals?.at ? `Rental times aren't loaded for ${span}.` : "No rentals uploaded yet, so rental times don't show."} Export those dates from Playbook's Events list (events.csv) and tap ⬆ Rentals.</div>;
      })()}
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>{mode === "day" ? fmtDay(date, true) : "Week of " + fmtDay(wk, true)}</div>
      {legend}
      {data?.error ? <div style={{ padding: 16, color: "#ef4444", fontSize: 13 }}>{data.error} <button onClick={() => setReload(r => r + 1)} style={{ marginLeft: 8, ...btn(false), border: "1px solid #ef4444", borderRadius: 8, color: "#ef4444" }}>Retry</button></div>
        : !data ? <div style={{ padding: 24, color: C.mut, textAlign: "center", fontSize: 13 }}>Pulling this week from Playbook (about 10 seconds)…</div>
        : mode === "day" ? dayView() : weekView()}
      {data && !data.error && pub && <div style={{ fontSize: 11, color: C.mut, marginTop: 10 }}>Client view: open court time only. Booked time doesn't say who has the court.</div>}
      {data && !data.error && !pub && (
        <div style={{ fontSize: 11, color: C.mut, marginTop: 10, lineHeight: 1.6 }}>
          From Playbook's public calendar{data.at ? " (pulled " + data.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + ")" : ""} plus DS Elite's practice schedule. Rentals (orange, with times) come from Playbook's Events export{data.rentals?.at ? ", last uploaded " + new Date(data.rentals.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}; a reservation booked after the export (or on a day no upload covers) shows as "time?". DS Elite's courts are the ones it has booked in Playbook, and HQ's practice schedule says which team is on each (on a Sunday with nothing booked, the whole Warehouse, 1–9pm). Sign-up counts are the Clinics & Camps board's (Playbook registrations{data.rosterAt ? ", pulled " + new Date(data.rosterAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : ""}); basketball and other programs not on the board have no count. Reach Performance isn't on a court{data.offCourt ? ` (${data.offCourt} sessions this week left off)` : ""}. DS Elite practices without a court number are placed on a free court (dashed). Showing {fmtHour(START_H)}–{fmtHour(END_H)}.
        </div>
      )}
    </div>
  );
}
