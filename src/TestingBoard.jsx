// Testing Stats Board — every current player's physical testing numbers in
// one club-wide table (Drew, Oct 12 2026: "a club wide stats board for all of
// the physical testing — filter by age, team, level, position, etc.").
//
// One row per 2026-27 rostered player: her latest number for each metric (her
// baseline if she hasn't been retested), with the change since baseline.
// Filters: age (the team's age group), team, level (practice_teams.level:
// National / Regional / Rise), position (roster positions), name, retested only.
// Views: Current, Improvement (change since baseline) and Baseline. Click a
// column to rank by it; leaders + averages follow the filters; "By team"
// compares team averages. Numbers come from shared/stat-report.js, the same
// builder as the family emails, so the board and the emails always agree.
//
// Likely typos (statFlags, minus the ones staff accepted in Testing Reports)
// are marked ⚑ and left out of ranks, leaders and averages unless "Include
// flagged" is on — one bad 30" vertical shouldn't top the club board.
//
// Chart (Drew, Oct 12 2026: "grouped by team averages ... chart them on a
// graph where we can select the y and x axis"): opens on the team averages,
// and a scatter of any two tests - one big dot per team average, optional
// small dots per player in her team's color - over whatever is filtered, in
// the current view, with the same ⚑ rule as the averages.

import { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabase";
import StatReports from "./StatReports.jsx";
import { METRICS, BUILT_IN_METRICS, metricRows, fmtMetric, fmtChange, allStatFlags, reviewFlags, flaggedReportKeys, gainMin } from "../shared/stat-report.js";
import { loadStatMetrics } from "./statMetrics.js";
import DsscReach from "./dssc/DsscReach.jsx";

const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", red: "#ef4444", grn: "#22c55e", amb: "#f59e0b" };
const inp = { background: "#0f0f0f", border: "1px solid " + C.border, borderRadius: 8, color: C.text, fontFamily: "inherit", fontSize: 13, padding: "7px 9px", boxSizing: "border-box" };
const lbl = { fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: C.mut, marginBottom: 4, display: "block" };
const TERMINAL = ["declined", "not_invited", "opted_out"];
// Board order: the jump numbers first, the sprints, reach last (it's size, not
// training), then the tests added in HQ (Reach Stats -> Tests). syncKeys()
// re-reads METRICS once those have loaded (loadStatMetrics), before any render
// that shows numbers.
const BASE_KEYS = ["approach_touch", "vertical", "standing_touch", "broad_jump", "dash_10y", "sprint_mph", "stand_reach"];
let KEYS = BASE_KEYS, META = {}, SHORT = {};
const BASE_SHORT = { approach_touch: "Approach touch", vertical: "Vertical", standing_touch: "Standing touch", broad_jump: "Broad jump", dash_10y: "10-yd sprint", sprint_mph: "Sprint mph", stand_reach: "Reach" };
function syncKeys() {
  META = Object.fromEntries(METRICS.map(([k, label, unit, up]) => [k, { label, unit, up }]));
  const extra = METRICS.map(m => m[0]).filter(k => !BUILT_IN_METRICS.includes(k));
  KEYS = [...BASE_KEYS, ...extra];
  SHORT = { ...BASE_SHORT, ...Object.fromEntries(extra.map(k => [k, META[k].label])) };
}
syncKeys();
const POS = [["OH", "Outside"], ["RS", "Right side"], ["MB", "Middle"], ["S", "Setter"], ["L", "Libero"], ["DS", "Def. specialist"], ["U", "Utility"]];
const LEVELS = [["National", "National"], ["Regional", "Regional"], ["Developmental", "Rise"]];
const teamAge = (t) => parseInt(String(t || ""), 10) || null;
const teamSort = (a, b) => (teamAge(a) || 99) - (teamAge(b) || 99) || a.localeCompare(b);
const d2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
// The value a view ranks on. Improvement: bigger is better for inches,
// a more negative change is better for the sprint.
const valueOf = (cell, view) => !cell ? null : view === "change" ? cell.change : view === "baseline" ? cell.baseline : cell.now;
const better = (key, view) => view === "change" ? (META[key].up ? 1 : -1) : (META[key].up ? 1 : -1);
const show = (key, cell, view) => {
  const v = valueOf(cell, view);
  if (v == null) return "—";
  return view === "change" ? fmtChange(key, v) : fmtMetric(key, v);
};
const chip = (on) => ({ fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", border: "1px solid " + (on ? C.gold : C.border), background: on ? "rgba(233,30,140,0.15)" : "transparent", color: on ? C.gold : C.mut, whiteSpace: "nowrap" });

// Brandon (Reach only) sees just his two screens, with a switch between them.
export function ReachHome({ coach, players, session }) {
  const [tab, setTab] = useState("reports");
  return (<>
    <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
      <button onClick={() => setTab("reports")} style={chip(tab === "reports")}>📈 Testing Reports</button>
      <button onClick={() => setTab("board")} style={chip(tab === "board")}>🏅 Stats Board</button>
      <button onClick={() => setTab("reach")} style={chip(tab === "reach")}>🏃 Reach Stats</button>
    </div>
    {tab === "reports" ? <StatReports coach={coach} players={players} session={session} /> : tab === "board" ? <TestingBoard players={players} /> : <div style={{ padding: "14px 18px 0" }}><DsscReach /></div>}
  </>);
}

// initial: { tests, levels, reviews } handed in instead of read (dev preview).
export default function TestingBoard({ players = [], initial }) {
  const [tests, setTests] = useState(initial?.tests || null);
  const [levels, setLevels] = useState(new Map());
  const [reviews, setReviews] = useState([]);
  const [ages, setAges] = useState([]);
  const [teams, setTeams] = useState([]);
  const [lvls, setLvls] = useState([]);
  const [poss, setPoss] = useState([]);
  const [q, setQ] = useState("");
  const [retested, setRetested] = useState(false);
  const [withFlagged, setWithFlagged] = useState(false);
  const [view, setView] = useState("now");          // now | change | baseline
  const [sort, setSort] = useState({ key: "approach_touch" });
  const [byTeam, setByTeam] = useState(true);
  const [cx, setCx] = useState("broad_jump");
  const [cy, setCy] = useState("vertical");
  const [cPlayers, setCPlayers] = useState(false);

  useEffect(() => {
    if (initial) { setLevels(new Map(initial.levels || [])); setReviews(initial.reviews || []); return; }
    let live = true;
    Promise.all([
      supabase.from("player_stat_tests").select("*").order("test_date"),
      supabase.from("practice_teams").select("team_name, level"),
      supabase.from("stat_flag_reviews").select("player_id, flag_id, decision"),
      loadStatMetrics(),
    ]).then(([t, pt, rv]) => {
      if (!live) return;
      syncKeys();
      setTests(t.data || []); setLevels(new Map((pt.data || []).map(r => [r.team_name, r.level]))); setReviews(rv.data || []);
    });
    return () => { live = false; };
  }, []);

  const season = useMemo(() => players.filter(p => (p.season || "2026-27") === "2026-27"), [players]);
  const roster = useMemo(() => season.filter(p => p.team_assignment && !TERMINAL.includes(p.offer_status || "")), [season]);
  const testsBy = useMemo(() => { const m = new Map(); for (const t of tests || []) { if (!m.has(t.player_id)) m.set(t.player_id, []); m.get(t.player_id).push(t); } return m; }, [tests]);
  // Flags pool the whole season (same as Testing Reports), then keep what
  // still holds a number back: open + ignored, not accepted.
  const heldBy = useMemo(() => {
    const m = new Map(); if (!tests) return m;
    const byP = new Map(); for (const f of allStatFlags(season, testsBy)) { if (!byP.has(f.player_id)) byP.set(f.player_id, []); byP.get(f.player_id).push(f); }
    for (const p of roster) { const fl = byP.get(p.id); if (!fl) continue; const live = reviewFlags(fl, reviews, p.id).live; if (live.length) m.set(p.id, new Set(flaggedReportKeys(p, testsBy.get(p.id) || [], live))); }
    return m;
  }, [tests, season, roster, testsBy, reviews]);

  // One row per player with numbers on file.
  const rows = useMemo(() => !tests ? [] : roster.map(p => {
    const mine = testsBy.get(p.id) || [];
    const cells = {};
    for (const r of metricRows(p, mine)) cells[r.key] = { now: r.latest ?? r.baseline, baseline: r.baseline, change: r.change, from: r.latest != null ? r.latestFrom : r.baselineFrom, flagged: !!heldBy.get(p.id)?.has(r.key) };
    const team = p.team_assignment, age = teamAge(team);
    return { p, name: `${p.first_name || ""} ${p.last_name || ""}`.trim(), team, age, level: levels.get(team) || null, pos: Array.isArray(p.positions) ? p.positions : [], cells, retested: mine.length > 0 };
  }).filter(r => Object.keys(r.cells).length), [tests, roster, testsBy, heldBy, levels]);

  const allTeams = useMemo(() => [...new Set(rows.map(r => r.team))].sort(teamSort), [rows]);
  const allAges = useMemo(() => [...new Set(rows.map(r => r.age).filter(Boolean))].sort((a, b) => a - b), [rows]);
  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(r =>
    (!ages.length || ages.includes(r.age)) && (!teams.length || teams.includes(r.team)) && (!lvls.length || lvls.includes(r.level)) &&
    (!poss.length || r.pos.some(x => poss.includes(x))) && (!retested || r.retested) && (!needle || r.name.toLowerCase().includes(needle)));
  const usable = (r, key) => { const c = r.cells[key]; return c && valueOf(c, view) != null && (withFlagged || !c.flagged); };

  // Rank on the sorted column (best first); rows without a usable number sink.
  const sk = sort.key;
  const sorted = sk === "name" ? shown.slice().sort((a, b) => a.name.localeCompare(b.name))
    : sk === "team" ? shown.slice().sort((a, b) => teamSort(a.team, b.team) || a.name.localeCompare(b.name))
    : shown.slice().sort((a, b) => { const ua = usable(a, sk), ub = usable(b, sk); if (ua !== ub) return ua ? -1 : 1; if (!ua) return a.name.localeCompare(b.name); return better(sk, view) * (valueOf(b.cells[sk], view) - valueOf(a.cells[sk], view)); });
  const rankable = META[sk] != null;

  const stats = (list, key) => {
    const v = list.filter(r => usable(r, key)).map(r => ({ r, v: valueOf(r.cells[key], view) }));
    if (!v.length) return null;
    v.sort((a, b) => better(key, view) * (b.v - a.v));
    return { n: v.length, avg: v.reduce((s, x) => s + x.v, 0) / v.length, top: v.slice(0, 3) };
  };
  const fmtAvg = (key, v) => v == null ? "—" : view === "change" ? fmtChange(key, v) : fmtMetric(key, v);
  const teamRows = byTeam ? [...new Set(shown.map(r => r.team))].sort(teamSort).map(t => ({ team: t, level: levels.get(t), list: shown.filter(r => r.team === t) })) : [];

  const exportCsv = () => {
    const head = ["Player", "Team", "Level", "Positions", ...KEYS.flatMap(k => [SHORT[k] + " now", SHORT[k] + " baseline", SHORT[k] + " change"])];
    const lines = sorted.map(r => [r.name, r.team, r.level === "Developmental" ? "Rise" : r.level || "", r.pos.join("/"),
      ...KEYS.flatMap(k => { const c = r.cells[k]; return c ? [c.now, c.baseline, c.change].map(v => v == null ? "" : d2(v)) : ["", "", ""]; })]);
    const csv = [head, ...lines].map(l => l.map(x => /[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "testing-stats.csv"; a.click();
  };

  if (!tests) return <div style={{ padding: 24, color: C.mut }}>Loading testing numbers…</div>;
  const nFlagged = shown.filter(r => Object.values(r.cells).some(c => c.flagged)).length;
  const th = (key, label, right = true) => (
    <th key={key} onClick={() => setSort({ key })} title={META[key] ? `Rank by ${label}` : `Sort by ${label}`}
      style={{ padding: "8px 8px", textAlign: right ? "right" : "left", fontSize: 11, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase", whiteSpace: "nowrap", cursor: "pointer", color: sk === key ? C.gold : C.mut, borderBottom: "1px solid " + C.border, position: "sticky", top: 0, background: C.card }}>
      {label}{sk === key ? " ▼" : ""}</th>
  );

  return (
    <div style={{ padding: "4px 0 40px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.gold }}>Testing Stats Board</h2>
          <div style={{ fontSize: 12, color: C.mut }}>Every player's physical testing across the club. Latest number unless she hasn't been retested; tap a column to rank by it.</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[["now", "Current"], ["change", "Improvement"], ["baseline", "Baseline"]].map(([v, l]) => <button key={v} onClick={() => setView(v)} style={chip(view === v)}>{l}</button>)}
          <button onClick={() => setByTeam(v => !v)} style={chip(byTeam)}>By team</button>
          <button onClick={exportCsv} style={chip(false)}>⬇ CSV</button>
        </div>
      </div>

      <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 12, marginBottom: 12, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a player" style={{ ...inp, width: 200 }} />
          <select value="" onChange={e => e.target.value && toggle(teams, setTeams, e.target.value)} style={{ ...inp, width: 170 }}>
            <option value="">+ Team…</option>{allTeams.filter(t => !teams.includes(t)).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {teams.map(t => <button key={t} onClick={() => toggle(teams, setTeams, t)} style={chip(true)}>{t} ✕</button>)}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}><input type="checkbox" checked={retested} onChange={e => setRetested(e.target.checked)} style={{ accentColor: C.gold }} /> Retested only</label>
          <label title="Numbers that look like data-entry slips (see Testing Reports). Off = left out of ranks, leaders and averages." style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}><input type="checkbox" checked={withFlagged} onChange={e => setWithFlagged(e.target.checked)} style={{ accentColor: C.gold }} /> Include flagged ⚑</label>
          <div style={{ flex: 1 }} />
          {(ages.length || teams.length || lvls.length || poss.length || q || retested) ? <button onClick={() => { setAges([]); setTeams([]); setLvls([]); setPoss([]); setQ(""); setRetested(false); }} style={chip(false)}>Clear filters</button> : null}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ ...lbl, marginBottom: 0, minWidth: 54 }}>Age</span>
          {allAges.map(a => <button key={a} onClick={() => toggle(ages, setAges, a)} style={chip(ages.includes(a))}>{a}s</button>)}
          <span style={{ ...lbl, marginBottom: 0, marginLeft: 10 }}>Level</span>
          {LEVELS.map(([v, l]) => <button key={v} onClick={() => toggle(lvls, setLvls, v)} style={chip(lvls.includes(v))}>{l}</button>)}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ ...lbl, marginBottom: 0, minWidth: 54 }}>Position</span>
          {POS.map(([v, l]) => <button key={v} onClick={() => toggle(poss, setPoss, v)} style={chip(poss.includes(v))}>{l}</button>)}
        </div>
      </div>

      {/* Leaders + averages for whatever is filtered. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, marginBottom: 12 }}>
        {KEYS.filter(k => !(view === "change" && k === "stand_reach")).map(k => { const s = stats(shown, k); return (
          <div key={k} onClick={() => setSort({ key: k })} style={{ background: C.card, border: "1px solid " + (sk === k ? C.gold : C.border), borderRadius: 12, padding: 10, cursor: "pointer" }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.gold, textTransform: "uppercase", letterSpacing: 0.3 }}>{SHORT[k]}{view === "change" ? " gain" : ""}</div>
            {!s ? <div style={{ fontSize: 12, color: C.mut, marginTop: 6 }}>No numbers</div> : (<>
              <div style={{ fontSize: 12, color: C.mut, margin: "2px 0 6px" }}>Avg <b style={{ color: C.text }}>{fmtAvg(k, s.avg)}</b> · {s.n} player{s.n === 1 ? "" : "s"}</div>
              {s.top.map((x, i) => <div key={x.r.p.id} style={{ display: "flex", gap: 6, fontSize: 12, lineHeight: 1.6 }}><span style={{ color: C.mut, width: 14 }}>{i + 1}</span><span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.r.name} <span style={{ color: C.mut }}>· {x.r.team.replace(/ 1$/, "")}</span></span><b>{view === "change" ? fmtChange(k, x.v) : fmtMetric(k, x.v)}</b></div>)}
            </>)}
          </div>); })}
      </div>

      <TeamChart shown={shown} x={cx} y={cy} setX={setCx} setY={setCy} players={cPlayers} setPlayers={setCPlayers} view={view} usable={usable} stats={stats} />

      {byTeam ? (
        <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead><tr><th style={{ padding: 8, textAlign: "left", fontSize: 11, color: C.mut, textTransform: "uppercase" }}>Team</th><th style={{ padding: 8, textAlign: "right", fontSize: 11, color: C.mut, textTransform: "uppercase" }}>Players</th>
              {KEYS.map(k => <th key={k} style={{ padding: 8, textAlign: "right", fontSize: 11, color: C.mut, textTransform: "uppercase", whiteSpace: "nowrap" }}>{SHORT[k]} avg</th>)}</tr></thead>
            <tbody>{teamRows.map(t => (
              <tr key={t.team} style={{ borderTop: "1px solid " + C.border }}>
                <td style={{ padding: 8, fontWeight: 700, whiteSpace: "nowrap" }}>{t.team.replace(/ 1$/, "")} <span style={{ fontSize: 11, color: C.mut, fontWeight: 400 }}>{t.level === "Developmental" ? "Rise" : t.level || ""}</span></td>
                <td style={{ padding: 8, textAlign: "right", color: C.mut }}>{t.list.length}</td>
                {KEYS.map(k => { const s = stats(t.list, k); return <td key={k} style={{ padding: 8, textAlign: "right", whiteSpace: "nowrap" }}>{s ? <>{fmtAvg(k, s.avg)} <span style={{ fontSize: 10, color: C.mut }}>({s.n})</span></> : <span style={{ color: C.mut }}>—</span>}</td>; })}
              </tr>))}</tbody>
          </table>
        </div>
      ) : (
        <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, overflow: "auto", maxHeight: "75vh" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead><tr>
              <th style={{ padding: "8px 8px", fontSize: 11, color: C.mut, borderBottom: "1px solid " + C.border, position: "sticky", top: 0, background: C.card }}>#</th>
              {th("name", "Player", false)}{th("team", "Team", false)}
              <th style={{ padding: "8px 8px", textAlign: "left", fontSize: 11, color: C.mut, textTransform: "uppercase", borderBottom: "1px solid " + C.border, position: "sticky", top: 0, background: C.card }}>Pos</th>
              {KEYS.map(k => th(k, SHORT[k]))}
            </tr></thead>
            <tbody>{sorted.map((r, i) => (
              <tr key={r.p.id} style={{ borderTop: "1px solid " + C.border }}>
                <td style={{ padding: "7px 8px", color: C.mut, textAlign: "right" }}>{rankable && usable(r, sk) ? i + 1 : ""}</td>
                <td style={{ padding: "7px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>{r.name}{!r.retested && <span title="Tryout numbers only" style={{ fontSize: 10, color: C.mut, fontWeight: 400 }}> · tryout</span>}</td>
                <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>{r.team.replace(/ 1$/, "")} <span style={{ fontSize: 10, color: C.mut }}>{r.level === "Developmental" ? "Rise" : r.level === "National" ? "Nat" : r.level === "Regional" ? "Reg" : ""}</span></td>
                <td style={{ padding: "7px 8px", color: C.mut, whiteSpace: "nowrap", fontSize: 12 }}>{r.pos.join("/")}</td>
                {KEYS.map(k => { const c = r.cells[k], v = valueOf(c, view); const good = view === "change" && v != null && k !== "stand_reach" && (META[k].up ? v >= gainMin(k) : v <= -gainMin(k));
                  return <td key={k} title={c ? (c.flagged ? "⚑ Looks like a data-entry slip — see Testing Reports. " : "") + (view === "now" ? c.from : view === "baseline" ? "Baseline" : "") : ""}
                    style={{ padding: "7px 8px", textAlign: "right", whiteSpace: "nowrap", fontWeight: sk === k ? 800 : 500, color: c?.flagged ? C.amb : good ? C.grn : v == null ? C.mut : C.text, opacity: c?.flagged && !withFlagged ? 0.6 : 1 }}>
                    {c?.flagged ? "⚑ " : ""}{show(k, c, view)}</td>; })}
              </tr>))}</tbody>
          </table>
          {!sorted.length && <div style={{ padding: 20, color: C.mut, fontSize: 13 }}>No players match these filters.</div>}
        </div>
      )}
      <div style={{ fontSize: 11, color: C.mut, marginTop: 8 }}>
        {shown.length} of {rows.length} players with testing numbers{nFlagged ? ` · ${nFlagged} with a ⚑ number ${withFlagged ? "included" : "left out of ranks and averages"}` : ""}. Improvement = latest minus baseline (a faster sprint shows as −). Age = the team's age group.
      </div>
    </div>
  );
}

// ── Chart: pick any two tests; team averages (and optionally players) ──────
const PALETTE = ["#e91e8c", "#22c55e", "#3b82f6", "#f59e0b", "#a855f7", "#06b6d4", "#ef4444", "#84cc16", "#f97316", "#14b8a6", "#eab308", "#8b5cf6", "#ec4899", "#10b981", "#60a5fa", "#fb7185", "#facc15", "#c084fc", "#2dd4bf", "#fdba74"];
function TeamChart({ shown, x, y, setX, setY, players, setPlayers, view, usable, stats }) {
  const teams = [...new Set(shown.map(r => r.team))].sort(teamSort);
  const teamPts = teams.map(t => { const list = shown.filter(r => r.team === t), a = stats(list, x), b = stats(list, y); return a && b ? { team: t, x: a.avg, y: b.avg, nx: a.n, ny: b.n } : null; }).filter(Boolean);
  // Colors only for the teams on the chart, so the first few stay distinct.
  const color = Object.fromEntries(teamPts.map((d, i) => [d.team, PALETTE[i % PALETTE.length]]));
  const playerPts = players ? shown.filter(r => usable(r, x) && usable(r, y)).map(r => ({ r, x: valueOf(r.cells[x], view), y: valueOf(r.cells[y], view) })) : [];
  const W = 820, H = 460, L = 64, R = 24, T = 18, B = 50;
  const all = [...teamPts, ...playerPts];
  const range = (vs) => { if (!vs.length) return [0, 1]; const lo = Math.min(...vs), hi = Math.max(...vs), pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1; return [lo - pad, hi + pad]; };
  const [x0, x1] = range(all.map(d => d.x)), [y0, y1] = range(all.map(d => d.y));
  // Better is always right / up: the sprint (lower is better) runs backwards.
  const fx = (v) => { const f = (v - x0) / (x1 - x0 || 1); return L + (META[x].up ? f : 1 - f) * (W - L - R); };
  const fy = (v) => { const f = (v - y0) / (y1 - y0 || 1); return H - B - (META[y].up ? f : 1 - f) * (H - T - B); };
  const ticks = (lo, hi) => Array.from({ length: 6 }, (_, i) => lo + (i / 5) * (hi - lo));
  const tick = (k, v) => view === "change" ? fmtChange(k, v) : META[k].unit === "sec" ? v.toFixed(2) + "s" : META[k].unit === "in" ? v.toFixed(1) + '"' : v.toFixed(1) + (META[k].unit ? " " + META[k].unit : "");
  const fv = (k, v) => view === "change" ? fmtChange(k, v) : fmtMetric(k, v);
  // Labels sit right of their dot (left near the right edge). One that would
  // land on another label moves a line up or down; if there's no room that
  // close, it's left off (the legend and hover still name the dot).
  const placed = [], lab = {};
  for (const d of [...teamPts].sort((a, b) => fy(a.y) - fy(b.y))) {
    const left = fx(d.x) > W - R - 110, lx = fx(d.x) + (left ? -12 : 12);
    const ly = [0, 13, -13].map(o => fy(d.y) + 4 + o).find(y0 => !placed.some(p => Math.abs(p.x - lx) < 95 && Math.abs(p.y - y0) < 13));
    if (ly == null) continue;
    placed.push({ x: lx, y: ly }); lab[d.team] = { x: lx, y: ly, anchor: left ? "end" : "start" };
  }
  const opts = (other) => KEYS.map(k => <option key={k} value={k} disabled={k === other}>{SHORT[k]}</option>);
  const tag = view === "change" ? " (improvement)" : view === "baseline" ? " (baseline)" : "";
  return (
    <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 12, marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: C.gold, textTransform: "uppercase", letterSpacing: 0.3 }}>Chart</span>
        <label style={{ ...lbl, marginBottom: 0, display: "flex", alignItems: "center", gap: 6 }}>X<select value={x} onChange={e => setX(e.target.value)} style={inp}>{opts(y)}</select></label>
        <label style={{ ...lbl, marginBottom: 0, display: "flex", alignItems: "center", gap: 6 }}>Y<select value={y} onChange={e => setY(e.target.value)} style={inp}>{opts(x)}</select></label>
        <button onClick={() => { setX(y); setY(x); }} title="Swap axes" style={chip(false)}>⇄</button>
        <button onClick={() => setPlayers(!players)} style={chip(players)}>Show players</button>
      </div>
      {!all.length ? <div style={{ padding: 30, textAlign: "center", color: C.mut, fontSize: 13 }}>No team has both {SHORT[x]} and {SHORT[y]}{tag} numbers{view === "change" ? " (a test with no baseline has no improvement yet)" : ""}.</div> : (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={`${SHORT[y]} against ${SHORT[x]} by team`}>
          {ticks(x0, x1).map((v, i) => <g key={"x" + i}><line x1={fx(v)} x2={fx(v)} y1={T} y2={H - B} stroke="#222" /><text x={fx(v)} y={H - B + 16} fill={C.mut} fontSize="11" textAnchor="middle">{tick(x, v)}</text></g>)}
          {ticks(y0, y1).map((v, i) => <g key={"y" + i}><line x1={L} x2={W - R} y1={fy(v)} y2={fy(v)} stroke="#222" /><text x={L - 8} y={fy(v) + 4} fill={C.mut} fontSize="11" textAnchor="end">{tick(y, v)}</text></g>)}
          <text x={(L + W - R) / 2} y={H - 10} fill={C.text} fontSize="12" fontWeight="700" textAnchor="middle">{SHORT[x]}{tag}{META[x].up ? " →" : " — faster to the right"}</text>
          <text x={16} y={(T + H - B) / 2} fill={C.text} fontSize="12" fontWeight="700" textAnchor="middle" transform={`rotate(-90 16 ${(T + H - B) / 2})`}>{SHORT[y]}{tag}{META[y].up ? " →" : " — faster up"}</text>
          {playerPts.map((d, i) => <circle key={"p" + i} cx={fx(d.x)} cy={fy(d.y)} r={4} fill={color[d.r.team]} opacity={0.45}><title>{`${d.r.name} (${d.r.team.replace(/ 1$/, "")}) · ${SHORT[x]} ${fv(x, d.x)} · ${SHORT[y]} ${fv(y, d.y)}`}</title></circle>)}
          {teamPts.map(d => (
            <g key={d.team}>
              <circle cx={fx(d.x)} cy={fy(d.y)} r={9} fill={color[d.team]} stroke="#000" strokeWidth="2"><title>{`${d.team.replace(/ 1$/, "")} average · ${SHORT[x]} ${fv(x, d.x)} (${d.nx}) · ${SHORT[y]} ${fv(y, d.y)} (${d.ny})`}</title></circle>
              {lab[d.team] && <text x={lab[d.team].x} y={lab[d.team].y} textAnchor={lab[d.team].anchor} fill={C.text} fontSize="12" fontWeight="800" stroke="#000" strokeWidth="3" paintOrder="stroke">{d.team.replace(/ 1$/, "")}</text>}
            </g>))}
        </svg>
      )}
      {teamPts.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: 11, color: C.text, marginTop: 6 }}>{teamPts.map(d => <span key={d.team} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 5, background: color[d.team] }} />{d.team.replace(/ 1$/, "")}</span>)}</div>}
      <div style={{ fontSize: 11, color: C.mut, marginTop: 4 }}>Big dots are team averages (follows the filters above); better is up and to the right. Hover a dot for the numbers.{players ? " Small dots are players in their team's color." : ""}</div>
    </div>
  );
}
