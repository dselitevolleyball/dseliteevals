// Day Schedule — one day of practice, hour by hour: which teams are on, which
// coaches are really with each one (subs in, call-outs struck through), and a
// list of what's wrong at the top. Read-only; coverage is edited on Practice →
// Daily. Data comes from /api/day-schedule, the same builder that writes the
// Saturday email, so the screen and the email always agree.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";

const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", red: "#ef4444", grn: "#22c55e", amber: "#f59e0b", cyan: "#06b6d4", violet: "#a78bfa" };
const localISO = (d) => { const x = d ? new Date(d) : new Date(); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return localISO(d); };
const nextSunday = (iso) => addDays(iso, (7 - new Date(iso + "T12:00:00").getDay()) % 7);
const pretty = (iso) => new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const hr12 = (h) => { const w = Math.floor(h), mm = Math.round((h - w) * 60); const x = w % 12 === 0 ? 12 : w % 12; return x + (mm ? ":" + String(mm).padStart(2, "0") : ""); };
const fmtSpan = (s, e) => hr12(s) + (s < 12 && e >= 12 ? "am" : "") + "–" + hr12(e) + (e >= 12 ? "pm" : "am");
const btn = { padding: "6px 12px", borderRadius: 8, border: "1px solid " + C.border, background: "transparent", color: C.text, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const LEVEL = { critical: { c: C.red, bg: "rgba(239,68,68,0.10)", t: "Needs fixing" }, warn: { c: C.amber, bg: "rgba(245,158,11,0.10)", t: "Worth checking" }, info: { c: C.mut, bg: "rgba(255,255,255,0.03)", t: "Subs & changes already handled" } };

export default function DaySchedule({ session, onOpenPractice, onCoachesChanged }) {
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

  // One-day subs, the same record Practice → Daily writes (practice_coverage:
  // date + team + coach out + sub). The team's regular staff never changes here.
  const [subbing, setSubbing] = useState(null);   // { team, name }
  const [saving, setSaving] = useState(false);
  const [names, setNames] = useState([]);
  useEffect(() => {
    if (!subbing || names.length) return;
    (async () => {
      const [r, t] = await Promise.all([
        supabase.from("coach_roster").select("first_name, last_name"),
        supabase.from("practice_teams").select("head_coach, assistant_coach, third_coach"),
      ]);
      const seen = new Map();
      const put = (n) => { const v = String(n || "").trim(); if (v && !/assistant coach$|head coach$|floater coach|^tbd$/i.test(v) && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v); };
      (r.data || []).forEach(x => put(((x.first_name || "") + " " + (x.last_name || "")).trim()));
      (t.data || []).forEach(x => { put(x.head_coach); put(x.assistant_coach); put(x.third_coach); });
      setNames([...seen.values()].sort((a, b) => a.localeCompare(b)));
    })();
  }, [subbing, names.length]);
  // Who is already coaching somewhere else during this team's hours.
  const busyAt = (t) => {
    const busy = new Set();
    for (const c of day?.coaches || []) if (c.shifts.some(s => s.team !== t.team && t.blocks.some(([a, b]) => s.start < b && s.end > a))) busy.add(c.name.toLowerCase());
    return busy;
  };
  const saveSub = async (t, coachOut, sub) => {
    setSaving(true);
    const del = await supabase.from("practice_coverage").delete().eq("practice_date", date).eq("team_name", t.team).eq("coach_out", coachOut);
    const ins = del.error ? del : await supabase.from("practice_coverage").insert({ practice_date: date, team_name: t.team, slot: (t.slots || [])[0] || null, phase: day.phase, coach_out: coachOut, sub_name: (sub || "").trim() || null, combine_with_team: null });
    setSaving(false);
    if (ins.error) { window.alert("Couldn't save the sub: " + ins.error.message); return; }
    setSubbing(null); await load(); onCoachesChanged?.();
  };
  const clearSub = async (t, coachOut) => {
    setSaving(true);
    const { error } = await supabase.from("practice_coverage").delete().eq("practice_date", date).eq("team_name", t.team).eq("coach_out", coachOut);
    setSaving(false);
    if (error) { window.alert("Couldn't clear: " + error.message); return; }
    await load(); onCoachesChanged?.();
  };
  const subPicker = (t, c) => {
    const busy = busyAt(t);
    return (
      <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap", margin: "2px 0 4px 36px" }}>
        <select autoFocus disabled={saving} defaultValue="" onChange={e => {
            const v = e.target.value; if (v === "") return;
            if (v === "__none") return saveSub(t, c.name, null);
            if (v === "__other") { const n = window.prompt("Sub's name:", ""); if (n && n.trim()) saveSub(t, c.name, n.trim()); return; }
            saveSub(t, c.name, v);
          }}
          style={{ flex: 1, minWidth: 140, background: C.card, color: C.text, border: "1px solid " + C.gold, borderRadius: 6, padding: "4px 6px", fontSize: 12, fontFamily: "inherit" }}>
          <option value="">Who's subbing for {c.name.split(" ")[0]}?</option>
          <option value="__none">No sub — just mark out</option>
          {names.filter(n => n.toLowerCase() !== c.name.toLowerCase()).map(n => <option key={n} value={n}>{n}{busy.has(n.toLowerCase()) ? " (busy then)" : ""}</option>)}
          <option value="__other">＋ Someone else…</option>
        </select>
        <button onClick={() => setSubbing(null)} style={{ ...btn, padding: "3px 8px", fontSize: 11 }}>Cancel</button>
      </div>
    );
  };
  const smallBtn = (color) => ({ background: "transparent", border: "1px solid " + color, color, borderRadius: 6, padding: "0 6px", fontSize: 10, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" });
  const isSubbing = (t, c) => !!(subbing && subbing.team === t.team && subbing.name === c.name);

  // Updated-plan texts: whose plan for this day differs from the last thing
  // they were told (or the Saturday baseline).
  const [pick, setPick] = useState({});
  const [showAll, setShowAll] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const plans = day?.plans || [];
  const textable = (p) => !!p.phone && !p.optedOut;
  useEffect(() => { setPick(Object.fromEntries((day?.plans || []).filter(p => p.changed && p.phone && !p.optedOut).map(p => [p.key, true]))); }, [day]);
  const sendTexts = async () => {
    const keys = Object.keys(pick).filter(k => pick[k]);
    if (!keys.length) return;
    if (!window.confirm("Text " + keys.length + " coach" + (keys.length === 1 ? "" : "es") + " their updated plan for " + pretty(date) + "?")) return;
    setSending(true);
    try {
      const r = await fetch("/api/day-schedule", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token }, body: JSON.stringify({ date, keys }) });
      const o = await r.json();
      if (!r.ok) throw new Error(o.error || "HTTP " + r.status);
      setSendResult(o); await load();
    } catch (e) { window.alert("Couldn't send: " + e.message); }
    setSending(false);
  };
  const changedCount = plans.filter(p => p.changed).length;
  const planPanel = plans.length > 0 && (
    <div style={{ padding: "10px 14px", borderRadius: 10, background: C.card, border: "1px solid " + (changedCount ? C.cyan : C.border), marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <b style={{ color: changedCount ? C.cyan : C.mut, fontSize: 13 }}>{changedCount ? changedCount + " coach" + (changedCount === 1 ? "'s" : "es'") + " plan changed" : "No plan changes to text"}</b>
        <span style={{ fontSize: 11, color: C.mut }}>since the Saturday schedule or their last update text</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowAll(v => !v)} style={{ ...btn, padding: "3px 8px", fontSize: 11 }}>{showAll ? "Only changed" : "Show everyone"}</button>
        <button disabled={sending || !Object.values(pick).some(Boolean) || !day.smsReady} onClick={sendTexts}
          style={{ ...btn, background: Object.values(pick).some(Boolean) ? C.cyan : "transparent", color: Object.values(pick).some(Boolean) ? "#000" : C.mut, border: "1px solid " + C.cyan }}>
          {sending ? "Sending…" : "Text " + Object.values(pick).filter(Boolean).length + " updated plan" + (Object.values(pick).filter(Boolean).length === 1 ? "" : "s")}</button>
      </div>
      {plans.filter(p => showAll || p.changed).map(p => {
        const now = p.body ? p.body.split("\n") : [];
        const gone = (p.known || "").split("\n").filter(l => l && !now.includes(l));
        return (
          <label key={p.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", borderTop: "1px solid " + C.border, marginTop: 6, cursor: textable(p) ? "pointer" : "default" }}>
            <input type="checkbox" disabled={!textable(p)} checked={!!pick[p.key]} onChange={e => setPick(v => ({ ...v, [p.key]: e.target.checked }))} style={{ marginTop: 3 }} />
            <div style={{ fontSize: 12, minWidth: 0 }}>
              <b>{p.name}</b>{!p.phone && <span style={{ color: C.amber }}> · no phone on the roster</span>}{p.optedOut && <span style={{ color: C.amber }}> · opted out of texts</span>}
              {p.lastKind === "sent" && <span style={{ color: C.mut }}> · last texted {new Date(p.lastAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>}
              <div style={{ color: C.text, whiteSpace: "pre-wrap" }}>{p.body || "Not coaching that day"}</div>
              {p.changed && gone.length > 0 && <div style={{ color: C.mut, textDecoration: "line-through", whiteSpace: "pre-wrap" }}>{gone.join("\n")}</div>}
            </div>
          </label>
        );
      })}
      {sendResult && <div style={{ fontSize: 12, marginTop: 8, color: C.grn }}>Sent {sendResult.sent}.{sendResult.results.filter(r => !r.ok).map(r => " " + r.name + ": " + r.error + ".").join("")}</div>}
      {!day.smsReady && <div style={{ fontSize: 11, color: C.amber, marginTop: 6 }}>Texting isn't configured on the server.</div>}
    </div>
  );

  const teamBy = new Map((day?.teams || []).map(t => [t.team, t]));
  const critTeams = new Set((day?.issues || []).filter(i => i.level === "critical").map(i => i.team).filter(Boolean));
  const byLevel = (l) => (day?.issues || []).filter(i => i.level === l);

  const coachList = (t) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
      {t.coaches.map((c, i) => {
        const tag = <span style={{ fontSize: 9, fontWeight: 800, color: C.mut, textTransform: "uppercase", width: 30, flexShrink: 0 }}>{c.role}</span>;
        if (c.status === "on") return (
          <div key={i}>
            <div style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "center" }}>{tag}<span>{c.name}</span>
              {!isSubbing(t, c) && <button title={"Mark " + c.name + " out on this day and pick a sub"} onClick={() => setSubbing({ team: t.team, name: c.name })} style={smallBtn(C.mut)}>Sub</button>}
            </div>
            {isSubbing(t, c) && subPicker(t, c)}
          </div>
        );
        if (c.status === "open") return <div key={i} style={{ display: "flex", gap: 6, fontSize: 12 }}>{tag}<span style={{ color: C.amber, fontWeight: 700 }}>Unfilled{c.name ? " (" + c.name + ")" : ""}</span></div>;
        return (
          <div key={i} style={{ display: "flex", gap: 6, fontSize: 12, flexWrap: "wrap" }}>{tag}
            <span style={{ color: C.red, textDecoration: "line-through" }}>{c.name}</span>
            {c.sub ? <span style={{ color: C.cyan, fontWeight: 700 }}>→ {c.sub}</span>
              : c.combined ? <span style={{ color: C.violet, fontWeight: 700 }}>combined w/ {c.combined}</span>
              : <span style={{ color: t.floor.length >= 2 ? C.mut : C.red, fontWeight: 800 }}>{t.floor.length >= 2 ? "no sub needed" : "NO SUB"}</span>}
            {c.why ? <span style={{ color: C.mut, fontSize: 11 }}>· {c.why}</span> : null}
            {!isSubbing(t, c) && <button onClick={() => setSubbing({ team: t.team, name: c.name })} style={smallBtn(C.cyan)}>{c.sub ? "Change sub" : "Add sub"}</button>}
            {c.cov && <button disabled={saving} title={c.name + " is coaching after all"} onClick={() => clearSub(t, c.name)} style={smallBtn(C.grn)}>Back in</button>}
            {isSubbing(t, c) && <div style={{ width: "100%" }}>{subPicker(t, c)}</div>}
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
        {planPanel}
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
