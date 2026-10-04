// Day Schedule — one day of practice, hour by hour: which teams are on, which
// coaches are really with each one (subs in, call-outs struck through), and a
// list of what's wrong at the top. Read-only; coverage is edited on Practice →
// Daily. Data comes from /api/day-schedule, the same builder that writes the
// Saturday email, so the screen and the email always agree.

import { useState, useEffect, useCallback } from "react";

const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", red: "#ef4444", grn: "#22c55e", amber: "#f59e0b", cyan: "#06b6d4", violet: "#a78bfa" };
const localISO = (d) => { const x = d ? new Date(d) : new Date(); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return localISO(d); };
const nextSunday = (iso) => addDays(iso, (7 - new Date(iso + "T12:00:00").getDay()) % 7);
const pretty = (iso) => new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const hr12 = (h) => { const w = Math.floor(h), mm = Math.round((h - w) * 60); const x = w % 12 === 0 ? 12 : w % 12; return x + (mm ? ":" + String(mm).padStart(2, "0") : ""); };
const fmtSpan = (s, e) => hr12(s) + (s < 12 && e >= 12 ? "am" : "") + "–" + hr12(e) + (e >= 12 ? "pm" : "am");
const btn = { padding: "6px 12px", borderRadius: 8, border: "1px solid " + C.border, background: "transparent", color: C.text, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const LEVEL = { critical: { c: C.red, bg: "rgba(239,68,68,0.10)", t: "Needs fixing" }, warn: { c: C.amber, bg: "rgba(245,158,11,0.10)", t: "Worth checking" }, info: { c: C.mut, bg: "rgba(255,255,255,0.03)", t: "Subs & changes already handled" } };

export default function DaySchedule({ session, onOpenPractice }) {
  const [date, setDate] = useState(() => {
    try { const d = sessionStorage.getItem("dse.dayschedule.date"); if (d) { sessionStorage.removeItem("dse.dayschedule.date"); return d; } } catch { /* ignore */ }
    const t = localISO(); const wd = new Date(t + "T12:00:00").getDay();
    // Fall/summer practice is Sunday-only, so a weekday opens on the coming Sunday.
    return wd === 0 || t >= "2026-11-29" ? t : nextSunday(t);
  });
  const [day, setDay] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("hour");
  const [showInfo, setShowInfo] = useState(false);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true); setErr("");
    try {
      const r = await fetch("/api/day-schedule?date=" + date, { headers: { Authorization: "Bearer " + session.access_token } });
      const o = await r.json();
      if (!r.ok) throw new Error(o.error || "HTTP " + r.status);
      setDay(o);
    } catch (e) { setErr(e.message); setDay(null); }
    setLoading(false);
  }, [date, session?.access_token]);
  useEffect(() => { load(); }, [load]);

  const teamBy = new Map((day?.teams || []).map(t => [t.team, t]));
  const critTeams = new Set((day?.issues || []).filter(i => i.level === "critical").map(i => i.team).filter(Boolean));
  const byLevel = (l) => (day?.issues || []).filter(i => i.level === l);

  const coachList = (t) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
      {t.coaches.map((c, i) => {
        const tag = <span style={{ fontSize: 9, fontWeight: 800, color: C.mut, textTransform: "uppercase", width: 30, flexShrink: 0 }}>{c.role}</span>;
        if (c.status === "on") return <div key={i} style={{ display: "flex", gap: 6, fontSize: 12 }}>{tag}<span>{c.name}</span></div>;
        if (c.status === "open") return <div key={i} style={{ display: "flex", gap: 6, fontSize: 12 }}>{tag}<span style={{ color: C.amber, fontWeight: 700 }}>Unfilled{c.name ? " (" + c.name + ")" : ""}</span></div>;
        return (
          <div key={i} style={{ display: "flex", gap: 6, fontSize: 12, flexWrap: "wrap" }}>{tag}
            <span style={{ color: C.red, textDecoration: "line-through" }}>{c.name}</span>
            {c.sub ? <span style={{ color: C.cyan, fontWeight: 700 }}>→ {c.sub}</span>
              : c.combined ? <span style={{ color: C.violet, fontWeight: 700 }}>combined w/ {c.combined}</span>
              : <span style={{ color: t.floor.length >= 2 ? C.mut : C.red, fontWeight: 800 }}>{t.floor.length >= 2 ? "no sub needed" : "NO SUB"}</span>}
            {c.why ? <span style={{ color: C.mut, fontSize: 11 }}>· {c.why}</span> : null}
          </div>
        );
      })}
    </div>
  );

  const teamCard = (t, starts) => {
    const bad = critTeams.has(t.team);
    if (!starts) return (
      <div key={t.team} style={{ padding: "6px 10px", borderRadius: 8, border: "1px dashed " + C.border, color: C.mut, fontSize: 12, minWidth: 150 }}>
        {t.team} <span style={{ fontSize: 11 }}>continues · {t.floor.map(p => p.name.split(" ")[0]).join(", ") || "no coach"}</span>
      </div>
    );
    return (
      <div key={t.team} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid " + (bad ? C.red : C.border), background: bad ? "rgba(239,68,68,0.08)" : C.bg, minWidth: 200, flex: "1 1 200px", maxWidth: 320 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
          <span style={{ fontWeight: 800, fontSize: 14, color: bad ? C.red : C.text }}>{t.team}</span>
          <span style={{ fontSize: 11, color: C.mut, whiteSpace: "nowrap" }}>{t.blocks.map(([s, e]) => fmtSpan(s, e)).join(", ")}{t.venue ? " · " + t.venue : ""}</span>
        </div>
        {coachList(t)}
        <div style={{ fontSize: 10, color: t.floor.length >= 2 ? C.grn : C.red, fontWeight: 800, marginTop: 4 }}>{t.floor.length} on the floor{t.combined ? " · combined with " + t.combined : ""}</div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 20, color: C.gold, marginRight: 8 }}>Day Schedule</h2>
        <button style={btn} onClick={() => setDate(addDays(date, -7))} title="Back a week">«</button>
        <button style={btn} onClick={() => setDate(addDays(date, -1))} title="Back a day">‹</button>
        <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} style={{ ...btn, colorScheme: "dark" }} />
        <button style={btn} onClick={() => setDate(addDays(date, 1))} title="Forward a day">›</button>
        <button style={btn} onClick={() => setDate(addDays(date, 7))} title="Forward a week">»</button>
        <button style={btn} onClick={() => setDate(localISO())}>Today</button>
        <button style={btn} onClick={() => setDate(nextSunday(addDays(localISO(), 1)))}>Next Sunday</button>
        <div style={{ flex: 1 }} />
        {[["hour", "By hour"], ["coach", "By coach"]].map(([k, l]) => (
          <button key={k} onClick={() => setMode(k)} style={{ ...btn, background: mode === k ? C.gold : "transparent", color: mode === k ? "#000" : C.text, border: "1px solid " + (mode === k ? C.gold : C.border) }}>{l}</button>
        ))}
        {onOpenPractice && <button style={btn} onClick={onOpenPractice} title="Mark coaches out and assign subs">Edit coverage →</button>}
      </div>

      <div style={{ color: C.mut, fontSize: 13, marginBottom: 12 }}>
        <b style={{ color: C.text }}>{pretty(date)}</b>
        {day && <> · {day.phaseLabel}{day.teams.length ? ` · ${day.teams.length} teams · ${day.coaches.length} coaches working` : ""}</>}
        {loading && " · loading…"}
      </div>
      {err && <div style={{ color: C.red, padding: 12 }}>Couldn't load: {err}</div>}

      {day && day.cancelled && <div style={{ padding: 14, borderRadius: 10, background: "rgba(239,68,68,0.12)", border: "1px solid " + C.red, fontWeight: 800 }}>Practice cancelled — {day.cancelled}</div>}
      {day && !day.cancelled && !day.teams.length && <div style={{ padding: 24, textAlign: "center", color: C.mut, background: C.card, borderRadius: 10, border: "1px solid " + C.border }}>No DS Elite practice on this day.{day.offTeams?.length ? " (" + day.offTeams.length + " teams away at tournaments.)" : ""}</div>}

      {day && !day.cancelled && day.teams.length > 0 && (<>
        {/* What's wrong, first. */}
        {byLevel("critical").length === 0 && <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(34,197,94,0.08)", border: "1px solid " + C.grn, color: C.grn, fontWeight: 800, fontSize: 13, marginBottom: 10 }}>✓ Every team has at least two coaches on the floor</div>}
        {["critical", "warn"].map(l => byLevel(l).length > 0 && (
          <div key={l} style={{ padding: "10px 14px", borderRadius: 10, background: LEVEL[l].bg, borderLeft: "4px solid " + LEVEL[l].c, marginBottom: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: LEVEL[l].c, marginBottom: 4 }}>{LEVEL[l].t} ({byLevel(l).length})</div>
            {byLevel(l).map((i, k) => <div key={k} style={{ fontSize: 13, padding: "2px 0" }}>• {i.text}</div>)}
          </div>
        ))}
        {byLevel("info").length > 0 && (
          <div style={{ padding: "8px 14px", borderRadius: 10, background: LEVEL.info.bg, border: "1px solid " + C.border, marginBottom: 10 }}>
            <button onClick={() => setShowInfo(v => !v)} style={{ background: "none", border: "none", color: C.mut, fontWeight: 800, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>{showInfo ? "▾" : "▸"} {LEVEL.info.t} ({byLevel("info").length})</button>
            {showInfo && byLevel("info").map((i, k) => <div key={k} style={{ fontSize: 12, color: C.mut, padding: "2px 0" }}>• {i.text}</div>)}
          </div>
        )}
        {day.offTeams.length > 0 && <div style={{ fontSize: 12, color: C.mut, marginBottom: 12 }}><b>Not practicing:</b> {day.offTeams.map(o => o.team + " (" + o.why + ")").join(" · ")}</div>}

        {mode === "hour" ? (
          <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, overflow: "hidden" }}>
            {day.hours.map(h => (
              <div key={h.hour} style={{ display: "flex", borderTop: "1px solid " + C.border }}>
                <div style={{ width: 92, flexShrink: 0, padding: "10px 12px", fontWeight: 800, color: C.gold, fontSize: 13 }}>{h.label}</div>
                <div style={{ flex: 1, padding: "8px 10px 8px 0", minWidth: 0 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {h.teams.length ? h.teams.map(x => teamCard(teamBy.get(x.team), x.starts)) : <span style={{ color: C.mut, fontSize: 12, padding: 4 }}>No practice</span>}
                  </div>
                  {(h.sa.length > 0 || h.floaters.length > 0) && (
                    <div style={{ fontSize: 11, color: C.mut, marginTop: 6 }}>
                      {h.sa.length > 0 && <span>S&A room: <b style={{ color: C.text }}>{h.sa.join(", ")}</b></span>}
                      {h.sa.length > 0 && h.floaters.length > 0 && " · "}
                      {h.floaters.length > 0 && <span>Floating: <b style={{ color: C.cyan }}>{h.floaters.join(", ")}</b></span>}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
              <thead><tr>
                <th style={{ textAlign: "left", padding: "8px 12px", color: C.mut, fontSize: 11, position: "sticky", left: 0, background: C.card, zIndex: 1 }}>Coach</th>
                {day.hours.map(h => <th key={h.hour} style={{ padding: "8px 6px", color: C.mut, fontSize: 11, whiteSpace: "nowrap" }}>{h.label.split("–")[0]}</th>)}
                <th style={{ padding: "8px 12px", color: C.mut, fontSize: 11 }}>Hrs</th>
              </tr></thead>
              <tbody>
                {day.coaches.map(c => (
                  <tr key={c.name} style={{ borderTop: "1px solid " + C.border }}>
                    <td style={{ padding: "6px 12px", whiteSpace: "nowrap", fontWeight: 600, position: "sticky", left: 0, background: C.card, zIndex: 1 }}>{c.name}</td>
                    {day.hours.map(h => {
                      const here = c.shifts.filter(s => s.start < h.hour + 1 && s.end > h.hour);
                      const dbl = here.length > 1;
                      return (
                        <td key={h.hour} style={{ padding: 3, textAlign: "center" }}>
                          {here.map((s, i) => <div key={i} title={s.role} style={{ fontSize: 10, fontWeight: 700, padding: "2px 5px", borderRadius: 5, whiteSpace: "nowrap", marginBottom: 1, background: dbl ? "rgba(239,68,68,0.2)" : /^Sub/.test(s.role) ? "rgba(6,182,212,0.18)" : "rgba(34,197,94,0.15)", color: dbl ? C.red : /^Sub/.test(s.role) ? C.cyan : C.grn }}>{s.team}</div>)}
                        </td>
                      );
                    })}
                    <td style={{ padding: "6px 12px", color: C.mut, textAlign: "center" }}>{Math.round(c.hours * 10) / 10}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: 11, color: C.mut, marginTop: 10 }}>Drew gets this by email every Saturday morning for Sunday. Red = a team below two coaches; cyan = sub; struck through = out.</div>
      </>)}
    </div>
  );
}
