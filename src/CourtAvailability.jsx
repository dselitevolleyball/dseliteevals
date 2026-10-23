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
import { COURTS, buildCourtDay, fmtHour, dseBlock } from "../shared/courts.js";

const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", grn: "#22c55e" };
const KIND = {
  dssc: { bg: "rgba(178,208,73,0.20)", bd: "#B2D049", fg: "#d9ef8a", name: "DSSC program" },
  empty: { bg: "rgba(56,189,248,0.10)", bd: "#38bdf8", fg: "#7dd3fc", name: "DSSC class, 0 signed up", dash: true },
  hold: { bg: "rgba(249,115,22,0.20)", bd: "#f97316", fg: "#fdba74", name: "Hold / rental" },
  dse: { bg: "rgba(233,30,140,0.20)", bd: "#e91e8c", fg: "#f9a8d4", name: "DS Elite" },
  tourn: { bg: "rgba(245,158,11,0.22)", bd: "#f59e0b", fg: "#fcd34d", name: "In-House Tournament" },
};
const START_H = 7, END_H = 22;
const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const addDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };
const weekStart = (ymd) => { const d = new Date(ymd + "T12:00:00"); d.setDate(d.getDate() - d.getDay()); return iso(d); }; // Sunday
const fmtDay = (ymd, long) => new Date(ymd + "T12:00:00").toLocaleDateString(undefined, long ? { weekday: "long", month: "long", day: "numeric" } : { weekday: "short", month: "short", day: "numeric" });
const fmtMD = (ymd) => new Date(ymd + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
const short = (h) => fmtHour(h).replace(":00", "").replace("am", "a").replace("pm", "p");
const windows = (w) => w.filter(([s, e]) => e - s >= 0.5).map(([s, e]) => short(s) + "–" + short(e));

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
      .then(([b, dse]) => { if (live) setCache(c => ({ ...c, [wk]: { bookings: b.bookings || [], reservations: b.reservations || [], offCourt: b.offCourt || 0, rosterAt: b.rosterAt || null, rentals: b.rentals || null, dse, at: new Date() } })); })
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
    const bookings = data.bookings.filter(b => b.date === d && (pub || showHolds || b.kind !== "hold") && !(dropEmpty && isEmpty(b)))
      .map(b => ({ courts: b.courts, start: b.start, end: b.end, kind: isEmpty(b) ? "empty" : b.kind, label: b.label, detail: (b.signups != null ? b.signups + " signed up this date" + (b.category ? " · " : "") : "") + (b.category || ""), ref: b.clinicId ? { cid: b.clinicId, sid: b.sessionId } : null }))
      .concat(dse.tourn || []);
    return { ...buildCourtDay({ bookings, teams: dse.teams, scrims: dse.scrims, reserved: dseBlock(d, data.reservations || []), startHour: START_H, endHour: END_H }), cancelled: dse.cancelled, phase: dse.phase };
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
        <div style={{ overflowX: "auto", border: "1px solid " + C.border, borderRadius: 10 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 620, tableLayout: "fixed" }}>
            <thead>
              <tr><th style={{ ...th, width: 58 }} rowSpan={2}>Time</th><th style={th} colSpan={4}>Warehouse</th><th style={{ ...th, borderLeft: "2px solid " + C.border }} colSpan={2}>Flex</th></tr>
              <tr>{COURTS.map((c, i) => <th key={c.id} style={{ ...th, top: 27, borderLeft: i === 4 ? "2px solid " + C.border : undefined }}>{c.label}
                {resOn[c.id].map((r, j) => <div key={j} title="Playbook reservation - the time isn't on the calendar" style={{ marginTop: 3, padding: "2px 4px", borderRadius: 5, background: KIND.hold.bg, border: "1px dashed " + KIND.hold.bd, color: KIND.hold.fg, fontSize: 10, fontWeight: 700, lineHeight: 1.25 }}>{pub ? "Reserved" : r.who} · time?</div>)}
              </th>)}</tr>
            </thead>
            <tbody>
              {g.slots.map((h, si) => (
                <tr key={h}>
                  <td style={{ fontSize: 10, color: C.mut, padding: "0 6px", borderTop: Number.isInteger(h) ? "1px solid " + C.border : "1px dotted #1f1f1f", height: 22, verticalAlign: "top", whiteSpace: "nowrap" }}>{Number.isInteger(h) ? fmtHour(h) : ""}</td>
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
                          ? { height: "100%", minHeight: n * 22 - 4, borderRadius: 6, background: "#1c1c1c", border: "1px solid #3a3a3a", color: "#8a8a8a", padding: "3px 5px", fontSize: 11, fontWeight: 700 }
                          : cell
                          ? { height: "100%", minHeight: n * 22 - 4, borderRadius: 6, background: k.bg, border: (cell.auto || k.dash ? "1px dashed " : "1px solid ") + (conflict ? "#ef4444" : k.bd), color: k.fg, cursor: cell.ref && onOpenClass ? "pointer" : undefined, padding: "3px 5px", fontSize: 11, fontWeight: 700, lineHeight: 1.25, overflow: "hidden" }
                          : { height: "100%", minHeight: n * 22 - 4, borderRadius: 6, background: "rgba(34,197,94,0.07)", border: resOn[c.id].length ? "1px dashed " + KIND.hold.bd : "1px solid rgba(34,197,94,0.25)", color: "#4ade80", padding: "3px 5px", fontSize: 10, fontWeight: 700 }}>
                          {cell && pub ? "Booked" : cell ? <>{conflict ? "⚠ " : ""}{cell.kind === "empty" && n < 2 ? "0 · " : ""}{cell.label}{n >= 2 && cell.detail ? <div style={{ fontWeight: 500, opacity: 0.8 }}>{cell.detail}</div> : null}</> : (n >= 2 ? (pub ? "Open " : "Free ") + short(h) + "–" + short(g.slots[si + n - 1] + 0.5) : "")}{!cell && n >= 2 && resOn[c.id].length ? <div style={{ color: KIND.hold.fg, fontWeight: 600 }}>? reserved sometime today</div> : null}
                        </div>
                      </td>);
                  })}
                </tr>
              ))}
            </tbody>
          </table>
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
          </tbody>
        </table>
      </div>
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
