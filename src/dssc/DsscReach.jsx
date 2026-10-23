// DSSC → Reach Stats (Drew, Oct 23 2026: "a system on the DSSC HQ that allows
// Coach Brandon Butler to add new players to the Reach Performance stats and
// add their stats on certain dates ... it all pulls into the public Reach stat
// page"). Three tabs:
//   Test day  a date, a group (Reach athletes or a DS Elite team), a box per
//             test per athlete - prefilled with that day's numbers, last result
//             as the hint - one Save; numbers that look like typos come back
//             to check (the shared statFlags).
//   Athletes  Reach athletes who aren't DS Elite players: add, edit, show on
//             the public board or not, every result with a delete.
//   Tests     the built-in tests (stand & reach, approach and standing touch,
//             broad jump, 10-yard, sprint mph) and the ones added here.
// Server: api/reach-stats.js. Everything lands on www.drippingsportsclub.com/reach
// (api/leaderboard.js); DS Elite results also reach her player card and reports.

import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Tag, inputStyle } from "./DsscHub.jsx";
import { statResultRows, fmtMetric, setCustomMetrics, parseMetric } from "../../shared/stat-report.js";

const BOARD_URL = "https://www.drippingsportsclub.com/reach";
const DEFAULT_COLS = ["stand_reach", "approach_touch", "standing_touch", "broad_jump", "dash_10y", "sprint_mph"];
const COLS_KEY = "dssc.reach.cols";
const UNIT_HINT = { in: "in", sec: "sec", mph: "mph" };
const SHORT = { stand_reach: "Stand & reach", approach_touch: "Jump approach", standing_touch: "Standing jump", vertical: "Vertical", broad_jump: "Broad jump", dash_10y: "10-yard", sprint_mph: "Sprint speed" };
const UNITS = [["in", "inches"], ["sec", "seconds"], ["mph", "mph"], ["lb", "pounds"], ["reps", "reps"], ["%", "percent"], ["", "no unit"]];
const fmtDay = (iso) => iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
const asText = (v) => v == null || v === "" ? "" : String(Math.round(+v * 100) / 100);
const short = (k, label) => SHORT[k] || label;
const personKey = (p) => p.kind + ":" + p.id;

async function reachApi(action, payload = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch("/api/reach-stats", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify({ action, ...payload }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || `HTTP ${r.status}`), { data: d, status: r.status });
  return d;
}
function useNarrow() {
  const [n, setN] = useState(() => typeof window !== "undefined" && window.innerWidth < 720);
  useEffect(() => { const f = () => setN(window.innerWidth < 720); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return n;
}
const Panel = ({ children, style }) => <div style={{ background: DS.panel, border: "1px solid " + DS.line, borderRadius: 14, padding: 14, ...style }}>{children}</div>;
const H = ({ children, style }) => <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: DS.lime, marginBottom: 8, ...style }}>{children}</div>;
const Msg = ({ msg, style }) => !msg ? null : <div style={{ color: msg.err ? DS.orange : DS.lime, fontWeight: 700, fontSize: 13, whiteSpace: "pre-wrap", ...style }}>{msg.err || msg.ok}</div>;
const chip = (on, color = DS.lime) => ({ fontFamily: DS.font, fontSize: 12, fontWeight: 700, padding: "6px 11px", borderRadius: 999, cursor: "pointer", border: "1px solid " + (on ? color : DS.line), background: on ? "rgba(178,208,73,0.14)" : "transparent", color: on ? color : DS.mut, whiteSpace: "nowrap" });

