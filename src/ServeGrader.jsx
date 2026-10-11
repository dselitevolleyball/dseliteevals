// Serve grader (Drew, Oct 11 2026): grade one serve at a time, on the spot.
//   Miss (net/out)  -> 0
//   In: accuracy 1-3 (in / target area / on target) x toughness 1-3
//       (easy / pressure / nasty) -> score 1-9
// Serve type (float / fast) is recorded on every serve so float and fast
// serving can be compared. A session is a team + a date. Rows live in
// serve_reps (migrations/20261011_serve_reps.sql). Coaches grade their own
// teams; admins and can_view_teams coaches any active team.
// `api` can be swapped (the dev harness uses an in-memory one).
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabase";

const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", grn: "#22c55e", amber: "#f59e0b", red: "#ef4444", blue: "#60a5fa" };
const ACC = [[1, "In", "anywhere"], [2, "Target area", "the zone called"], [3, "On target", "deep corner / seam"]];
const TOUGH = [[1, "Easy", "perfect pass"], [2, "Pressure", "passer has to move"], [3, "Nasty", "ace or a 1-pass"]];
const TYPES = [["float", "Float", "no spin"], ["fast", "Fast", "topspin / jump"]];
export const serveScore = (accuracy, toughness) => (accuracy === 0 ? 0 : accuracy * toughness);

const supabaseApi = {
  // Paged: this project caps every read at 1,000 rows, and a team passes that
  // within weeks. Ordered by id so the pages never shift under each other.
  load: async (team) => {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("serve_reps").select("*").eq("team_name", team).order("id").range(from, from + 999);
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < 1000) return out;
    }
  },
  insert: async (row) => { const { data, error } = await supabase.from("serve_reps").insert(row).select().single(); if (error) throw error; return data; },
  remove: async (id) => { const { error } = await supabase.from("serve_reps").delete().eq("id", id); if (error) throw error; },
};

const localISO = (d = new Date()) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };
const fmtD = (iso) => { try { return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); } catch { return iso; } };
const pct = (v) => (v == null ? "–" : Math.round(v * 100) + "%");
const one = (v) => (v == null ? "–" : (Math.round(v * 10) / 10).toFixed(1));
const toneScore = (v) => (v == null ? C.mut : v >= 5 ? C.grn : v >= 3 ? C.amber : C.red);
const toneIn = (v) => (v == null ? C.mut : v >= 0.9 ? C.grn : v >= 0.8 ? C.amber : C.red);

// Everything the screens show for a set of serves.
export function summarize(reps) {
  const n = reps.length, ins = reps.filter(r => r.accuracy > 0);
  const avg = (arr, k) => (arr.length ? arr.reduce((s, r) => s + Number(r[k] || 0), 0) / arr.length : null);
  return { n, inPct: n ? ins.length / n : null, score: n ? avg(reps, "score") : null, acc: avg(ins, "accuracy"), tough: avg(ins, "toughness"), nasty: n ? reps.filter(r => r.toughness === 3).length / n : null };
}

const savedTeam = () => { try { return localStorage.getItem("dse.serveTeam") || ""; } catch { return ""; } };

