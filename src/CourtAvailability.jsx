// Court availability (Drew, Oct 12 2026): every court, hour by hour - what's
// booked in Playbook (DSSC programs and holds), where DS Elite is practicing,
// and the open time. Playbook comes from /api/court-availability (the public
// calendar, resolved to courts); DS Elite from the same day-schedule builder
// the Day Schedule uses, plus scrimmages and the in-house tournament.
// `loaders` can be swapped (the dev harness uses sample data).
import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import { loadDseCourtInputs } from "../shared/court-inputs.js";
import { COURTS, buildCourtDay, fmtHour, sundayBlock } from "../shared/courts.js";

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
  // The no-login link for open-gym members (only open vs booked time).
  link: async () => {
    const { data: { session } = {} } = await supabase.auth.getSession();
    const r = await fetch("/api/court-availability?link=1", { headers: { Authorization: "Bearer " + (session?.access_token || "") } });
    const o = await r.json().catch(() => ({}));
    if (!r.ok || !o.url) throw new Error(o.error || "Couldn't get the link");
    return o.url;
  },
};

export default function CourtAvailability({ loaders = liveLoaders }) {
  const [date, setDate] = useState(iso(new Date()));
  const [mode, setMode] = useState("day");
  const [showHolds, setShowHolds] = useState(true);
  // Client view (Drew, Oct 12): what members would see - only open vs booked,
  // no program, renter or team names, rentals always counted as booked.
  const [pub, setPub] = useState(false);
  const [memberLink, setMemberLink] = useState("");
  const [copied, setCopied] = useState(false);   // shown once fetched, also copied
  const [cache, setCache] = useState({});      // weekStart -> { bookings, dse, offCourt, at } | { error }
  const [busy, setBusy] = useState(null);       // week being pulled
  const [reload, setReload] = useState(0);
  const wk = weekStart(date);
  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(wk, i)), [wk]);

  useEffect(() => {
    if (cache[wk] && !reload) return;
    let live = true; const mine = wk; setBusy(mine);
    Promise.all([loaders.bookings(wk, 7), loaders.dse(dates)])
      .then(([b, dse]) => { if (live) setCache(c => ({ ...c, [wk]: { bookings: b.bookings || [], reservations: b.reservations || [], offCourt: b.offCourt || 0, rosterAt: b.rosterAt || null, dse, at: new Date() } })); })
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
      .map(b => ({ courts: b.courts, start: b.start, end: b.end, kind: isEmpty(b) ? "empty" : b.kind, label: b.label, detail: (b.signups != null ? b.signups + " signed up" + (b.category ? " · " : "") : "") + (b.category || "") }))
      .concat(dse.tourn || []);
    return { ...buildCourtDay({ bookings, teams: dse.teams, scrims: dse.scrims, reserved: sundayBlock(d, data.reservations || []), startHour: START_H, endHour: END_H }), cancelled: dse.cancelled, phase: dse.phase };
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
    return (data.reservations || []).filter(r => r.date === d && !(sun && r.internal));
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
              <tr>{COURTS.map((c, i) => <th key={c.id} style={{ ...th, top: 27, borderLeft: i === 4 ? "2px solid " + C.border : undefined }}>{c.label}</th>)}</tr>
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
                      <td key={c.id} rowSpan={n} title={pub ? (cell ? "Booked" : "Open") : cell ? cell.label + (cell.detail ? " · " + cell.detail : "") + (also.length ? " · also: " + also.join(", ") : "") : "Free"}
                        style={{ padding: 2, borderLeft: ci === 4 ? "2px solid " + C.border : "1px solid #1a1a1a", verticalAlign: "top" }}>
                        <div style={cell && pub
                          ? { height: "100%", minHeight: n * 22 - 4, borderRadius: 6, background: "#1c1c1c", border: "1px solid #3a3a3a", color: "#8a8a8a", padding: "3px 5px", fontSize: 11, fontWeight: 700 }
                          : cell
                          ? { height: "100%", minHeight: n * 22 - 4, borderRadius: 6, background: k.bg, border: (cell.auto || k.dash ? "1px dashed " : "1px solid ") + (conflict ? "#ef4444" : k.bd), color: k.fg, padding: "3px 5px", fontSize: 11, fontWeight: 700, lineHeight: 1.25, overflow: "hidden" }
                          : { height: "100%", minHeight: n * 22 - 4, borderRadius: 6, background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.25)", color: "#4ade80", padding: "3px 5px", fontSize: 10, fontWeight: 700 }}>
                          {cell && pub ? "Booked" : cell ? <>{conflict ? "⚠ " : ""}{cell.kind === "empty" && n < 2 ? "0 · " : ""}{cell.label}{n >= 2 && cell.detail ? <div style={{ fontWeight: 500, opacity: 0.8 }}>{cell.detail}</div> : null}</> : (n >= 2 ? (pub ? "Open " : "Free ") + short(h) + "–" + short(g.slots[si + n - 1] + 0.5) : "")}
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
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>{mode === "day" ? fmtDay(date, true) : "Week of " + fmtDay(wk, true)}</div>
      {legend}
      {data?.error ? <div style={{ padding: 16, color: "#ef4444", fontSize: 13 }}>{data.error} <button onClick={() => setReload(r => r + 1)} style={{ marginLeft: 8, ...btn(false), border: "1px solid #ef4444", borderRadius: 8, color: "#ef4444" }}>Retry</button></div>
        : !data ? <div style={{ padding: 24, color: C.mut, textAlign: "center", fontSize: 13 }}>Pulling this week from Playbook (about 10 seconds)…</div>
        : mode === "day" ? dayView() : weekView()}
      {data && !data.error && pub && <div style={{ fontSize: 11, color: C.mut, marginTop: 10 }}>Client view: open court time only. Booked time doesn't say who has the court.</div>}
      {data && !data.error && !pub && (
        <div style={{ fontSize: 11, color: C.mut, marginTop: 10, lineHeight: 1.6 }}>
          From Playbook's public calendar{data.at ? " (pulled " + data.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + ")" : ""} plus DS Elite's practice schedule. Court rentals booked as Playbook reservations (outside renters) aren't on the public calendar, so they don't show. DS Elite's Sunday block (the whole Warehouse, 1–9pm) is always shown as taken. Sign-up counts are the Clinics & Camps board's (Playbook registrations{data.rosterAt ? ", pulled " + new Date(data.rosterAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : ""}); basketball and other programs not on the board have no count. Reach Performance isn't on a court{data.offCourt ? ` (${data.offCourt} sessions this week left off)` : ""}. DS Elite practices without a court number are placed on a free court (dashed). Showing {fmtHour(START_H)}–{fmtHour(END_H)}.
        </div>
      )}
    </div>
  );
}
