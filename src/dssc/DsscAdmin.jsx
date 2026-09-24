// Dripping Springs Sports Club — Clinics & Camps, the admin board.
//
// What Hunter and Drew need at a glance: which classes still need a coach,
// which pickups are waiting on a yes, which pods hardly anyone has signed up
// for, and a fast way to put a coach on a class without opening anything.
// The week board is the working surface; the programs table is the overview;
// the old per-program editor stays behind "Program settings" for the fields
// that rarely change (name, times, location, template plan).

import { useState, useEffect, useMemo, useRef } from "react";
import Papa from "papaparse";
import { supabase } from "../supabase";
import { sessionStaff, staffNeeded, sessionShort, staffApproved, staffPending, parseClock, sessionHours, localDateISO, isPlaceholderPerson } from "../../shared/dssc-clinics.js";
import { DS, nrm, fmtDay, timeRange, hasClassPlan, Btn, Card, Label, Tag, inputStyle } from "./DsscHub.jsx";

const POD_CAP = 6;
const isPod = (c) => /pod/i.test(c?.category || "") || /pod/i.test(c?.name || "") || /^U1[135]/.test(c?.name || "");
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return localDateISO(d); };
const mondayOf = (iso) => { const d = new Date(iso + "T12:00:00"); return addDays(iso, -((d.getDay() + 6) % 7)); };
const sameDayWindow = (a, b) => a.date === b.date && a.st != null && a.en != null && b.st != null && b.en != null;

