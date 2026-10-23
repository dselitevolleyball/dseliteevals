// Repeat physical testing (Coach Brandon / Reach).
//   <PlayerStatHistory player={p} players={players} />
//        on the player card: her baseline (labelled with the day it was
//        measured), every test since, change from baseline, and red/amber
//        marks on numbers that look like data-entry slips
//   <StatsLinks session={session} />   — every team's no-login testing link
// Tests come from the /stats team links (api/stats-form.js) → player_stat_tests.
// The rows, change and flags all come from shared/stat-report.js — the same
// walk the Testing Reports screen and the family email use, so the card can
// never disagree with what HQ holds back or what a family is sent.

import { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabase";
import { statResultRows, metricRows, statFlags, reviewFlags, statPeerStats, fmtMetric, fmtChange, METRICS, BUILT_IN_METRICS, gainMin } from "../shared/stat-report.js";
import { loadStatMetrics } from "./statMetrics.js";

const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", red: "#ef4444", grn: "#22c55e", amb: "#f59e0b" };
// Staff see raw inches to the hundredth (90.16", the same unit as the tryout
// boxes just above and the flag reasons); the 10-yard keeps hundredths too.
// Drew, Oct 12 2026: "make sure the change is two decimal points like 3.14".
// Rounded by the shared builder, not Math.round: fmtMetric prints a vertical
// and the 10-yard as plain hundredths with its float-safe half-up rounding, so
// every key borrows those branches. Math.round put Elizabeth Stanley's 98.425 −
// 83 (= 15.42499…) on the card as 15.42" while her email said 15.43", and a
// retest to 17.50" then read "+2.07"" beside a visible 2.08 gap (Oct 12 2026).
const LENGTHS = ["stand_reach", "approach_touch", "standing_touch", "vertical", "broad_jump"];
const fk = (k, n) => fmtMetric(LENGTHS.includes(k) ? "vertical" : k, n);
// [key, label, higherIsBetter]: the built-ins, then the tests added in HQ
// (Reach Stats → Tests), read from METRICS once loadStatMetrics has run.
const BASE_COLS = [["stand_reach", "Stand & reach", true], ["approach_touch", "Jump approach", true], ["standing_touch", "Standing jump", true], ["vertical", "Vertical", true], ["broad_jump", "Broad jump", true], ["dash_10y", "10 yd", false], ["sprint_mph", "Sprint mph", true]];
const colsNow = () => [...BASE_COLS, ...METRICS.filter(m => !BUILT_IN_METRICS.includes(m[0])).map(([k, l, , up]) => [k, l, up])];

// players (optional) = the club list from App: with it the card loads every
// test on file so the "unusual for her age group" check (amber) matches HQ's
// Check these numbers panel; without it only her own tests load and that one
// check is skipped.
export function PlayerStatHistory({ player, players }) {
  const [tests, setTests] = useState(null);
  const [sel, setSel] = useState(null);
  const [reviews, setReviews] = useState([]);   // accepted / ignored flags (Testing Reports) don't show here
  const club = !!players;
  useEffect(() => {
    if (!player?.id) return;
    let live = true;
    let q = supabase.from("player_stat_tests").select("*");
    if (!club) q = q.eq("player_id", player.id);
    Promise.all([q.order("test_date"), loadStatMetrics()]).then(([{ data }]) => { if (live) setTests(data || []); });
    supabase.from("stat_flag_reviews").select("player_id, flag_id, decision").eq("player_id", player.id).then(({ data }) => { if (live) setReviews(data || []); });
    return () => { live = false; };
  }, [player?.id, club]);
  const mine = useMemo(() => (tests || []).filter(t => t.player_id === player?.id), [tests, player?.id]);
  const peers = useMemo(() => (players && tests ? statPeerStats(players.filter(x => (x.season || "") === (player?.season || "")), tests) : null), [players, tests, player?.season]);
  if (!tests || !player) return null;
  const COLS = colsNow(), LABEL = Object.fromEntries(COLS.map(([k, l]) => [k, l]));
  const all = statResultRows(player, mine).filter(r => COLS.some(([k]) => r[k] != null));
  if (!all.length) return null;
  const flags = reviewFlags(statFlags(player, mine, { peers }), reviews, player.id).open;
  const change = new Map(metricRows(player, mine).filter(r => r.latest != null).map(r => [r.key, r.change]));
  // Results after the baseline (a girl with no tryout numbers has her first test as baseline).
  const nTests = all.length - 1;
  const byOf = (r) => mine.find(t => "test:" + t.id === r.row)?.recorded_by || "";
  const th = { textAlign: "left", fontSize: 10, color: C.mut, fontWeight: 800, padding: "4px 8px", textTransform: "uppercase", whiteSpace: "nowrap" };
  const td = { fontSize: 13, padding: "5px 8px", borderTop: "1px solid " + C.border, whiteSpace: "nowrap" };
  const flagC = (fl) => fl.some(f => f.level === "red") ? C.red : C.amb;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: C.mut, marginBottom: 6 }}>
        Testing progress · baseline {all[0].from}{all[0].tryout ? "" : " (first test)"} {nTests ? `· ${nTests} test${nTests === 1 ? "" : "s"} since` : "· no tests since yet"}
        {flags.length > 0 && <span style={{ color: flagC(flags), marginLeft: 6 }}>· ⚑ {flags.length} to check</span>}
      </div>
      <div style={{ background: C.bg, borderRadius: 10, padding: 8, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th style={th}></th>{COLS.map(([k, l]) => <th key={k} style={th}>{l}</th>)}</tr></thead>
          <tbody>
            {all.map(r => (
              <tr key={r.row}>
                <td style={{ ...td, color: C.mut, fontSize: 12 }} title={r.tryout ? (r.date ? "Tryout baseline, measured " + r.from : "Tryout baseline (measuring date not known)") : byOf(r) ? "Tested by " + byOf(r) : ""}>{r.from}</td>
                {COLS.map(([k]) => {
                  const fl = flags.filter(f => f.row === r.row && f.key === k), on = sel === r.row + "|" + k;
                  const tip = [k === "vertical" || k === "broad_jump" || k === "dash_10y" || r[k] == null ? "" : fmtMetric(k, r[k]), ...fl.map(f => "⚑ " + f.reason)].filter(Boolean).join("\n");
                  return <td key={k} title={tip} onClick={fl.length ? () => setSel(on ? null : r.row + "|" + k) : undefined}
                    style={{ ...td, fontWeight: k === "vertical" ? 800 : 600, color: r[k] == null ? C.mut : fl.length ? flagC(fl) : C.text, cursor: fl.length ? "pointer" : "default", ...(fl.length ? { outline: "2px solid " + flagC(fl), outlineOffset: -3, borderRadius: 4 } : {}) }}>
                    {fk(k, r[k])}{fl.length ? " ⚑" : ""}</td>;
                })}
              </tr>
            ))}
            {nTests > 0 && (
              <tr>
                <td style={{ ...td, color: C.gold, fontSize: 11, fontWeight: 800 }}>Change</td>
                {COLS.map(([k, , up]) => {
                  const d = change.get(k);
                  if (d == null) return <td key={k} style={{ ...td, color: C.mut }}>—</td>;
                  // Same noise floor as the email's "better": a quarter inch, two hundredths of a second, 0.2 mph.
                  const good = up ? d > 0 : d < 0, noise = Math.abs(d) < gainMin(k);
                  return <td key={k} style={{ ...td, fontWeight: 800, color: noise ? C.mut : good ? C.grn : C.red }}>{fmtChange(k, d)}</td>;
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {flags.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {flags.map((f, i) => (
            <div key={i} onClick={() => setSel(sel === f.row + "|" + f.key ? null : f.row + "|" + f.key)} style={{ display: "flex", gap: 6, fontSize: 11, lineHeight: 1.4, padding: "3px 6px", borderRadius: 6, cursor: "pointer", color: f.level === "red" ? C.red : C.amb, background: sel === f.row + "|" + f.key ? "rgba(255,255,255,0.06)" : "transparent" }}>
              <span>⚑</span><span><b>{f.from} · {LABEL[f.key]}:</b> <span style={{ color: C.text }}>{f.reason}</span></span>
            </div>
          ))}
          <div style={{ fontSize: 10, color: C.mut, marginTop: 2 }}>⚑ = looks like a data-entry slip (red: likely wrong; amber: double-check). Staff only — never shown to families, and a flagged number stays out of her testing email until it's fixed or ticked back in under Testing Reports.</div>
        </div>
      )}
      <div style={{ fontSize: 10, color: C.mut, marginTop: 4 }}>Inches and seconds to the hundredth. Vertical = jump approach − stand &amp; reach. Change compares the first result on file with the latest.</div>
    </div>
  );
}

export function StatsLinks({ session }) {
  const [links, setLinks] = useState(null);
  const [allUrl, setAllUrl] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  useEffect(() => {
    (async () => {
      try { const r = await fetch("/api/stats-form?links=1", { headers: { Authorization: "Bearer " + (session?.access_token || "") } }); const d = await r.json(); if (!r.ok) throw new Error(d.error || r.statusText); setLinks(d.links); setAllUrl(d.allUrl || ""); }
      catch (e) { setErr(e.message); }
    })();
  }, [session?.access_token]);
  const copy = async (team, url) => { try { await navigator.clipboard.writeText(url); setCopied(team); setTimeout(() => setCopied(""), 1500); } catch { window.prompt("Copy this link:", url); } };
  return (
    <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 12, marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.gold, marginBottom: 4 }}>Coach testing links (no login)</div>
      <div style={{ fontSize: 11, color: C.mut, marginBottom: 8 }}>One link per team — send it to Coach Brandon. It lists the team's players; numbers he saves show on each player card under Testing progress.</div>
      {err && <div style={{ color: C.red, fontSize: 12 }}>{err}</div>}
      {allUrl && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(233,30,140,0.08)", border: "1px solid " + C.gold, borderRadius: 8, padding: "8px 10px", marginBottom: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 800 }}>All teams (Brandon picks the team)</span>
          <span style={{ fontSize: 11, color: C.mut, flex: 1, minWidth: 160 }}>One link for every team — this is the one to send.</span>
          <a href={allUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.mut }}>open</a>
          <button onClick={() => copy("*", allUrl)} style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, border: "1px solid " + C.gold, background: copied === "*" ? C.gold : "transparent", color: copied === "*" ? "#000" : C.gold, cursor: "pointer", fontFamily: "inherit" }}>{copied === "*" ? "Copied" : "Copy"}</button>
        </div>
      )}
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
