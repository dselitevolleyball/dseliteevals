// Work Duty — who does which job when the team works a match (Oct 2026).
// Simple on purpose: every team has numbered work assignments already dealt
// fairly (#1, #2, ...). A coach opens it, ticks who's at the tournament, sees
// the NEXT assignment and taps Done; the next one appears. Anyone unticked
// gets no jobs — the next assignment is re-dealt to the girls who are there —
// and the rest of the list is re-balanced so it stays even all season.
// Logic: shared/work-duty.js.

import { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabase";
import { planMatch, tally, dealAssignments, balanceSeason, ROLE_LABEL, ROLE_SHORT, SET_SLOTS } from "../shared/work-duty.js";

const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", red: "#ef4444", grn: "#22c55e" };
const TERMINAL = ["declined", "not_invited", "opted_out"];
const BATCH = 50;
const btn = (kind) => ({ padding: "10px 16px", borderRadius: 10, border: kind === "ghost" ? "1px solid " + C.border : "none", background: kind === "green" ? C.grn : kind === "ghost" ? "transparent" : C.gold, color: kind === "ghost" ? C.text : "#000", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit" });

export default function WorkDuty({ coach, players = [], teamNames = [] }) {
  const [team, setTeam] = useState(teamNames[0] || "");
  const [settings, setSettings] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const me = coach?.display_name || coach?.email || null;
  useEffect(() => { if (!team && teamNames.length) setTeam(teamNames[0]); }, [teamNames, team]);

  const roster = useMemo(() => players.filter(p => p.team_assignment === team && (p.season || "2026-27") === "2026-27" && !TERMINAL.includes(p.offer_status || ""))
    .sort((a, b) => a.first_name.localeCompare(b.first_name)), [players, team]);
  const nameOf = useMemo(() => { const m = new Map(); for (const p of roster) { const dup = roster.filter(x => x.first_name === p.first_name).length > 1; m.set(String(p.id), p.first_name.trim() + (dup ? " " + String(p.last_name || "").trim()[0] + "." : "")); } return m; }, [roster]);
  const nm = (id) => id == null ? "—" : nameOf.get(String(id)) || "(not on team)";

  const load = async () => {
    if (!team) return;
    const [s, m] = await Promise.all([
      supabase.from("work_duty_settings").select("*").eq("team_name", team).maybeSingle(),
      supabase.from("work_duty_matches").select("*").eq("team_name", team).order("seq"),
    ]);
    setSettings(s.data || { team_name: team, sets: 3, computer: false, absent: [] });
    setRows(m.data || []);
  };
  useEffect(() => { setRows([]); setSettings(null); load(); }, [team]);

  const absent = (settings?.absent || []).map(String);
  const here = roster.filter(p => !absent.includes(String(p.id)));
  const done = rows.filter(r => r.done);
  const todo = rows.filter(r => !r.done);
  const next = todo[0];

  // Deal (or top up) the team's assignments, fair against what's been worked.
  const generate = async (replace) => {
    if (roster.length < 3) { setErr("Not enough players on this team."); return; }
    setBusy(true); setErr(null);
    if (replace && todo.length) await supabase.from("work_duty_matches").delete().in("id", todo.map(r => r.id));
    const keep = replace ? [] : todo;
    const dealt = dealAssignments(roster, BATCH - keep.length, { sets: settings.sets, computer: settings.computer, done: [...done, ...keep] });
    let seq = Math.max(0, ...rows.filter(r => r.done || !replace).map(r => r.seq));
    const ins = dealt.map(a => ({ team_name: team, seq: ++seq, assignments: a, updated_by: me }));
    if (ins.length) { const { error } = await supabase.from("work_duty_matches").insert(ins); if (error) setErr(error.message); }
    setBusy(false); load();
  };
  // Re-deal just the next assignment with whoever is here.
  const redealNext = async (absentIds, base = rows) => {
    const n = base.find(r => !r.done); if (!n) return;
    const counts = tally(base.filter(r => r.id !== n.id));
    const a = planMatch({ players: roster, counts, sets: settings.sets, computer: settings.computer, out: absentIds });
    setRows(xs => xs.map(x => x.id === n.id ? { ...x, assignments: a } : x));
    await supabase.from("work_duty_matches").update({ assignments: a, updated_by: me, updated_at: new Date().toISOString() }).eq("id", n.id);
  };
  const toggleHere = async (pid) => {
    const id = String(pid);
    const nextAbsent = absent.includes(id) ? absent.filter(x => x !== id) : [...absent, id];
    if (roster.length - nextAbsent.length < 3) { setErr("Need at least 3 players here to cover the jobs."); return; }
    setErr(null);
    setSettings(s => ({ ...s, absent: nextAbsent }));
    await supabase.from("work_duty_settings").upsert({ team_name: team, sets: settings.sets, computer: settings.computer, absent: nextAbsent, updated_by: me, updated_at: new Date().toISOString() });
    await redealNext(nextAbsent);
  };
  const markDone = async () => {
    if (!next) return;
    setBusy(true);
    await supabase.from("work_duty_matches").update({ done: true, done_at: new Date().toISOString(), done_by: me }).eq("id", next.id);
    // If anyone was out, even the rest of the list back up; then deal the
    // new next one with today's absences still applied.
    const fresh = rows.map(r => r.id === next.id ? { ...r, done: true } : r);
    let upd = fresh;
    if (absent.length) {
      const doneL = fresh.filter(r => r.done), rest = fresh.filter(r => !r.done);
      const bal = balanceSeason([...doneL, ...rest].map(r => ({ assignments: r.assignments })), roster, { locked: new Set(doneL.map((_, i) => i)), iterations: 8000 }).slice(doneL.length);
      upd = [...doneL, ...rest.map((r, i) => ({ ...r, assignments: bal[i].assignments }))].sort((a, b) => a.seq - b.seq);
      await Promise.all(rest.map((r, i) => supabase.from("work_duty_matches").update({ assignments: bal[i].assignments }).eq("id", r.id)));
      await redealNext(absent, upd);
    }
    setBusy(false);
    if (fresh.filter(r => !r.done).length < 5) generate(false); else load();
  };
  const undoLast = async () => {
    const last = [...done].sort((a, b) => b.seq - a.seq)[0]; if (!last) return;
    await supabase.from("work_duty_matches").update({ done: false, done_at: null, done_by: null }).eq("id", last.id);
    load();
  };
  const saveFormat = async (patch) => {
    const s = { ...settings, ...patch };
    setSettings(s);
    await supabase.from("work_duty_settings").upsert({ team_name: team, sets: s.sets, computer: s.computer, absent: s.absent || [], updated_by: me, updated_at: new Date().toISOString() });
  };

  if (!teamNames.length) return <div style={{ padding: 24, color: C.mut }}>You're not on a team's staff yet.</div>;
  if (!settings) return <div style={{ padding: 24, color: C.mut }}>Loading…</div>;
  const counts = tally(done);
  const roles = ["book", "libero", "line", "flip", ...(settings.computer ? ["comp"] : [])];
  const A = next?.assignments || {};
  const hasComp = (A.sets || []).some(s => "comp" in s);
  const box = { background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 14, marginBottom: 14 };
  const job = (label, who, sub) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: C.bg, borderRadius: 10 }}>
      <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 700 }}>{label}</div>{sub && <div style={{ fontSize: 11, color: C.mut }}>{sub}</div>}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: C.gold }}>{who}</div>
    </div>
  );

  return (
    <div style={{ padding: "16px 16px 40px", maxWidth: 820, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.gold }}>Work Duty</h2>
          <div style={{ fontSize: 12, color: C.mut }}>Next work assignment for your team — fair all season. Everyone does every job.</div>
        </div>
        <select value={team} onChange={e => setTeam(e.target.value)} style={{ background: "#0f0f0f", border: "1px solid " + C.border, borderRadius: 8, color: C.text, fontFamily: "inherit", fontSize: 14, fontWeight: 800, padding: "8px 10px" }}>{teamNames.map(t => <option key={t}>{t}</option>)}</select>
      </div>
      {err && <div style={{ color: C.red, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{err}</div>}

      <div style={box}>
        <div style={{ fontSize: 11, fontWeight: 800, color: C.mut, textTransform: "uppercase", marginBottom: 8 }}>Who's here? Untick anyone not at this tournament</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 6 }}>
          {roster.map(p => { const on = !absent.includes(String(p.id)); return (
            <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: on ? C.bg : "rgba(239,68,68,0.10)", border: "1px solid " + (on ? C.border : C.red), cursor: "pointer", fontSize: 14, fontWeight: 700, color: on ? C.text : C.red }}>
              <input type="checkbox" checked={on} onChange={() => toggleHere(p.id)} style={{ width: 18, height: 18, accentColor: C.gold }} />
              <span style={{ textDecoration: on ? "none" : "line-through" }}>{nm(p.id)}</span>
            </label>); })}
        </div>
        <div style={{ fontSize: 11, color: C.mut, marginTop: 6 }}>{here.length} of {roster.length} working{absent.length ? " · unticked players get no jobs until you tick them back" : ""}</div>
      </div>

      {!rows.length ? (
        <div style={{ ...box, textAlign: "center" }}>
          <div style={{ fontSize: 14, color: C.mut, marginBottom: 12 }}>No work assignments for {team} yet.</div>
          <button disabled={busy} onClick={() => generate(false)} style={btn()}>{busy ? "Dealing…" : "Generate assignments"}</button>
        </div>
      ) : next ? (
        <div style={{ ...box, borderColor: C.gold }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.gold, textTransform: "uppercase", letterSpacing: 0.5 }}>Next work assignment</div>
              <div style={{ fontSize: 22, fontWeight: 900 }}>#{next.seq}</div>
            </div>
            <button disabled={busy} onClick={() => redealNext(absent)} style={btn("ghost")}>↻ Re-deal</button>
            <button disabled={busy} onClick={markDone} style={btn("green")}>✓ Done — next</button>
          </div>
          <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
            {job(ROLE_LABEL.book, nm(A.book), "All match")}
            {job(ROLE_LABEL.libero, nm(A.libero), "All match")}
          </div>
          {(A.sets || []).map((s, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.mut, textTransform: "uppercase", margin: "6px 2px 4px" }}>Set {i + 1}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 6 }}>
                {SET_SLOTS.filter(([k]) => k !== "comp" || hasComp).map(([k, , label]) => <div key={k}>{job(label, nm(s[k]))}</div>)}
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 12, fontSize: 11, color: C.mut, marginTop: 8, flexWrap: "wrap" }}>
            <span>{done.length} done · {todo.length - 1} more after this one</span>
            {done.length > 0 && <button onClick={undoLast} style={{ background: "none", border: "none", color: C.mut, textDecoration: "underline", cursor: "pointer", fontSize: 11, fontFamily: "inherit", padding: 0 }}>undo last Done</button>}
          </div>
        </div>
      ) : (
        <div style={{ ...box, textAlign: "center" }}><button disabled={busy} onClick={() => generate(false)} style={btn()}>{busy ? "Dealing…" : "Generate more assignments"}</button></div>
      )}

      {rows.length > 0 && (
        <div style={box}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.mut, textTransform: "uppercase", marginBottom: 6 }}>Jobs worked so far</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
              <thead><tr><th style={{ textAlign: "left", padding: 5, color: C.mut, fontSize: 10 }}>Player</th>{roles.map(r => <th key={r} style={{ padding: 5, color: C.mut, fontSize: 10 }}>{ROLE_SHORT[r]}</th>)}<th style={{ padding: 5, color: C.gold, fontSize: 10 }}>Total</th></tr></thead>
              <tbody>{roster.map(p => { const c = counts[String(p.id)] || {}; return (
                <tr key={p.id} style={{ borderTop: "1px solid " + C.border }}><td style={{ padding: 5, fontWeight: 700 }}>{nm(p.id)}</td>{roles.map(r => <td key={r} style={{ padding: 5, textAlign: "center" }}>{c[r] || 0}</td>)}<td style={{ padding: 5, textAlign: "center", fontWeight: 800, color: C.gold }}>{c.total || 0}</td></tr>); })}</tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginTop: 12, fontSize: 12, color: C.mut }}>
            <label>Sets <select value={settings.sets} onChange={e => saveFormat({ sets: +e.target.value })} style={{ background: "#0f0f0f", color: C.text, border: "1px solid " + C.border, borderRadius: 6 }}>{[2, 3].map(n => <option key={n}>{n}</option>)}</select></label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={!!settings.computer} onChange={e => saveFormat({ computer: e.target.checked })} style={{ accentColor: C.gold }} /> Computer scorekeeper</label>
            <div style={{ flex: 1 }} />
            <button disabled={busy} onClick={() => { if (window.confirm("Re-deal every assignment that isn't done yet? (Done ones stay and count.)")) generate(true); }} style={{ ...btn("ghost"), padding: "6px 10px", fontSize: 12 }}>Re-deal all upcoming</button>
          </div>
        </div>
      )}
    </div>
  );
}