export default function ServeGrader({ coach, players = [], teams = [], api = supabaseApi }) {
  const [team, setTeam] = useState(() => { const t = savedTeam(); return teams.includes(t) ? t : teams[0] || ""; });
  const [date, setDate] = useState(localISO());
  const dateTouched = useRef(false);        // the coach picked a date by hand
  const pending = useRef(new Map());        // temp id -> insert promise (resolves to the saved row or null)
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const loadedTeam = useRef("");
  const [tab, setTab] = useState("grade");
  const [reps, setReps] = useState(null);
  const [server, setServer] = useState(null);
  const [type, setType] = useState("float");
  const [acc, setAcc] = useState(null);
  const [flash, setFlash] = useState("");
  const [range, setRange] = useState("30");
  const [openPlayer, setOpenPlayer] = useState(null);
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches);
  useEffect(() => { const mq = window.matchMedia("(max-width: 700px)"); const on = e => setNarrow(e.matches); mq.addEventListener("change", on); return () => mq.removeEventListener("change", on); }, []);
  // Teams arrive after a reload: prefer the team this device was last grading.
  useEffect(() => { if (!teams.includes(team) && teams[0]) { const t = savedTeam(); setTeam(teams.includes(t) ? t : teams[0]); } }, [teams.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!team) return; let live = true; setLoadError("");
    if (loadedTeam.current !== team) { setReps(null); loadedTeam.current = team; } // a refresh keeps the screen up
    try { localStorage.setItem("dse.serveTeam", team); } catch { /* private mode */ }
    api.load(team).then(r => { if (live) setReps(r); }).catch(e => { if (live) { setReps([]); setLoadError(e.message || "unknown error"); } });
    return () => { live = false; };
  }, [team, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Coming back to the screen (phone unlocked, next practice): roll the date to
  // today unless the coach picked one, and pull in other coaches' serves.
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === "hidden") return;
      if (!dateTouched.current && localISO() !== date) setDate(localISO());
      if (!pending.current.size) setReloadKey(k => k + 1);
    };
    document.addEventListener("visibilitychange", wake);
    return () => document.removeEventListener("visibilitychange", wake);
  }, [date]);

  const roster = useMemo(() => players
    .filter(p => p.team_assignment === team && !/declin|releas|withdr|not_invited|opted/i.test(p.offer_status || ""))
    .sort((a, b) => (parseInt(a.jersey_number) || 999) - (parseInt(b.jersey_number) || 999) || String(a.first_name).localeCompare(String(b.first_name))), [players, team]);
  const nameOf = (p) => ((p.first_name || "") + " " + (p.last_name || "")).trim();
  const short = (p) => (p.jersey_number ? "#" + p.jersey_number + " " : "") + String(p.first_name || "").trim();
  const today = (reps || []).filter(r => r.session_date === date);
  const mine = (pid) => today.filter(r => r.player_id === pid);
  const sel = roster.find(p => p.id === server) || null;

  const pickServer = (pid) => {
    setServer(pid); setAcc(null); setFlash("");
    const last = mine(pid).slice(-1)[0]; if (last) setType(last.serve_type); // her usual serve
  };
  const record = async (accuracy, toughness) => {
    if (!sel) { setFlash("Tap the server first."); return; }
    const row = { player_id: sel.id, team_name: team, session_date: date, serve_type: type, accuracy, toughness: accuracy === 0 ? null : toughness, score: serveScore(accuracy, toughness), graded_by: coach?.display_name || coach?.email || null };
    const tmp = { ...row, id: "tmp" + Date.now() + Math.random().toString(36).slice(2, 6), created_at: new Date().toISOString() };
    const what = `${short(sel)} ${accuracy === 0 ? "miss" : "A" + accuracy + "×T" + toughness}`;
    setReps(r => [...(r || []), tmp]); setAcc(null);
    setFlash(accuracy === 0 ? `${short(sel)}: miss (0)` : `${short(sel)}: ${type === "float" ? "Float" : "Fast"} · accuracy ${accuracy} × toughness ${toughness} = ${row.score}`);
    const p = api.insert(row).then(saved => {
      setReps(r => (r || []).map(x => (x.id === tmp.id ? saved : x)));
      return saved;
    }).catch(e => {
      setReps(r => (r || []).filter(x => x.id !== tmp.id));
      setLoadError(`Didn't save ${what}: ${e.message}. Grade that serve again.`);
      return null;
    }).finally(() => pending.current.delete(tmp.id));
    pending.current.set(tmp.id, p);
    await p;
  };
  const undo = async () => {
    const last = today.slice(-1)[0]; if (!last) return;
    if (!window.confirm(`Remove the last serve (${short(roster.find(p => p.id === last.player_id) || {})}, ${last.accuracy === 0 ? "miss" : "score " + last.score})?`)) return;
    // Still saving: wait for it, then delete the saved row (else it lands in the DB anyway).
    let target = last;
    if (String(last.id).startsWith("tmp")) {
      const p = pending.current.get(last.id);
      target = p ? await p : null;
      if (!target) { setReps(r => (r || []).filter(x => x.id !== last.id)); setFlash("Last serve removed."); return; }
    }
    // Only hide it once the delete has worked, so a retry can't remove the serve before it.
    try { await api.remove(target.id); setReps(r => (r || []).filter(x => x.id !== target.id && x.id !== last.id)); setFlash("Last serve removed."); }
    catch (e) { setLoadError("Couldn't remove that serve: " + e.message); }
  };

  if (!teams.length) return <div style={{ padding: 30, textAlign: "center", color: C.mut, fontSize: 13 }}>No teams to grade yet. If you coach a team, it shows here once your teams have loaded.</div>;
  const isToday = date === localISO();
  const errorBar = loadError ? (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", marginBottom: 12, borderRadius: 10, border: "1px solid " + C.red, background: C.red + "1a", color: C.red, fontSize: 13, fontWeight: 600 }}>
      <span style={{ flex: 1 }}>{/^(Didn't|Couldn't remove)/.test(loadError) ? loadError : "Couldn't load serves: " + loadError}</span>
      {!/^(Didn't|Couldn't remove)/.test(loadError) && <button onClick={() => setReloadKey(k => k + 1)} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid " + C.red, background: "transparent", color: C.red, fontFamily: "inherit", fontWeight: 800, cursor: "pointer" }}>Retry</button>}
      <button onClick={() => setLoadError("")} aria-label="Dismiss" style={{ background: "none", border: "none", color: C.red, fontSize: 16, cursor: "pointer" }}>✕</button>
    </div>
  ) : null;

  const big = (on, color) => ({ flex: 1, minWidth: 0, minHeight: narrow ? 62 : 56, borderRadius: 12, border: "1px solid " + (on ? color || C.gold : C.border), background: on ? (color || C.gold) + "26" : C.card, color: on ? color || C.gold : C.text, cursor: "pointer", fontFamily: "inherit", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, padding: "6px 4px", WebkitTapHighlightColor: "transparent" });
  const lbl = { fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: C.mut, margin: "14px 0 6px" };
  const stat = (v, k, color) => (
    <div style={{ background: C.bg, border: "1px solid " + C.border, borderRadius: 10, padding: "8px 10px" }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || C.text }}>{v}</div><div style={{ fontSize: 10, color: C.mut, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{k}</div>
    </div>
  );
  const th = { textAlign: "left", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4, color: C.mut, padding: "7px 8px", borderBottom: "1px solid " + C.border, whiteSpace: "nowrap", background: C.bg };
  const td = { padding: "8px", fontSize: 13, borderBottom: "1px solid " + C.border, whiteSpace: "nowrap" };

  // ── Grade ───────────────────────────────────────────────────────────────
  const gradeView = () => {
    const s = sel ? summarize(mine(sel.id)) : null;
    return (
      <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "minmax(0,1fr) 300px", gap: 16, alignItems: "start" }}>
        <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 14, padding: "4px 14px 14px" }}>
          <div style={lbl}>Server</div>
          {!roster.length ? <div style={{ fontSize: 13, color: C.mut }}>No players on {team}.</div> : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {roster.map(p => { const on = p.id === server, n = mine(p.id).length; return (
                <button key={p.id} onClick={() => pickServer(p.id)} title={nameOf(p)}
                  style={{ padding: "8px 12px", minHeight: 40, borderRadius: 20, border: "1px solid " + (on ? C.gold : C.border), background: on ? C.gold : "transparent", color: on ? "#000" : C.text, fontFamily: "inherit", fontSize: 14, fontWeight: on ? 800 : 600, cursor: "pointer" }}>
                  {short(p)}{n > 0 && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: on ? "#000" : C.mut }}>{n}</span>}
                </button>); })}
            </div>
          )}
          <div style={lbl}>Serve type</div>
          <div style={{ display: "flex", gap: 8 }}>
            {TYPES.map(([k, l, sub]) => <button key={k} onClick={() => setType(k)} style={big(type === k, C.blue)}><span style={{ fontSize: 15, fontWeight: 800 }}>{l}</span><span style={{ fontSize: 10, color: C.mut }}>{sub}</span></button>)}
          </div>
          <div style={lbl}>Did it go in?</div>
          <button onClick={() => record(0, null)} style={{ ...big(false), width: "100%", border: "1px solid " + C.red, background: C.red + "1f", color: C.red }}>
            <span style={{ fontSize: 16, fontWeight: 800 }}>Miss</span><span style={{ fontSize: 11, opacity: 0.85 }}>net or out = 0</span>
          </button>
          <div style={lbl}>Accuracy (if it's in)</div>
          <div style={{ display: "flex", gap: 8 }}>
            {ACC.map(([v, l, sub]) => <button key={v} onClick={() => setAcc(acc === v ? null : v)} style={big(acc === v)}><span style={{ fontSize: 18, fontWeight: 800 }}>{v}</span><span style={{ fontSize: 13, fontWeight: 700 }}>{l}</span><span style={{ fontSize: 10, color: C.mut }}>{sub}</span></button>)}
          </div>
          <div style={lbl}>Toughness {acc ? <span style={{ color: C.gold, textTransform: "none", letterSpacing: 0 }}>· saves the serve</span> : null}</div>
          <div style={{ display: "flex", gap: 8, opacity: acc ? 1 : 0.45 }}>
            {TOUGH.map(([v, l, sub]) => <button key={v} onClick={() => (acc ? record(acc, v) : setFlash("Tap accuracy first (or Miss)."))} style={big(false)}><span style={{ fontSize: 18, fontWeight: 800 }}>{v}</span><span style={{ fontSize: 13, fontWeight: 700 }}>{l}</span><span style={{ fontSize: 10, color: C.mut }}>{sub}</span></button>)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, minHeight: 28 }}>
            <span style={{ flex: 1, fontSize: 13, color: /Didn't|Couldn't/.test(flash) ? C.red : C.mut }}>{flash}</span>
            {today.length > 0 && <button onClick={undo} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid " + C.border, background: "transparent", color: C.mut, fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>↶ Undo last</button>}
          </div>
        </div>

        <div>
          {sel && s && <>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.text, margin: "2px 0 8px" }}>{nameOf(sel)} · {fmtD(date)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, marginBottom: 10 }}>
              {stat(s.n, "serves")}{stat(pct(s.inPct), "in", toneIn(s.inPct))}{stat(one(s.score), "score /9", toneScore(s.score))}
              {stat(one(s.acc), "accuracy")}{stat(one(s.tough), "toughness")}{stat(pct(s.nasty), "nasty")}
            </div>
            <div style={{ fontSize: 12, color: C.mut, lineHeight: 1.9, marginBottom: 14 }}>
              {mine(sel.id).slice(-10).reverse().map((r, i) => <div key={r.id || i}>{r.serve_type === "float" ? "Float" : "Fast"} · {r.accuracy === 0 ? <span style={{ color: C.red, fontWeight: 700 }}>miss</span> : <>A{r.accuracy} × T{r.toughness} = <b style={{ color: toneScore(r.score) }}>{r.score}</b></>}</div>)}
              {!mine(sel.id).length && "No serves yet today."}
            </div>
          </>}
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text, margin: "2px 0 8px" }}>{team} · {isToday ? "today's session" : fmtD(date)}</div>
          <div style={{ overflowX: "auto", border: "1px solid " + C.border, borderRadius: 10 }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr><th style={th}>Player</th><th style={th}>Serves</th><th style={th}>In</th><th style={th}>Score</th></tr></thead>
              <tbody>
                {roster.filter(p => mine(p.id).length).map(p => { const x = summarize(mine(p.id)); return (
                  <tr key={p.id} onClick={() => pickServer(p.id)} style={{ cursor: "pointer", background: p.id === server ? C.gold + "14" : undefined }}>
                    <td style={{ ...td, fontWeight: 700 }}>{short(p)}</td><td style={td}>{x.n}</td><td style={{ ...td, color: toneIn(x.inPct), fontWeight: 700 }}>{pct(x.inPct)}</td><td style={{ ...td, color: toneScore(x.score), fontWeight: 800 }}>{one(x.score)}</td>
                  </tr>); })}
                {!today.length && <tr><td colSpan={4} style={{ ...td, color: C.mut, whiteSpace: "normal" }}>Pick a server and grade the first serve.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // ── Stats ───────────────────────────────────────────────────────────────
  const statsView = () => {
    if (loadError && !/^(Didn't|Couldn't remove)/.test(loadError)) return <div style={{ padding: 20, color: C.mut, fontSize: 13 }}>Stats show once the serves load.</div>;
    const from = range === "today" ? date : range === "season" ? "0000-00-00" : daysAgo(Number(range));
    const inRange = (reps || []).filter(r => r.session_date >= from && (range !== "today" || r.session_date === date));
    const rows = roster.map(p => {
      const rs = inRange.filter(r => r.player_id === p.id);
      return { p, all: summarize(rs), float: summarize(rs.filter(r => r.serve_type === "float")), fast: summarize(rs.filter(r => r.serve_type === "fast")), rs };
    }).filter(x => x.all.n).sort((a, b) => (b.all.score ?? -1) - (a.all.score ?? -1));
    const teamAll = summarize(inRange);
    const typeCell = (x) => (x.n ? <span><b style={{ color: toneScore(x.score) }}>{one(x.score)}</b><span style={{ color: C.mut }}> · {pct(x.inPct)} in · {x.n}</span></span> : <span style={{ color: C.mut }}>–</span>);
    return (
      <div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {[["today", "This session"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["season", "Season"]].map(([k, l]) => (
            <button key={k} onClick={() => setRange(k)} style={{ padding: "6px 12px", borderRadius: 16, border: "1px solid " + (range === k ? C.gold : C.border), background: range === k ? C.gold : "transparent", color: range === k ? "#000" : C.mut, fontFamily: "inherit", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>{l}</button>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, marginBottom: 14 }}>
          {stat(teamAll.n, "team serves")}{stat(pct(teamAll.inPct), "team in", toneIn(teamAll.inPct))}{stat(one(teamAll.score), "team score /9", toneScore(teamAll.score))}
          {stat(one(teamAll.acc), "accuracy")}{stat(one(teamAll.tough), "toughness")}{stat(pct(teamAll.nasty), "nasty")}
        </div>
        <div style={{ overflowX: "auto", border: "1px solid " + C.border, borderRadius: 10 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 720 }}>
            <thead><tr>{["Player", "Serves", "In", "Score /9", "Accuracy", "Toughness", "Nasty", "Float", "Fast"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map(({ p, all, float, fast, rs }) => [
                <tr key={p.id} onClick={() => setOpenPlayer(openPlayer === p.id ? null : p.id)} style={{ cursor: "pointer" }}>
                  <td style={{ ...td, fontWeight: 800 }}>{openPlayer === p.id ? "▾ " : "▸ "}{short(p)} <span style={{ color: C.mut, fontWeight: 500 }}>{String(p.last_name || "").trim()}</span></td>
                  <td style={td}>{all.n}</td>
                  <td style={{ ...td, color: toneIn(all.inPct), fontWeight: 700 }}>{pct(all.inPct)}</td>
                  <td style={{ ...td, color: toneScore(all.score), fontWeight: 800 }}>{one(all.score)}</td>
                  <td style={td}>{one(all.acc)}</td><td style={td}>{one(all.tough)}</td><td style={td}>{pct(all.nasty)}</td>
                  <td style={td}>{typeCell(float)}</td><td style={td}>{typeCell(fast)}</td>
                </tr>,
                openPlayer === p.id && (
                  <tr key={p.id + "-trend"}><td colSpan={9} style={{ ...td, whiteSpace: "normal", background: C.bg }}>
                    {[...new Set(rs.map(r => r.session_date))].sort().map(d => { const x = summarize(rs.filter(r => r.session_date === d)); return (
                      <div key={d} style={{ display: "grid", gridTemplateColumns: "110px 1fr 140px", gap: 10, alignItems: "center", padding: "3px 0" }}>
                        <span style={{ fontSize: 12, color: C.mut }}>{fmtD(d)}</span>
                        <span style={{ height: 10, borderRadius: 5, background: C.border, overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: Math.round((x.score || 0) / 9 * 100) + "%", background: toneScore(x.score) }} /></span>
                        <span style={{ fontSize: 12 }}><b style={{ color: toneScore(x.score) }}>{one(x.score)}</b> /9 · {pct(x.inPct)} in · {x.n}</span>
                      </div>); })}
                  </td></tr>
                ),
              ])}
              {!rows.length && <tr><td colSpan={9} style={{ ...td, color: C.mut }}>No serves graded in this range yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: C.mut, marginTop: 8, lineHeight: 1.6 }}>Score = accuracy × toughness (0–9); a miss is 0 and counts in the average. Accuracy and toughness average the serves that went in. Nasty = share of all serves graded toughness 3.</div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.gold }}>🏐 Serve Grader</h2>
        <div style={{ flex: 1 }} />
        {teams.length > 1 && <select value={team} onChange={e => { setTeam(e.target.value); setServer(null); setAcc(null); setFlash(""); }} style={{ background: C.bg, color: C.text, border: "1px solid " + C.border, borderRadius: 8, padding: "7px 8px", fontFamily: "inherit", fontSize: 13 }}>{teams.map(t => <option key={t} value={t}>{t}</option>)}</select>}
        <input type="date" value={date} onChange={e => { if (!e.target.value) return; dateTouched.current = e.target.value !== localISO(); setDate(e.target.value); }} style={{ background: C.bg, color: C.text, border: "1px solid " + C.border, borderRadius: 8, padding: "6px 8px", fontFamily: "inherit", fontSize: 13, colorScheme: "dark" }} />
        <div style={{ display: "inline-flex", border: "1px solid " + C.border, borderRadius: 8, overflow: "hidden" }}>
          {[["grade", "Grade"], ["stats", "Stats"]].map(([k, l]) => <button key={k} onClick={() => setTab(k)} style={{ padding: "7px 16px", border: "none", background: tab === k ? C.gold : "transparent", color: tab === k ? "#000" : C.mut, fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>{l}</button>)}
        </div>
      </div>
      {errorBar}
      {reps === null ? <div style={{ padding: 24, color: C.mut, textAlign: "center" }}>Loading…</div> : tab === "grade" ? gradeView() : statsView()}
    </div>
  );
}
