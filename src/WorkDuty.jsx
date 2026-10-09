// Work Duty — every coach's tool for who works which job when the team works a
// tournament match (Oct 2026). Per team: plan the whole season fairly in one
// tap, see the next work lineup, mark who isn't there (her jobs are re-dealt),
// swap anyone, re-roll, and cross the match off once it's been worked. The
// fairness table shows every girl's count per job. Logic: shared/work-duty.js.

import { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabase";
import { planMatch, tally, daysOf, ROLE_LABEL, ROLE_SHORT, SET_SLOTS } from "../shared/work-duty.js";

const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", red: "#ef4444", grn: "#22c55e" };
const inp = { background: "#0f0f0f", border: "1px solid " + C.border, borderRadius: 8, color: C.text, fontFamily: "inherit", fontSize: 13, padding: "7px 9px" };
const TERMINAL = ["declined", "not_invited", "opted_out"];
const fmtDay = (iso) => new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const btn = (kind) => ({ padding: "8px 13px", borderRadius: 8, border: kind === "primary" ? "none" : "1px solid " + C.border, background: kind === "primary" ? C.gold : kind === "green" ? C.grn : "transparent", color: kind === "primary" || kind === "green" ? "#000" : C.text, fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "inherit" });

export default function WorkDuty({ coach, players = [], tournaments = [], tournamentAssignments = [], teamNames = [] }) {
  const [team, setTeam] = useState(teamNames[0] || "");
  const [settings, setSettings] = useState(null);
  const [matches, setMatches] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const me = coach?.display_name || coach?.email || null;
  const today = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
  useEffect(() => { if (!team && teamNames.length) setTeam(teamNames[0]); }, [teamNames, team]);

  const load = async () => {
    if (!team) return;
    const [s, m] = await Promise.all([
      supabase.from("work_duty_settings").select("*").eq("team_name", team).maybeSingle(),
      supabase.from("work_duty_matches").select("*").eq("team_name", team).order("match_date").order("seq"),
    ]);
    setSettings(s.data || { team_name: team, matches_per_day: 1, sets: 3, computer: false });
    setMatches(m.data || []);
  };
  useEffect(() => { setActiveId(null); load(); }, [team]);

  const roster = useMemo(() => players.filter(p => p.team_assignment === team && (p.season || "2026-27") === "2026-27" && !TERMINAL.includes(p.offer_status || ""))
    .sort((a, b) => a.first_name.localeCompare(b.first_name)), [players, team]);
  const nameOf = useMemo(() => { const m = new Map(); for (const p of roster) { const dup = roster.filter(x => x.first_name === p.first_name).length > 1; m.set(String(p.id), p.first_name.trim() + (dup ? " " + String(p.last_name || "").trim()[0] + "." : "")); } return m; }, [roster]);
  const nm = (id) => id == null ? "—" : nameOf.get(String(id)) || "(left team)";
  const tnBy = useMemo(() => new Map(tournaments.map(t => [t.id, t])), [tournaments]);
  const upcomingTns = useMemo(() => tournamentAssignments.filter(a => a.team_id === team && !/drop|withdraw|cancel/i.test(a.status || ""))
    .map(a => tnBy.get(a.tournament_id)).filter(t => t && !t.cancelled && (t.end_date || t.start_date) >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date)), [tournamentAssignments, tnBy, team, today]);

  const saveSettings = async (patch) => {
    const next = { ...settings, ...patch, team_name: team, updated_by: me, updated_at: new Date().toISOString() };
    setSettings(next);
    const { error } = await supabase.from("work_duty_settings").upsert(next);
    if (error) setErr(error.message);
  };
  const saveMatch = async (id, patch) => {
    setMatches(xs => xs.map(x => x.id === id ? { ...x, ...patch } : x));
    const { error } = await supabase.from("work_duty_matches").update({ ...patch, updated_by: me, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) setErr(error.message);
  };

  // Plan every upcoming tournament day; worked (crossed-off) matches stay as they are.
  const planSeason = async () => {
    if (!roster.length) { setErr("No players on this team yet."); return; }
    const pending = matches.filter(m => !m.done);
    if (!window.confirm(`Plan ${team}'s work lineups for ${upcomingTns.length} upcoming tournament${upcomingTns.length === 1 ? "" : "s"} (${settings.matches_per_day} work match${settings.matches_per_day === 1 ? "" : "es"} per tournament day)?` + (pending.length ? `\n\nThis replaces the ${pending.length} lineup${pending.length === 1 ? "" : "s"} not crossed off yet. Crossed-off matches stay and count toward fairness.` : ""))) return;
    setBusy(true); setErr(null);
    if (pending.length) { const { error } = await supabase.from("work_duty_matches").delete().in("id", pending.map(m => m.id)); if (error) { setErr(error.message); setBusy(false); return; } }
    const counts = tally(matches.filter(m => m.done));
    const doneKeys = new Set(matches.filter(m => m.done).map(m => m.match_date + "|" + m.seq));
    const rows = [];
    for (const t of upcomingTns) for (const date of daysOf(t.start_date, t.end_date)) {
      if (date < today) continue;
      for (let seq = 1; seq <= settings.matches_per_day; seq++) {
        if (doneKeys.has(date + "|" + seq)) continue;
        rows.push({ team_name: team, tournament_id: t.id, match_date: date, seq, updated_by: me,
          assignments: planMatch({ players: roster, counts, sets: settings.sets, computer: settings.computer }) });
      }
    }
    if (rows.length) { const { error } = await supabase.from("work_duty_matches").insert(rows); if (error) setErr(error.message); }
    setBusy(false); setActiveId(null); load();
  };
  // Re-deal one match (someone's out, or just a re-roll), fair against every other match.
  const replan = async (m, out) => {
    const counts = tally(matches.filter(x => x.id !== m.id));
    const a = planMatch({ players: roster, counts, sets: (m.assignments?.sets || []).length || settings.sets, computer: (m.assignments?.sets || []).some(s => "comp" in s) || settings.computer, out });
    await saveMatch(m.id, { assignments: a });
  };
  const addMatch = async (date, tournament_id) => {
    const seq = Math.max(0, ...matches.filter(m => m.match_date === date).map(m => m.seq)) + 1;
    const counts = tally(matches);
    const { error } = await supabase.from("work_duty_matches").insert({ team_name: team, tournament_id, match_date: date, seq, updated_by: me, assignments: planMatch({ players: roster, counts, sets: settings.sets, computer: settings.computer }) });
    if (error) setErr(error.message); load();
  };

  const counts = useMemo(() => tally(matches), [matches]);
  const doneCounts = useMemo(() => tally(matches, { onlyDone: true }), [matches]);
  const next = matches.find(m => !m.done);
  const active = matches.find(m => m.id === activeId) || next;

  if (!teamNames.length) return <div style={{ padding: 24, color: C.mut }}>You're not on a team's staff yet.</div>;
  if (!settings) return <div style={{ padding: 24, color: C.mut }}>Loading…</div>;

  const Sel = ({ value, onChange, exclude = [] }) => (
    <select value={value ?? ""} onChange={e => onChange(e.target.value || null)} style={{ ...inp, padding: "5px 6px", fontSize: 13, width: "100%" }}>
      <option value="">—</option>
      {roster.filter(p => !exclude.includes(String(p.id)) || String(p.id) === String(value)).map(p => <option key={p.id} value={String(p.id)}>{nm(p.id)}</option>)}
    </select>
  );
  const MatchCard = ({ m }) => {
    const a = m.assignments || {}; const sets = a.sets || []; const hasComp = sets.some(s => "comp" in s);
    const out = (a.out || []).map(String);
    const setA = (patch) => saveMatch(m.id, { assignments: { ...a, ...patch } });
    const t = tnBy.get(m.tournament_id);
    const th = { fontSize: 10, color: C.mut, fontWeight: 800, textTransform: "uppercase", padding: "4px 6px", textAlign: "left" };
    return (
      <div style={{ background: C.card, border: "1px solid " + (m.done ? C.grn : C.gold), borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: m.done ? C.grn : C.gold, textTransform: "uppercase", letterSpacing: 0.5 }}>{m.done ? "✓ Worked" : m.id === next?.id ? "Next work match" : "Work match"}</div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{fmtDay(m.match_date)} · work match {m.seq}</div>
            <div style={{ fontSize: 12, color: C.mut }}>{t ? t.name.trim() + (t.location ? " · " + t.location : "") : ""}</div>
          </div>
          {!m.done && <button disabled={busy} onClick={() => replan(m, out)} style={btn()}>↻ Re-roll</button>}
          {!m.done ? <button onClick={() => saveMatch(m.id, { done: true, done_at: new Date().toISOString(), done_by: me })} style={btn("green")}>✓ Cross it off</button>
            : <button onClick={() => saveMatch(m.id, { done: false, done_at: null, done_by: null })} style={btn()}>Undo</button>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 10 }}>
          {[["book", a.book], ["libero", a.libero]].map(([role, pid]) => (
            <div key={role} style={{ background: C.bg, borderRadius: 8, padding: 8 }}>
              <div style={{ fontSize: 10, color: C.mut, fontWeight: 800, textTransform: "uppercase", marginBottom: 4 }}>{ROLE_LABEL[role]} · all match</div>
              {m.done ? <b>{nm(pid)}</b> : <Sel value={pid} onChange={v => setA({ [role]: v })} exclude={out} />}
            </div>
          ))}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 420 }}>
            <thead><tr><th style={th}>Set</th>{SET_SLOTS.filter(([s]) => s !== "comp" || hasComp).map(([s, , l]) => <th key={s} style={th}>{l}</th>)}</tr></thead>
            <tbody>{sets.map((row, i) => (
              <tr key={i}><td style={{ padding: "4px 6px", fontWeight: 800, color: C.gold }}>{i + 1}</td>
                {SET_SLOTS.filter(([s]) => s !== "comp" || hasComp).map(([s]) => <td key={s} style={{ padding: "3px 4px" }}>{m.done ? nm(row[s]) : <Sel value={row[s]} exclude={out} onChange={v => setA({ sets: sets.map((r, j) => j === i ? { ...r, [s]: v } : r) })} />}</td>)}
              </tr>))}</tbody>
          </table>
        </div>
        {!m.done && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 10, color: C.mut, fontWeight: 800, textTransform: "uppercase", marginBottom: 4 }}>Not here? Tap her — her jobs get re-dealt fairly</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {roster.map(p => { const isOut = out.includes(String(p.id)); return (
                <button key={p.id} onClick={() => replan(m, isOut ? out.filter(x => x !== String(p.id)) : [...out, String(p.id)])}
                  style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", border: "1px solid " + (isOut ? C.red : C.border), background: isOut ? "rgba(239,68,68,0.15)" : "transparent", color: isOut ? C.red : C.text, textDecoration: isOut ? "line-through" : "none" }}>{nm(p.id)}</button>); })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const byTn = []; for (const m of matches) { const k = m.tournament_id || "x"; let g = byTn.find(x => x.k === k); if (!g) byTn.push(g = { k, t: tnBy.get(m.tournament_id), ms: [] }); g.ms.push(m); }
  const roles = ["book", "libero", "line", "flip", ...(settings.computer || matches.some(m => (m.assignments?.sets || []).some(s => "comp" in s)) ? ["comp"] : [])];

  return (
    <div style={{ padding: "16px 16px 40px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.gold }}>Work Duty</h2>
          <div style={{ fontSize: 12, color: C.mut }}>Who works which job when we work a match — dealt fairly all season. Everyone does everything.</div>
        </div>
        <select value={team} onChange={e => setTeam(e.target.value)} style={{ ...inp, fontWeight: 800 }}>{teamNames.map(t => <option key={t}>{t}</option>)}</select>
      </div>
      {err && <div style={{ color: C.red, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{err}</div>}

      <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 12, marginBottom: 14, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
        <label>Work matches per tournament day <select value={settings.matches_per_day} onChange={e => saveSettings({ matches_per_day: +e.target.value })} style={inp}>{[1, 2].map(n => <option key={n}>{n}</option>)}</select></label>
        <label>Sets per match <select value={settings.sets} onChange={e => saveSettings({ sets: +e.target.value })} style={inp}>{[2, 3].map(n => <option key={n}>{n}</option>)}</select></label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="checkbox" checked={!!settings.computer} onChange={e => saveSettings({ computer: e.target.checked })} style={{ accentColor: C.gold, width: 16, height: 16 }} /> Computer scorekeeper each set</label>
        <div style={{ flex: 1 }} />
        <span style={{ color: C.mut, fontSize: 12 }}>{roster.length} players · {upcomingTns.length} upcoming tournament{upcomingTns.length === 1 ? "" : "s"}</span>
        <button disabled={busy} onClick={planSeason} style={btn("primary")}>{busy ? "Planning…" : matches.length ? "Re-plan the season" : "Plan the season"}</button>
      </div>

      {!matches.length ? (
        <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 20, color: C.mut, fontSize: 13 }}>No work lineups yet. Pick how many matches you work per tournament day, then <b style={{ color: C.text }}>Plan the season</b> — it deals every job fairly across every tournament {team} is entered in.</div>
      ) : (<>
        {active && <MatchCard m={active} />}
        {active && next && active.id !== next.id && <button onClick={() => setActiveId(null)} style={{ ...btn(), marginBottom: 14 }}>← Back to the next work match</button>}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1.2fr) minmax(280px, 1fr)", gap: 14, alignItems: "start" }}>
          <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.mut, textTransform: "uppercase", marginBottom: 8 }}>The season</div>
            {byTn.map(g => (
              <div key={g.k} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>{g.t ? g.t.name.trim() : "Other"}</div>
                {g.ms.map(m => (
                  <div key={m.id} onClick={() => setActiveId(m.id)} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", marginTop: 3, borderRadius: 8, cursor: "pointer", background: active?.id === m.id ? "rgba(233,30,140,0.12)" : C.bg, opacity: m.done ? 0.55 : 1 }}>
                    <span style={{ width: 16, color: m.done ? C.grn : C.mut, fontWeight: 900 }}>{m.done ? "✓" : "○"}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, textDecoration: m.done ? "line-through" : "none", minWidth: 120 }}>{fmtDay(m.match_date)} · #{m.seq}</span>
                    <span style={{ fontSize: 11, color: C.mut, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Book {nm(m.assignments?.book)} · Libero {nm(m.assignments?.libero)}</span>
                  </div>
                ))}
                {g.t && <button onClick={() => addMatch(g.ms[g.ms.length - 1].match_date, g.t.id)} style={{ background: "none", border: "none", color: C.gold, fontSize: 11, fontWeight: 700, cursor: "pointer", padding: "4px 8px", fontFamily: "inherit" }}>+ another work match on {fmtDay(g.ms[g.ms.length - 1].match_date)}</button>}
              </div>
            ))}
          </div>
          <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 12, overflowX: "auto" }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.mut, textTransform: "uppercase", marginBottom: 2 }}>Fairness — jobs per player</div>
            <div style={{ fontSize: 11, color: C.mut, marginBottom: 8 }}>Worked so far / planned for the season</div>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
              <thead><tr><th style={{ textAlign: "left", padding: 4, color: C.mut, fontSize: 10 }}>Player</th>{roles.map(r => <th key={r} style={{ padding: 4, color: C.mut, fontSize: 10 }}>{ROLE_SHORT[r]}</th>)}<th style={{ padding: 4, color: C.gold, fontSize: 10 }}>Total</th></tr></thead>
              <tbody>{roster.map(p => { const k = String(p.id), d = doneCounts[k] || {}, a = counts[k] || {}; return (
                <tr key={p.id} style={{ borderTop: "1px solid " + C.border }}><td style={{ padding: 4, fontWeight: 700 }}>{nm(p.id)}</td>
                  {roles.map(r => <td key={r} style={{ padding: 4, textAlign: "center" }}><b>{d[r] || 0}</b><span style={{ color: C.mut }}> / {a[r] || 0}</span></td>)}
                  <td style={{ padding: 4, textAlign: "center", color: C.gold, fontWeight: 800 }}>{d.total || 0}<span style={{ color: C.mut, fontWeight: 400 }}> / {a.total || 0}</span></td></tr>); })}</tbody>
            </table>
          </div>
        </div>
      </>)}
    </div>
  );
}