export default function DsscReach() {
  const narrow = useNarrow();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("day");
  const [focus, setFocus] = useState(null);       // { group, q } handed to Test day from elsewhere
  const load = useCallback(async () => {
    try { const d = await reachApi("load"); setCustomMetrics(d.custom || []); setData(d); setErr(""); }
    catch (e) { setErr(/reach_athletes|stat_metrics|schema cache|does not exist/i.test(e.message) ? "The Reach tables aren't set up yet — run migrations/20261028_reach_stats.sql." : e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Everyone who can be tested, with their results: Reach athletes and DS Elite players.
  const people = useMemo(() => {
    if (!data) return [];
    const rBy = new Map(), dBy = new Map();
    for (const t of data.tests.reach) { if (!rBy.has(t.athlete_id)) rBy.set(t.athlete_id, []); rBy.get(t.athlete_id).push(t); }
    for (const t of data.tests.dse) { if (!dBy.has(t.player_id)) dBy.set(t.player_id, []); dBy.get(t.player_id).push(t); }
    return [
      ...data.athletes.map(a => ({ kind: "reach", id: a.id, first: a.first_name, last: a.last_name || "", group: "reach", team: "Reach", sub: [a.sport, a.team].filter(Boolean).join(" · "), athlete: a, active: a.active !== false,
        asPlayer: { id: "r" + a.id, first_name: a.first_name, last_name: a.last_name }, tests: rBy.get(a.id) || [] })),
      ...data.players.map(p => ({ kind: "dse", id: p.id, first: p.first_name, last: p.last_name || "", group: p.team_assignment || "DS Elite (no team)", team: p.team_assignment || "DS Elite", sub: p.team_assignment || "", active: true, asPlayer: p, tests: dBy.get(p.id) || [] })),
    ].map(x => ({ ...x, name: `${x.first} ${x.last}`.trim() })).sort((a, b) => a.last.localeCompare(b.last) || a.first.localeCompare(b.first));
  }, [data]);

  return (
    <div style={{ margin: "-14px -18px", padding: narrow ? "12px 12px 110px" : "16px 16px 90px", background: DS.bg, minHeight: "calc(100vh - 56px)", fontFamily: DS.font, color: DS.text, boxSizing: "border-box" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
          <div style={{ fontSize: 24, fontWeight: 800 }}>Reach Stats</div>
          <div style={{ flex: 1 }} />
          <a href={BOARD_URL} target="_blank" rel="noreferrer" style={{ color: DS.lime, fontSize: 13, fontWeight: 700, textDecoration: "none" }}>Public leaderboard ↗</a>
        </div>
        <div style={{ fontSize: 13, color: DS.mut, marginBottom: 12, lineHeight: 1.5 }}>Record Reach Performance testing for anyone you train — DS Elite players and Reach athletes. Every result shows on the public leaderboard (first name and last initial only) and on DS Elite players' cards and reports.</div>
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid " + DS.line, marginBottom: 14, overflowX: "auto" }}>
          {[["day", "Test day"], ["athletes", "Athletes"], ["tests", "Tests"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ fontFamily: DS.font, fontSize: narrow ? 15 : 14, fontWeight: 800, padding: "10px 14px", minHeight: 44, background: "none", border: "none", borderBottom: "3px solid " + (tab === k ? DS.lime : "transparent"), color: tab === k ? DS.text : DS.mut, cursor: "pointer", whiteSpace: "nowrap" }}>{l}</button>
          ))}
        </div>
        {err && <Msg msg={{ err }} style={{ marginBottom: 12 }} />}
        {!data ? (!err && <div style={{ color: DS.mut }}>Loading…</div>)
          : tab === "day" ? <TestDay data={data} people={people} narrow={narrow} reload={load} focus={focus} onFocused={() => setFocus(null)} onAddAthlete={() => setTab("athletes")} />
          : tab === "athletes" ? <Athletes data={data} people={people} narrow={narrow} reload={load} onEnter={(p) => { setFocus({ group: p.group, q: p.name }); setTab("day"); }} />
          : <Tests data={data} narrow={narrow} reload={load} />}
      </div>
    </div>
  );
}

// ── Test day ─────────────────────────────────────────────────────────────────
function TestDay({ data, people, narrow, reload, focus, onFocused, onAddAthlete }) {
  const [date, setDate] = useState(data.today);
  const [group, setGroup] = useState("reach");
  const [q, setQ] = useState("");
  const [cols, setCols] = useState(() => { try { const c = JSON.parse(localStorage.getItem(COLS_KEY) || "null"); if (Array.isArray(c) && c.length) return c; } catch { /* ignore */ } return DEFAULT_COLS; });
  const [vals, setVals] = useState({});          // { "reach:12": { key: "typed" } }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [flags, setFlags] = useState([]);
  const [bad, setBad] = useState(new Set());
  useEffect(() => { if (focus) { setGroup(focus.group); setQ(focus.q || ""); onFocused?.(); } }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const metrics = data.metrics.filter(m => m.key !== "vertical");
  const shown = metrics.filter(m => cols.includes(m.key));
  const setColsSaved = (c) => { setCols(c); try { localStorage.setItem(COLS_KEY, JSON.stringify(c)); } catch { /* ignore */ } };
  const groups = useMemo(() => {
    const teams = [...new Set(people.filter(p => p.kind === "dse").map(p => p.group))].sort((a, b) => (parseInt(a) || 99) - (parseInt(b) || 99) || a.localeCompare(b));
    return [["reach", "Reach athletes"], ...teams.map(t => [t, t]), ["all", "Everyone"]];
  }, [people]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return people.filter(p => p.active && (group === "all" || p.group === group) && (!s || p.name.toLowerCase().includes(s)));
  }, [people, group, q]);

  // That day's numbers (what the boxes start with) and the last result before it (the hint).
  const onDay = (p) => p.tests.find(t => String(t.test_date).slice(0, 10) === date) || null;
  const valueOf = (t, k) => t ? (t[k] ?? t.extra?.[k] ?? null) : null;
  const lastBefore = (p, k) => { const t = [...p.tests].filter(x => String(x.test_date).slice(0, 10) < date && valueOf(x, k) != null).pop(); return t ? valueOf(t, k) : null; };
  const startOf = (p, k) => asText(valueOf(onDay(p), k));
  const cur = (p, k) => vals[personKey(p)]?.[k] ?? startOf(p, k);
  const setV = (p, k, v) => setVals(x => ({ ...x, [personKey(p)]: { ...(x[personKey(p)] || {}), [k]: v } }));
  const changed = (p) => Object.entries(vals[personKey(p)] || {}).filter(([k, v]) => v !== startOf(p, k));
  const dirty = people.filter(p => changed(p).length);
  useEffect(() => { setVals({}); setFlags([]); setBad(new Set()); setMsg(null); }, [date]);

  const save = async () => {
    setBusy(true); setMsg(null); setFlags([]); setBad(new Set());
    try {
      const rows = dirty.map(p => ({ kind: p.kind, id: p.id, values: Object.fromEntries(changed(p)) }));
      const d = await reachApi("results_save", { date, rows });
      setVals({}); setFlags(d.flags || []);
      setMsg({ ok: `Saved ${d.saved} athlete${d.saved === 1 ? "" : "s"} for ${fmtDay(date)}${d.cleared ? ` (${d.cleared} cleared)` : ""}. ${d.flags?.length ? "Check the numbers below." : "It's on the public leaderboard now."}` });
      await reload();
    } catch (e) {
      if (e.data?.bad) setBad(new Set(e.data.bad.map(b => b.kind + ":" + b.id)));
      setMsg({ err: e.message });
    }
    setBusy(false);
  };

  const vert = (p) => {
    const ap = parseMetric("approach_touch", cur(p, "approach_touch")), srT = parseMetric("stand_reach", cur(p, "stand_reach"));   // 8'4" reads as 100
    const sr = Number.isFinite(srT) ? srT : (() => { const r = statResultRows(p.asPlayer, p.tests.filter(t => String(t.test_date).slice(0, 10) < date)); for (let i = r.length - 1; i >= 0; i--) if (r[i].stand_reach != null) return r[i].stand_reach; return null; })();
    return Number.isFinite(ap) && sr != null ? fmtMetric("vertical", ap - sr) : "—";
  };

  return (
    <div>
      <Panel style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: DS.mut }}>Test date
            <input type="date" value={date} max={data.today} onChange={e => e.target.value && setDate(e.target.value)} style={{ ...inputStyle, width: "auto", fontSize: narrow ? 16 : 14, colorScheme: "dark" }} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: DS.mut, flex: "1 1 180px" }}>Who
            <select value={group} onChange={e => setGroup(e.target.value)} style={{ ...inputStyle, fontSize: narrow ? 16 : 14, colorScheme: "dark" }}>{groups.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: DS.mut, flex: "1 1 180px" }}>Find
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Name" style={{ ...inputStyle, fontSize: narrow ? 16 : 14 }} /></label>
          {group === "reach" && <Btn kind="ghost" onClick={onAddAthlete} style={{ minHeight: 40 }}>+ New athlete</Btn>}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: DS.mut, fontWeight: 700 }}>Tests:</span>
          {metrics.map(m => { const on = cols.includes(m.key); return <button key={m.key} onClick={() => setColsSaved(on ? cols.filter(x => x !== m.key) : [...cols, m.key])} style={chip(on)}>{short(m.key, m.label)}</button>; })}
        </div>
        <div style={{ fontSize: 12, color: DS.dim, marginTop: 8 }}>Heights in inches (8'4" works). The grey number is the last result. Vertical is worked out from the approach and the latest stand &amp; reach. Clear a box to remove that number.</div>
      </Panel>

      {!list.length ? <Panel style={{ color: DS.mut, borderStyle: "dashed", textAlign: "center", padding: 24 }}>{group === "reach" && !q ? <>No Reach athletes yet. <button onClick={onAddAthlete} style={{ background: "none", border: 0, color: DS.lime, fontWeight: 800, cursor: "pointer", fontFamily: DS.font, fontSize: 14 }}>Add the first one →</button></> : "Nobody matches."}</Panel>
        : <div style={{ display: "grid", gap: 8 }}>
            {list.map(p => {
              const k = personKey(p), isBad = bad.has(k), had = onDay(p);
              return (
                <div key={k} style={{ background: DS.panel, border: "1px solid " + (isBad ? DS.orange : changed(p).length ? DS.lime : DS.line), borderRadius: 12, padding: "10px 12px" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 8 }}>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: DS.mut }}>{p.kind === "reach" ? ["Reach", p.sub].filter(Boolean).join(" · ") : p.team}</div>
                    {had && <Tag color={DS.lime}>has results this day</Tag>}
                    {p.kind === "reach" && p.athlete.public === false && <Tag color={DS.dim}>not public</Tag>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${narrow ? 128 : 120}px, 1fr))`, gap: 8 }}>
                    {shown.map(m => {
                      const last = lastBefore(p, m.key);
                      return (
                        <label key={m.key} style={{ display: "grid", gap: 3, fontSize: 11, color: DS.mut, fontWeight: 700 }}>
                          <span>{short(m.key, m.label)}</span>
                          <div style={{ position: "relative" }}>
                            <input inputMode="decimal" value={cur(p, m.key)} onChange={e => setV(p, m.key, e.target.value)} placeholder={last != null ? asText(last) : ""}
                              style={{ ...inputStyle, fontSize: narrow ? 16 : 14, paddingRight: 40, borderColor: cur(p, m.key) !== startOf(p, m.key) ? DS.lime : DS.line }} />
                            <span style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: DS.dim }}>{UNIT_HINT[m.unit] ?? m.unit}</span>
                          </div>
                          <span style={{ fontSize: 10, color: DS.dim, fontWeight: 600 }}>{last != null ? "last " + fmtMetric(m.key, last) : " "}</span>
                        </label>
                      );
                    })}
                    {(cols.includes("approach_touch") || cols.includes("stand_reach")) && <div style={{ display: "grid", gap: 3, fontSize: 11, color: DS.mut, fontWeight: 700 }}><span>Vertical (auto)</span><div style={{ ...inputStyle, fontSize: 14, fontWeight: 800, color: DS.lime, background: "transparent" }}>{vert(p)}</div></div>}
                  </div>
                </div>
              );
            })}
          </div>}

      {flags.length > 0 && <Panel style={{ marginTop: 12, borderColor: DS.orange }}>
        <H style={{ color: DS.orange }}>Check these numbers</H>
        {flags.map((f, i) => <div key={i} style={{ fontSize: 13, padding: "4px 0", color: f.level === "red" ? DS.orange : "#fbbf24" }}><b style={{ color: DS.text }}>{f.name}:</b> {f.reason}</div>)}
        <div style={{ fontSize: 12, color: DS.mut, marginTop: 6 }}>They're saved. Fix a number by typing over it and saving again. A number flagged red stays off the public board until it's fixed.</div>
      </Panel>}

      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 30, background: "rgba(6,26,24,0.96)", borderTop: "1px solid " + DS.line, padding: "10px 16px calc(10px + env(safe-area-inset-bottom, 0px))", display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end" }}>
        <Msg msg={msg} style={{ flex: 1, fontSize: 12 }} />
        {!msg && <span style={{ flex: 1, fontSize: 12, color: DS.mut }}>{dirty.length ? `${dirty.length} athlete${dirty.length === 1 ? "" : "s"} changed` : `Results for ${fmtDay(date)}`}</span>}
        <Btn kind="primary" disabled={busy || !dirty.length} onClick={save} style={{ minHeight: 44, padding: "10px 22px" }}>{busy ? "Saving…" : dirty.length ? `Save ${dirty.length}` : "Save"}</Btn>
      </div>
    </div>
  );
}

// ── Athletes ─────────────────────────────────────────────────────────────────
const EMPTY = { first_name: "", last_name: "", gender: "", dob: "", grad_year: "", sport: "", team: "", parent_name: "", parent_email: "", parent_phone: "", notes: "", public: true, active: true };
function Athletes({ data, people, narrow, reload, onEnter }) {
  const [q, setQ] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [form, setForm] = useState(null);        // athlete being added / edited
  const [openId, setOpenId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [match, setMatch] = useState(null);
  const reach = people.filter(p => p.kind === "reach" && (showOld || p.active) && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())));
  const save = async (force = false) => {
    setBusy(true); setMsg(null); setMatch(null);
    try {
      const d = await reachApi("athlete_save", { athlete: form, force });
      setMsg({ ok: form.id ? "Saved." : `${d.athlete.first_name} added. Enter their numbers on Test day.` });
      setForm(null); setOpenId(d.athlete.id); await reload();
    } catch (e) { setMsg({ err: e.message }); if (e.status === 409) setMatch(e.data?.match || null); }
    setBusy(false);
  };
  const del = async (kind, id) => { if (!window.confirm("Delete this day's results?")) return; try { await reachApi("result_delete", { kind, id }); await reload(); } catch (e) { setMsg({ err: e.message }); } };
  const F = (k, label, props = {}) => (
    <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: DS.mut, ...(props.wide ? { gridColumn: "1 / -1" } : {}) }}>{label}
      <input value={form[k] ?? ""} onChange={e => setForm({ ...form, [k]: e.target.value })} type={props.type || "text"} placeholder={props.ph || ""} style={{ ...inputStyle, fontSize: narrow ? 16 : 14, colorScheme: "dark" }} /></label>
  );
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find an athlete" style={{ ...inputStyle, flex: "1 1 220px", fontSize: narrow ? 16 : 14 }} />
        <label style={{ fontSize: 13, color: DS.mut, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={showOld} onChange={e => setShowOld(e.target.checked)} style={{ accentColor: DS.lime }} /> Show archived</label>
        <Btn kind="primary" onClick={() => { setForm({ ...EMPTY }); setMsg(null); setMatch(null); }} style={{ minHeight: 40 }}>+ Add athlete</Btn>
      </div>
      <Msg msg={msg} style={{ marginBottom: 8 }} />
      {match?.kind === "dse" && <div style={{ marginBottom: 10 }}><Btn small kind="ghost" onClick={() => { const p = people.find(x => x.kind === "dse" && x.id === match.id); if (p) onEnter(p); }}>Enter her results under DS Elite →</Btn></div>}
      {match?.kind === "reach" && <div style={{ marginBottom: 10, display: "flex", gap: 8 }}><Btn small kind="ghost" onClick={() => { setForm(null); setOpenId(match.id); setMatch(null); setMsg(null); }}>Open that athlete</Btn><Btn small kind="quiet" onClick={() => save(true)}>It's a different person — add anyway</Btn></div>}

      {form && <Panel style={{ marginBottom: 12, borderColor: DS.lime }}>
        <H>{form.id ? "Edit athlete" : "New Reach athlete"}</H>
        <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr", gap: 10 }}>
          {F("first_name", "First name")}{F("last_name", "Last name")}
          <div style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: DS.mut }}>Boy or girl
            <div style={{ display: "flex", gap: 6 }}>{[["F", "Girl"], ["M", "Boy"]].map(([v, l]) => <button key={v} onClick={() => setForm({ ...form, gender: form.gender === v ? "" : v })} style={chip(form.gender === v)}>{l}</button>)}</div></div>
          {F("dob", "Birth date", { type: "date" })}
          {F("grad_year", "Grad year", { ph: "2031" })}{F("sport", "Main sport", { ph: "Football, soccer, volleyball…" })}
          {F("team", "School or club team")}{F("parent_name", "Parent name")}
          {F("parent_email", "Parent email", { type: "email" })}{F("parent_phone", "Parent phone", { type: "tel" })}
          {F("notes", "Notes", { wide: true })}
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginTop: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={form.public !== false} onChange={e => setForm({ ...form, public: e.target.checked })} style={{ width: 18, height: 18, accentColor: DS.lime }} />
          Show on the public leaderboard (first name and last initial only)</label>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <Btn kind="primary" disabled={busy || !String(form.first_name || "").trim()} onClick={() => save(false)} style={{ minHeight: 40 }}>{busy ? "Saving…" : form.id ? "Save" : "Add athlete"}</Btn>
          <Btn kind="quiet" onClick={() => { setForm(null); setMatch(null); }} style={{ minHeight: 40 }}>Cancel</Btn>
          {form.id && <Btn kind="quiet" onClick={() => { setForm({ ...form, active: !form.active }); }} style={{ minHeight: 40, marginLeft: "auto" }}>{form.active ? "Archive" : "Bring back"}</Btn>}
        </div>
        {form.id && form.active === false && <div style={{ fontSize: 12, color: DS.mut, marginTop: 6 }}>Archived athletes drop off Test day and the leaderboard; their results stay on file.</div>}
      </Panel>}

      {!reach.length ? <Panel style={{ color: DS.mut, borderStyle: "dashed", textAlign: "center", padding: 24 }}>{q ? "Nobody matches." : "No Reach athletes yet — add the first one. DS Elite players are already here: pick their team on Test day."}</Panel>
        : <div style={{ display: "grid", gap: 8 }}>{reach.map(p => {
            const open = openId === p.id, rows = statResultRows(p.asPlayer, p.tests).filter(r => !r.tryout);
            const cols = data.metrics.filter(m => rows.some(r => r[m.key] != null));
            return (
              <Panel key={p.id} style={{ padding: 0, opacity: p.active ? 1 : 0.6 }}>
                <button onClick={() => setOpenId(open ? null : p.id)} style={{ width: "100%", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: "none", border: 0, padding: "12px 14px", cursor: "pointer", color: DS.text, fontFamily: DS.font, textAlign: "left" }}>
                  <span style={{ fontWeight: 800, fontSize: 15 }}>{p.name}</span>
                  <span style={{ fontSize: 12, color: DS.mut }}>{p.sub}</span>
                  <span style={{ flex: 1 }} />
                  {p.athlete.public === false && <Tag color={DS.dim}>not public</Tag>}
                  {!p.active && <Tag color={DS.dim}>archived</Tag>}
                  <span style={{ fontSize: 12, color: DS.mut }}>{rows.length ? `${rows.length} test day${rows.length === 1 ? "" : "s"} · last ${fmtDay(rows[rows.length - 1].date)}` : "not tested yet"}</span>
                </button>
                {open && <div style={{ padding: "0 14px 14px" }}>
                  {rows.length ? <div style={{ overflowX: "auto", border: "1px solid " + DS.line, borderRadius: 10 }}>
                    <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520 }}>
                      <thead><tr>{["Date", ...cols.map(m => short(m.key, m.label)), ""].map((h, i) => <th key={i} style={{ textAlign: "left", fontSize: 10, color: DS.mut, textTransform: "uppercase", padding: "8px 10px", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
                      <tbody>{rows.slice().reverse().map(r => { const t = p.tests.find(x => "test:" + x.id === r.row); return (
                        <tr key={r.row}><td style={{ padding: "8px 10px", borderTop: "1px solid " + DS.line, fontWeight: 700, whiteSpace: "nowrap" }}>{fmtDay(r.date)}</td>
                          {cols.map(m => <td key={m.key} style={{ padding: "8px 10px", borderTop: "1px solid " + DS.line, whiteSpace: "nowrap" }}>{r[m.key] == null ? "—" : fmtMetric(m.key, r[m.key])}</td>)}
                          <td style={{ padding: "8px 10px", borderTop: "1px solid " + DS.line, textAlign: "right" }}>{t && <button onClick={() => del("reach", t.id)} title="Delete this day's results" style={{ background: "none", border: 0, color: DS.dim, cursor: "pointer", fontSize: 13 }}>✕</button>}</td></tr>); })}</tbody>
                    </table></div> : <div style={{ fontSize: 13, color: DS.mut }}>No results yet.</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <Btn small kind="primary" onClick={() => onEnter(p)}>Enter results</Btn>
                    <Btn small kind="ghost" onClick={() => { const a = p.athlete; setForm({ ...EMPTY, ...Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v ?? ""])), grad_year: a.grad_year ?? "", public: a.public !== false, active: a.active !== false }); setMsg(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit details</Btn>
                  </div>
                  {(p.athlete.parent_name || p.athlete.parent_email || p.athlete.parent_phone) && <div style={{ fontSize: 12, color: DS.mut, marginTop: 8 }}>Parent: {[p.athlete.parent_name, p.athlete.parent_email, p.athlete.parent_phone].filter(Boolean).join(" · ")}</div>}
                  {p.athlete.notes && <div style={{ fontSize: 12, color: DS.mut, marginTop: 4 }}>{p.athlete.notes}</div>}
                </div>}
              </Panel>
            );
          })}</div>}
    </div>
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────
function Tests({ data, narrow, reload }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const built = data.metrics.filter(m => m.built_in);
  const save = async (m) => {
    setBusy(true); setMsg(null);
    try { await reachApi("metric_save", { metric: m }); setForm(null); setMsg({ ok: "Saved — it's a box on Test day now." }); await reload(); }
    catch (e) { setMsg({ err: e.message }); }
    setBusy(false);
  };
  const dir = (up, unit) => up ? "higher is better" : unit === "sec" ? "lower (faster) is better" : "lower is better";
  return (
    <div>
      <Panel style={{ marginBottom: 12 }}>
        <H>Built-in tests</H>
        <div style={{ display: "grid", gap: 6 }}>{built.map(m => (
          <div key={m.key} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", fontSize: 14 }}>
            <b>{short(m.key, m.label)}</b><span style={{ fontSize: 12, color: DS.mut }}>{UNITS.find(u => u[0] === m.unit)?.[1] || m.unit} · {dir(m.up, m.unit)}{m.key === "vertical" ? " · worked out: approach − stand & reach" : m.key === "sprint_mph" ? " · top speed on a radar or laser" : ""}</span>
          </div>))}</div>
      </Panel>
      <Panel>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <H style={{ margin: 0, flex: 1 }}>Tests you've added</H>
          <Btn small kind="primary" onClick={() => { setForm({ label: "", unit: "sec", higher_better: false, on_board: true, active: true }); setMsg(null); }}>+ Add a test</Btn>
        </div>
        <Msg msg={msg} style={{ marginBottom: 8 }} />
        {form && <div style={{ background: DS.panel2, borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "2fr 1fr", gap: 10 }}>
            <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: DS.mut }}>Name<input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="e.g. Pro agility, 40-yard, Trap bar deadlift" style={{ ...inputStyle, fontSize: narrow ? 16 : 14 }} /></label>
            <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: DS.mut }}>Measured in<select value={form.unit} onChange={e => { const u = e.target.value; setForm({ ...form, unit: u, higher_better: u === "sec" ? false : form.higher_better }); }} style={{ ...inputStyle, fontSize: narrow ? 16 : 14, colorScheme: "dark" }}>{UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            <button onClick={() => setForm({ ...form, higher_better: true })} style={chip(form.higher_better)}>Higher is better</button>
            <button onClick={() => setForm({ ...form, higher_better: false })} style={chip(!form.higher_better)}>Lower is better</button>
            <button onClick={() => setForm({ ...form, on_board: !form.on_board })} style={chip(form.on_board)}>{form.on_board ? "✓ " : ""}On the public leaderboard</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <Btn kind="primary" disabled={busy || !form.label.trim()} onClick={() => save(form)}>{busy ? "Saving…" : form.key ? "Save" : "Add test"}</Btn>
            <Btn kind="quiet" onClick={() => setForm(null)}>Cancel</Btn>
          </div>
        </div>}
        {!data.custom.length ? <div style={{ fontSize: 13, color: DS.mut }}>None yet. Add one and it becomes a box on Test day, a column on DS Elite player cards and the club stats board, and — if you want — a leaderboard on the public page.</div>
          : data.custom.map(m => (
            <div key={m.key} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid " + DS.line, opacity: m.active === false ? 0.55 : 1 }}>
              <b style={{ fontSize: 14 }}>{m.label}</b>
              <span style={{ fontSize: 12, color: DS.mut, flex: 1 }}>{UNITS.find(u => u[0] === m.unit)?.[1] || m.unit || "no unit"} · {dir(m.higher_better, m.unit)}{m.on_board ? " · on the leaderboard" : ""}</span>
              <Btn small kind="quiet" onClick={() => setForm({ ...m })}>Edit</Btn>
              <Btn small kind="quiet" onClick={() => save({ ...m, active: m.active === false })}>{m.active === false ? "Turn on" : "Turn off"}</Btn>
            </div>))}
      </Panel>
    </div>
  );
}