export default function DsscAdmin({
  coach, clinics = [], coachRoster = [], dsscAvail = [], podAttendance = [],
  setClinics, reloadClinics, staffDsscSession, unstaffDsscSession, decideDsscPickup,
  openClass, openProgram, newClinic, sync, onCoachHub, onCoverage, onTimeCards, onLegacy,
}) {
  const today = localDateISO();
  const coachName = coach?.display_name || coach?.email || "";
  const [weekOff, setWeekOff] = useState(0);
  const [filter, setFilter] = useState("all");       // all | short | low | pending | noplan
  const [q, setQ] = useState("");
  const [counts, setCounts] = useState(null);         // "cid|sid" -> signed up; "cid|*" -> program-wide
  const [busy, setBusy] = useState("");
  const [imp, setImp] = useState(null);               // registrations upload: {loading} | result | {error}
  const fileRef = useRef(null);
  const [countsTick, setCountsTick] = useState(0);
  // Playbook's registrations report, picked from disk, parsed here, attached
  // on the server. Same importer as the CLI script.
  const uploadRegistrations = (f) => {
    if (!f) return;
    setImp({ loading: true });
    Papa.parse(f, { header: true, skipEmptyLines: true, complete: async ({ data }) => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const r = await fetch("/api/dssc-roster-import", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify({ rows: data }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
        setImp(d); setCountsTick(t => t + 1);
      } catch (e) { setImp({ error: e.message }); }
      if (fileRef.current) fileRef.current.value = "";
    }, error: (e) => setImp({ error: e.message }) });
  };

  // Sign-ups per class. One light query; the roster table is a few thousand rows at most.
  useEffect(() => {
    let live = true;
    supabase.from("dssc_pod_roster").select("clinic_id, session_id").then(({ data }) => {
      if (!live) return;
      const m = {};
      for (const r of (data || [])) { const k = r.clinic_id + "|" + (r.session_id || "*"); m[k] = (m[k] || 0) + 1; }
      setCounts(m);
    });
    return () => { live = false; };
  }, [clinics.length, countsTick]);
  const signedUp = (c, s) => counts ? (counts[c.id + "|" + s.id] || 0) + (counts[c.id + "|*"] || 0) : null;

  // Every session, flattened, with the numbers the board sorts and colors by.
  const rows = useMemo(() => {
    const out = [];
    for (const c of clinics) for (const s of (Array.isArray(c.sessions) ? c.sessions : [])) {
      if (!s?.date) continue;
      out.push({ c, s, key: c.id + "|" + s.id, short: sessionShort(s, c), pending: staffPending(s), st: parseClock(s.start_time), en: parseClock(s.end_time) });
    }
    out.sort((a, b) => a.s.date.localeCompare(b.s.date) || ((a.st || 0) - (b.st || 0)));
    return out;
  }, [clinics]);
  const upcoming = rows.filter(r => r.s.date >= today);
  const soon = upcoming.filter(r => r.s.date <= addDays(today, 13));
  const pendingAll = upcoming.filter(r => r.pending.length);
  const lowOf = (r) => { const n = signedUp(r.c, r.s); return n != null && n <= 2; };
  const attention = {
    pending: pendingAll.reduce((n, r) => n + r.pending.length, 0),
    short: soon.filter(r => r.short > 0).length,
    low: soon.filter(lowOf).length,
    noplan: upcoming.filter(r => r.s.date <= addDays(today, 6) && !hasClassPlan(r.s)).length,
  };

  // ── Who could take a class ─────────────────────────────────────────────
  const pool = dsscAvail.filter(a => a.available && (a.coach_name || "").trim());
  const availBy = {}; dsscAvail.forEach(a => { availBy[nrm(a.coach_name)] = a; });
  const rosterNames = [...new Set(coachRoster.map(r => ((r.first_name || "") + " " + (r.last_name || "")).trim()).filter(n => n && !isPlaceholderPerson(n)))];
  const everyone = [...new Set([...pool.map(a => a.coach_name.trim()), ...rosterNames])].sort((a, b) => a.localeCompare(b));
  const commitments = useMemo(() => {
    const m = {};
    for (const r of rows) for (const x of sessionStaff(r.s)) { if (x.status === "declined") continue; (m[nrm(x.name)] = m[nrm(x.name)] || []).push({ date: r.s.date, st: r.st, en: r.en }); }
    return m;
  }, [rows]);
  const suggest = (r) => {
    const target = ((r.c.category || "") + " " + (r.c.age_group || "") + " " + (r.c.name || "")).toLowerCase();
    const on = new Set(sessionStaff(r.s).map(x => nrm(x.name)));
    const needLead = !staffApproved(r.s).some(x => x.role === "lead");
    return everyone.map(name => {
      const k = nrm(name); if (on.has(k)) return null;
      const a = availBy[k], mine = commitments[k] || [];
      if (mine.some(x => sameDayWindow(x, r) && r.st < x.en && x.st < r.en)) return null;   // clash
      const b2b = mine.some(x => x.date === r.s.date && ((x.en != null && x.en === r.st) || (x.st != null && x.st === r.en)));
      const sameDay = mine.some(x => x.date === r.s.date);
      const skills = ((a?.skills || "") + " " + (a?.note || "")).toLowerCase();
      const skill = !!skills.trim() && skills.split(/[\s,;/|]+/).some(w => w.length > 2 && target.includes(w));
      let score = 0; const why = [];
      if (a?.available) { score += 2; why.push("in pool"); }
      if (b2b) { score += 6; why.push("back-to-back"); } else if (sameDay) { score += 3; why.push("here that day"); }
      if (skill) { score += 3; why.push("skill fit"); }
      if (needLead && a?.can_lead) { score += 1; why.push("can lead"); }
      return score ? { name, score, why } : null;
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 5);
  };

  const assign = async (r, name) => {
    if (!name) return;
    setBusy(r.key);
    const role = staffApproved(r.s).some(x => x.role === "lead") ? "assist" : "lead";
    await staffDsscSession(r.c.id, r.s.id, name, role, "approved");
    setBusy("");
  };
  const decide = async (r, name, ok) => { setBusy(r.key); await decideDsscPickup(r.c.id, r.s.id, name, ok); setBusy(""); };
  const remove = async (r, name) => { if (!window.confirm("Take " + name + " off " + r.c.name + " on " + fmtDay(r.s.date, today) + "?")) return; setBusy(r.key); await unstaffDsscSession(r.c.id, r.s.id, name); setBusy(""); };
  const setNeeded = async (r, n) => {
    const next = (r.c.sessions || []).map(x => String(x.id) === String(r.s.id) ? { ...x, coaches_needed: n } : x);
    setClinics && setClinics(prev => prev.map(c => c.id === r.c.id ? { ...c, sessions: next } : c));
    const { error } = await supabase.from("dssc_clinics").update({ sessions: next, updated_by: coachName, updated_at: new Date().toISOString() }).eq("id", r.c.id);
    if (error) { window.alert("Couldn't save: " + error.message); reloadClinics && reloadClinics(); }
  };

  // ── Board rows for the chosen week + filter ────────────────────────────
  const weekStart = addDays(mondayOf(today), weekOff * 7), weekEnd = addDays(weekStart, 6);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (r) => [r.c.name, r.c.age_group, r.c.category, r.s.court, r.c.location, r.s.start_time, ...sessionStaff(r.s).map(x => x.name)].join(" ").toLowerCase();
  const board = rows.filter(r => {
    if (words.length) { const h = hay(r); if (!words.every(w => h.includes(w))) return false; }
    if (filter === "pending") return r.pending.length > 0 && r.s.date >= today;
    if (filter === "short") return r.short > 0 && r.s.date >= today;
    if (filter === "low") return lowOf(r) && r.s.date >= today;
    if (filter === "noplan") return !hasClassPlan(r.s) && r.s.date >= today;
    return r.s.date >= weekStart && r.s.date <= weekEnd;
  });
  const byDate = []; for (const r of board) { const g = byDate.find(x => x.date === r.s.date); if (g) g.rows.push(r); else byDate.push({ date: r.s.date, rows: [r] }); }
  const signupTag = (r) => {
    const n = signedUp(r.c, r.s); if (n == null) return null;
    const cap = isPod(r.c) ? POD_CAP : null;
    const col = n === 0 ? DS.orange : n <= 2 ? DS.orange : DS.lime;
    return <span title="Signed up (Playbook)" style={{ fontSize: 12, fontWeight: 800, color: n <= 2 ? DS.orange : DS.text, background: n <= 2 ? DS.orangeSoft : "rgba(255,255,255,0.07)", border: "1px solid " + (n <= 2 ? DS.orange : DS.line), borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>{n}{cap ? "/" + cap : ""} signed up</span>;
  };

  // ── Programs overview ─────────────────────────────────────────────────
  const programs = clinics.map(c => {
    const ss = (Array.isArray(c.sessions) ? c.sessions : []).filter(s => s?.date);
    const up = ss.filter(s => s.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const sign = up.map(s => signedUp(c, s)).filter(n => n != null);
    const avg = sign.length ? Math.round(sign.reduce((a, b) => a + b, 0) / sign.length * 10) / 10 : null;
    const staffed = up.filter(s => sessionShort(s, c) === 0).length;
    const leads = {}; up.forEach(s => staffApproved(s).forEach(x => { leads[x.name] = (leads[x.name] || 0) + 1; }));
    const lead = Object.entries(leads).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    return { c, ss, up, next: up[0]?.date || null, avg, staffed, lead, template: Array.isArray(c.plan?.blocks) && c.plan.blocks.some(b => String(b.name || "").trim()) };
  }).filter(p => p.up.length || !p.ss.length).sort((a, b) => (a.next || "9").localeCompare(b.next || "9"));

  const chip = (k, n, label, color) => (
    <button onClick={() => setFilter(filter === k ? "all" : k)} style={{ fontFamily: DS.font, fontSize: 12, fontWeight: 800, padding: "6px 11px", borderRadius: 999, cursor: "pointer", border: "1px solid " + (filter === k ? color : n ? color : DS.line), background: filter === k ? color : "transparent", color: filter === k ? DS.bg : n ? color : DS.mut }}>{n} {label}</button>
  );

  return (
    <div style={{ margin: "-14px -18px", padding: "16px 16px 48px", background: DS.bg, minHeight: "calc(100vh - 56px)", fontFamily: DS.font, color: DS.text }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <img src="/dssc/logo-horizontal-white.png" alt="Dripping Springs Sports Club" style={{ height: 34, width: "auto" }} />
          <Tag color={DS.lime}>Admin</Tag>
          <div style={{ flex: 1 }} />
          <Btn small onClick={onCoachHub}>Coach hub</Btn>
          {onCoverage && <Btn small onClick={onCoverage}>Coverage calendar</Btn>}
          {onTimeCards && <Btn small onClick={onTimeCards}>Time cards & pay</Btn>}
          <Btn small kind="primary" onClick={newClinic}>+ New program</Btn>
        </div>

        {/* Needs attention */}
        <Card accent={attention.pending || attention.short ? DS.orange : undefined}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Label style={{ marginBottom: 0 }}>Needs attention</Label>
            <div style={{ flex: 1 }} />
            {chip("pending", attention.pending, "pickup" + (attention.pending === 1 ? "" : "s") + " to approve", DS.orange)}
            {chip("short", attention.short, "short a coach · 2 wks", DS.orange)}
            {chip("low", attention.low, "low sign-ups · 2 wks", DS.orange)}
            {chip("noplan", attention.noplan, "no plan this week", DS.mut)}
          </div>
          {pendingAll.length > 0 && filter !== "pending" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              {pendingAll.slice(0, 4).flatMap(r => r.pending.map(p => (
                <div key={r.key + p.name} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 11px", borderRadius: 10, background: DS.orangeSoft, border: "1px solid " + DS.orange }}>
                  <span style={{ fontSize: 13, flex: 1, minWidth: 200 }}><b>{p.name}</b> wants <b>{r.c.name}</b> · {fmtDay(r.s.date, today)} {timeRange(r.s)}{p.role === "lead" ? " · as lead" : ""}{availBy[nrm(p.name)]?.can_lead ? "" : p.role === "lead" ? <span style={{ color: DS.orange }}> · not cleared to lead</span> : ""}</span>
                  <Btn small kind="primary" disabled={busy === r.key} onClick={() => decide(r, p.name, true)}>Approve</Btn>
                  <Btn small disabled={busy === r.key} onClick={() => decide(r, p.name, false)}>Decline</Btn>
                </div>
              )))}
              {attention.pending > 4 && <Btn kind="link" small onClick={() => setFilter("pending")}>See all {attention.pending}</Btn>}
            </div>
          )}
        </Card>

        {/* Week board */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {filter === "all" ? (<>
              <Btn small kind="quiet" onClick={() => setWeekOff(w => w - 1)}>‹</Btn>
              <div style={{ fontSize: 15, fontWeight: 800, minWidth: 180, textAlign: "center" }}>{weekOff === 0 ? "This week" : weekOff === 1 ? "Next week" : "Week of " + new Date(weekStart + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}<span style={{ color: DS.mut, fontWeight: 600, fontSize: 12 }}> · {new Date(weekStart + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}–{new Date(weekEnd + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div>
              <Btn small kind="quiet" onClick={() => setWeekOff(w => w + 1)}>›</Btn>
              {weekOff !== 0 && <Btn kind="link" small onClick={() => setWeekOff(0)}>Today</Btn>}
            </>) : (<>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{{ pending: "Pickups waiting on you", short: "Classes short a coach", low: "Classes with 2 or fewer signed up", noplan: "Classes with no practice plan" }[filter]} <span style={{ color: DS.mut, fontSize: 12, fontWeight: 600 }}>· {board.length}</span></div>
              <Btn kind="link" small onClick={() => setFilter("all")}>Back to the week</Btn>
            </>)}
            <div style={{ flex: 1 }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search program, coach, day…" style={{ ...inputStyle, width: 240, padding: "7px 10px", fontSize: 13 }} />
          </div>
          {!byDate.length && <div style={{ fontSize: 13, color: DS.mut }}>{filter === "all" ? "No classes this week." : "Nothing here — all clear."}</div>}
          {byDate.map(g => (
            <div key={g.date} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: g.date === today ? DS.lime : DS.text, margin: "0 0 6px" }}>{fmtDay(g.date, today)}{(g.date === today || fmtDay(g.date, today) === "Tomorrow") && <span style={{ color: DS.dim, fontWeight: 600 }}> · {new Date(g.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {g.rows.map(r => {
                  const crew = sessionStaff(r.s).filter(x => x.status !== "declined");
                  const sug = r.short > 0 && r.s.date >= today ? suggest(r) : [];
                  const sugNames = new Set(sug.map(x => nrm(x.name)));
                  const b = busy === r.key;
                  return (
                    <div key={r.key} style={{ display: "grid", gridTemplateColumns: "72px minmax(180px,1.3fr) auto minmax(220px,1.4fr)", gap: 10, alignItems: "center", padding: "10px 12px", borderRadius: 10, background: DS.panel2, border: "1px solid " + (r.short > 0 && r.s.date >= today ? DS.orange : DS.line) }}
                      className="dssc-board-row">
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.1 }}>{r.s.start_time || "—"}</div>
                        <div style={{ fontSize: 11, color: DS.mut, marginTop: 2 }}>{sessionHours(r.s)}h{r.s.court ? " · " + r.s.court : ""}</div>
                      </div>
                      <button onClick={() => openClass(r.c.id, r.s.id)} style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", fontFamily: DS.font, color: DS.text, minWidth: 0 }} title="Open this class — plan, players, message">
                        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2 }}>{r.c.name} <span style={{ color: DS.lime }}>›</span></div>
                        <div style={{ fontSize: 12, color: DS.mut, marginTop: 2, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          {[r.c.age_group, r.c.location].filter(Boolean).join(" · ")}
                          {!hasClassPlan(r.s) && r.s.date >= today && <Tag color={DS.mut}>no plan</Tag>}
                        </div>
                      </button>
                      <div>{signupTag(r)}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {crew.map(x => (
                          <span key={x.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: x.status === "pending" ? DS.orange : DS.text, background: x.status === "pending" ? DS.orangeSoft : "rgba(255,255,255,0.08)", border: "1px solid " + (x.status === "pending" ? DS.orange : "transparent"), borderRadius: 999, padding: "3px 6px 3px 10px" }}>
                            {x.name}{x.role === "lead" ? <span style={{ color: DS.lime, fontSize: 10 }}>LEAD</span> : null}
                            {x.status === "pending"
                              ? <><button title="Approve" disabled={b} onClick={() => decide(r, x.name, true)} style={{ border: "none", background: DS.lime, color: DS.bg, borderRadius: 999, width: 20, height: 20, cursor: "pointer", fontWeight: 900, fontSize: 11 }}>✓</button><button title="Decline" disabled={b} onClick={() => decide(r, x.name, false)} style={{ border: "none", background: "transparent", color: DS.orange, borderRadius: 999, width: 20, height: 20, cursor: "pointer", fontWeight: 900 }}>✕</button></>
                              : <button title="Remove" disabled={b} onClick={() => remove(r, x.name)} style={{ border: "none", background: "transparent", color: DS.mut, borderRadius: 999, width: 20, height: 20, cursor: "pointer", fontWeight: 900 }}>✕</button>}
                          </span>
                        ))}
                        {r.s.date >= today && (
                          <select value="" disabled={b} onChange={e => assign(r, e.target.value)} title={"Needs " + staffNeeded(r.s, r.c) + " coach" + (staffNeeded(r.s, r.c) === 1 ? "" : "es")}
                            style={{ ...inputStyle, width: "auto", padding: "5px 8px", fontSize: 12, fontWeight: 700, borderColor: r.short > 0 ? DS.orange : DS.line, color: r.short > 0 ? DS.orange : DS.mut }}>
                            <option value="">{r.short > 0 ? "+ assign (" + r.short + " short)" : "+ add a coach"}</option>
                            {sug.length > 0 && <optgroup label="Suggested">{sug.map(x => <option key={x.name} value={x.name}>{x.name} — {x.why.join(", ")}</option>)}</optgroup>}
                            <optgroup label="Everyone">{everyone.filter(n => !sugNames.has(nrm(n)) && !crew.some(x => nrm(x.name) === nrm(n))).map(n => <option key={n} value={n}>{n}</option>)}</optgroup>
                          </select>
                        )}
                        {r.s.date >= today && (
                          <select value={staffNeeded(r.s, r.c)} onChange={e => setNeeded(r, +e.target.value)} title="Coaches needed" style={{ ...inputStyle, width: "auto", padding: "5px 6px", fontSize: 11, color: DS.mut }}>
                            {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} needed</option>)}
                          </select>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <style>{`@media (max-width: 720px) { .dssc-board-row { grid-template-columns: 64px 1fr !important; } .dssc-board-row > div:nth-child(3), .dssc-board-row > div:nth-child(4) { grid-column: 1 / -1; justify-content: flex-start !important; } }`}</style>
        </Card>

        {/* Programs */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Label style={{ marginBottom: 0 }}>Programs · {programs.length} with classes ahead</Label>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: DS.mut }}>Tap a name for program settings</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead><tr>{["Program", "Next class", "Classes left", "Avg signed up", "Staffed", "Usual coach", "Template"].map((h, i) => <th key={h} style={{ textAlign: i === 0 ? "left" : "right", padding: "6px 8px", fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: DS.mut, borderBottom: "1px solid " + DS.line, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
              <tbody>
                {programs.map(p => {
                  const low = p.avg != null && p.avg <= 2 && p.up.length > 0;
                  const td = { padding: "8px", fontSize: 13, borderBottom: "1px solid " + DS.line, textAlign: "right", whiteSpace: "nowrap" };
                  return (
                    <tr key={p.c.id} style={{ background: low ? DS.orangeSoft : "transparent" }}>
                      <td style={{ ...td, textAlign: "left", whiteSpace: "normal" }}>
                        <button onClick={() => openProgram(p.c.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: DS.font, color: DS.text, fontSize: 13, fontWeight: 700, textAlign: "left" }}>{p.c.name}</button>
                        <div style={{ fontSize: 11, color: DS.mut }}>{[p.c.category, p.c.age_group, p.c.location].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td style={td}>{p.next ? fmtDay(p.next, today) : <span style={{ color: DS.mut }}>none scheduled</span>}</td>
                      <td style={td}>{p.up.length}</td>
                      <td style={{ ...td, color: low ? DS.orange : DS.text, fontWeight: low ? 800 : 500 }}>{p.avg == null ? "—" : p.avg}{isPod(p.c) ? <span style={{ color: DS.mut }}>/{POD_CAP}</span> : null}</td>
                      <td style={{ ...td, color: p.up.length && p.staffed < p.up.length ? DS.orange : DS.text }}>{p.up.length ? p.staffed + "/" + p.up.length : "—"}</td>
                      <td style={td}>{p.lead || <span style={{ color: DS.mut }}>—</span>}</td>
                      <td style={td}>{p.template ? <span style={{ color: DS.lime }}>✓</span> : <span style={{ color: DS.mut }}>—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Playbook sync */}
        {sync && (() => {
          const last = sync.dsscSync?.last_synced_at ? new Date(sync.dsscSync.last_synced_at) : null;
          const t = sync.dsscSyncTok;
          return (
            <Card>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                <Label style={{ marginBottom: 0 }}>Playbook sync</Label>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: DS.mut }}>{last ? "Last synced " + last.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + last.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) + (sync.dsscSync?.summary ? ` · +${sync.dsscSync.summary.sessionsAdded || 0} added · −${sync.dsscSync.summary.sessionsRemoved || 0} removed` : "") : "Not synced yet"}</span>
              </div>
              <div style={{ fontSize: 12, color: DS.mut, lineHeight: 1.5, marginBottom: 8 }}>Playbook is the system of record. Open a month there and click the bookmark: new classes are added, times refreshed, and any class Playbook no longer lists is removed from here — you and Hunter get an email if a coach was on it. Only the dates on screen are touched, so sync month by month. Registrations: export Playbook's registrations report and run <code style={{ color: DS.text }}>node scripts/import-pod-roster.mjs &lt;csv&gt;</code>.</div>
              {!t && <Btn small onClick={sync.fetchSyncBookmarklet}>Set up the one-click sync →</Btn>}
              {t?.loading && <span style={{ fontSize: 12, color: DS.mut }}>Loading…</span>}
              {t?.error && <div style={{ fontSize: 12, color: DS.orange }}>Couldn't load: {t.error}</div>}
              {t?.configured === false && <div style={{ fontSize: 12, color: DS.orange }}>Add a DSSC_SYNC_SECRET env var in Vercel, redeploy, then reload.</div>}
              {t?.href && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <a ref={el => { if (el) el.setAttribute("href", t.href); }} onClick={e => e.preventDefault()} draggable="true" style={{ display: "inline-block", padding: "7px 14px", borderRadius: 9, background: DS.lime, color: DS.bg, fontWeight: 800, fontSize: 13, textDecoration: "none", cursor: "grab" }}>🔄 Sync DSSC clinics</a>
                  <Btn small onClick={() => { navigator.clipboard?.writeText(t.href); window.alert("Sync code copied. Create a bookmark and paste it as the URL."); }}>Copy code</Btn>
                  <a href={t.calendarUrl + "?start_date=" + today.slice(0, 4) + "-08-01&end_date=" + today.slice(0, 4) + "-12-31"} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 700, color: DS.lime }}>Open Playbook →</a>
                  <span style={{ fontSize: 11, color: DS.dim }}>Drag the green button to your bookmarks bar once.</span>
                </div>
              )}
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid " + DS.line }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Registrations (who's signed up)</div>
                    <div style={{ fontSize: 12, color: DS.mut, lineHeight: 1.5 }}>Playbook → Reports → Registrations → export CSV, then drop it here. New sign-ups are added, nothing is removed. Sync the calendar first so every class exists.</div>
                  </div>
                  <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={e => uploadRegistrations(e.target.files?.[0])} />
                  <Btn small kind="primary" disabled={!!imp?.loading} onClick={() => fileRef.current?.click()}>{imp?.loading ? "Importing…" : "Upload registrations CSV"}</Btn>
                </div>
                {imp?.error && <div style={{ fontSize: 13, color: DS.orange, fontWeight: 700, marginTop: 8 }}>{imp.error}</div>}
                {imp?.ok && (
                  <div style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
                    <span style={{ color: DS.lime, fontWeight: 800 }}>✓ {imp.added} new sign-up{imp.added === 1 ? "" : "s"}</span> · {imp.matched} matched across {imp.programs.length} programs · {imp.skippedRows} rows skipped (not volleyball classes)
                    {imp.noSession.length > 0 && (
                      <div style={{ color: DS.orange, marginTop: 4 }}>{imp.noSession.length} registration{imp.noSession.length === 1 ? "" : "s"} for classes that aren't in HQ yet — sync that month's calendar, then upload again: {[...new Set(imp.noSession.map(x => x.program + " " + x.date.slice(5)))].slice(0, 6).join(", ")}{imp.noSession.length > 6 ? "…" : ""}</div>
                    )}
                  </div>
                )}
              </div>
            </Card>
          );
        })()}

        <div style={{ fontSize: 12, color: DS.mut, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span>{pool.length} coaches in the club pool</span>
          {onLegacy && <><span>·</span><Btn kind="link" small onClick={onLegacy}>Classic view (pool, hours & pay, calendar)</Btn></>}
        </div>
      </div>
    </div>
  );
}
