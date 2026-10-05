// Repeat physical testing (Coach Brandon / Reach).
//   <PlayerStatHistory player={p} />  — on the player card: tryout baseline,
//                                       every test since, change from baseline
//   <StatsLinks session={session} />   — every team's no-login testing link
// Tests come from the /stats team links (api/stats-form.js) → player_stat_tests.

import { useState, useEffect } from "react";
import { supabase } from "./supabase";

const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", red: "#ef4444", grn: "#22c55e" };
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const f1 = (n) => n == null ? "—" : String(+n.toFixed(1));
const fmtDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
// [key, label, unit, higherIsBetter]
const COLS = [["stand_reach", "Stand & reach", '"', true], ["approach_touch", "Jump approach", '"', true], ["standing_touch", "Standing jump", '"', true], ["vertical", "Vertical", '"', true], ["broad_jump", "Broad jump", '"', true], ["dash_10y", "10 yd", "s", false]];

export function PlayerStatHistory({ player }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (!player?.id) return;
    let live = true;
    supabase.from("player_stat_tests").select("*").eq("player_id", player.id).order("test_date").then(({ data }) => { if (live) setRows(data || []); });
    return () => { live = false; };
  }, [player?.id]);
  if (!rows) return null;
  const sr = num(player.stand_reach), ap = num(player.approach_touch);
  const tryout = { label: "Tryout", stand_reach: sr, approach_touch: ap, standing_touch: num(player.jump_touch), vertical: sr != null && ap != null ? ap - sr : null, broad_jump: null, dash_10y: num(player.sprint_10y) };
  const tests = rows.map(r => ({ label: fmtDate(r.test_date), by: r.recorded_by, ...Object.fromEntries(COLS.map(([k]) => [k, num(r[k])])) }));
  const all = [tryout, ...tests];
  if (!tests.length && !COLS.some(([k]) => tryout[k] != null)) return null;
  const first = (k) => all.find(x => x[k] != null)?.[k] ?? null;
  const lastV = (k) => [...all].reverse().find(x => x[k] != null)?.[k] ?? null;
  const th = { textAlign: "left", fontSize: 10, color: C.mut, fontWeight: 800, padding: "4px 8px", textTransform: "uppercase", whiteSpace: "nowrap" };
  const td = { fontSize: 13, padding: "5px 8px", borderTop: "1px solid " + C.border, whiteSpace: "nowrap" };
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: C.mut, marginBottom: 6 }}>Testing progress {tests.length ? `· ${tests.length} test${tests.length === 1 ? "" : "s"} since tryouts` : "· no tests since tryouts yet"}</div>
      <div style={{ background: C.bg, borderRadius: 10, padding: 8, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th style={th}></th>{COLS.map(([k, l]) => <th key={k} style={th}>{l}</th>)}</tr></thead>
          <tbody>
            {all.map((r, i) => (
              <tr key={i}>
                <td style={{ ...td, color: C.mut, fontSize: 12 }} title={r.by ? "Tested by " + r.by : ""}>{r.label}</td>
                {COLS.map(([k, , u]) => <td key={k} style={{ ...td, fontWeight: k === "vertical" ? 800 : 600, color: r[k] == null ? C.mut : C.text }}>{r[k] == null ? "—" : f1(r[k]) + u}</td>)}
              </tr>
            ))}
            {tests.length > 0 && (
              <tr>
                <td style={{ ...td, color: C.gold, fontSize: 11, fontWeight: 800 }}>Change</td>
                {COLS.map(([k, , u, up]) => { const a = first(k), b = lastV(k); if (a == null || b == null || all.filter(x => x[k] != null).length < 2) return <td key={k} style={{ ...td, color: C.mut }}>—</td>; const d = b - a, good = up ? d > 0 : d < 0; return <td key={k} style={{ ...td, fontWeight: 800, color: Math.abs(d) < 0.05 ? C.mut : good ? C.grn : C.red }}>{d > 0 ? "+" : ""}{f1(d)}{u}</td>; })}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10, color: C.mut, marginTop: 4 }}>Vertical = jump approach − stand &amp; reach. Change compares the first result on file with the latest.</div>
    </div>
  );
}

export function StatsLinks({ session }) {
  const [links, setLinks] = useState(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  useEffect(() => {
    (async () => {
      try { const r = await fetch("/api/stats-form?links=1", { headers: { Authorization: "Bearer " + (session?.access_token || "") } }); const d = await r.json(); if (!r.ok) throw new Error(d.error || r.statusText); setLinks(d.links); }
      catch (e) { setErr(e.message); }
    })();
  }, [session?.access_token]);
  const copy = async (team, url) => { try { await navigator.clipboard.writeText(url); setCopied(team); setTimeout(() => setCopied(""), 1500); } catch { window.prompt("Copy this link:", url); } };
  return (
    <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 12, marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.gold, marginBottom: 4 }}>Coach testing links (no login)</div>
      <div style={{ fontSize: 11, color: C.mut, marginBottom: 8 }}>One link per team — send it to Coach Brandon. It lists the team's players; numbers he saves show on each player card under Testing progress.</div>
      {err && <div style={{ color: C.red, fontSize: 12 }}>{err}</div>}
      {!links && !err && <div style={{ color: C.mut, fontSize: 12 }}>Loading…</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 6 }}>
        {(links || []).map(l => (
          <div key={l.team} style={{ display: "flex", alignItems: "center", gap: 6, background: C.bg, border: "1px solid " + C.border, borderRadius: 8, padding: "6px 8px" }}>
            <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{l.team}</span>
            <a href={l.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.mut }}>open</a>
            <button onClick={() => copy(l.team, l.url)} style={{ fontSize: 11, fontWeight: 800, padding: "3px 8px", borderRadius: 6, border: "1px solid " + C.gold, background: copied === l.team ? C.gold : "transparent", color: copied === l.team ? "#000" : C.gold, cursor: "pointer", fontFamily: "inherit" }}>{copied === l.team ? "Copied" : "Copy"}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
