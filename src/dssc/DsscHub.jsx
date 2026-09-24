// Dripping Springs Sports Club — the coach hub.
//
// This is the club's own screen inside DS Elite HQ, styled to the DSSC brand
// guide (Evergreen / Limegreen / Orange, Founders Grotesk) rather than the
// DS Elite pink. A coach lands on the classes they're staffed for, opens one,
// and everything for that class is in one place: the plan, who's signed up,
// a message to the families, pictures & video, and the recap. Open shifts
// are here too so picking one up is a tap, not a hunt.
//
// A "class" is a single session of a clinic/pod (dssc_clinics.sessions[]).
// Roster, media and messages are all keyed on (clinic_id, session_id) — the
// user was explicit that these are class by class, never the whole program.

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "../supabase";
import { sessionStaff, staffNeeded, sessionShort, staffApproved, parsePlanPaste, parseClock, sessionHours, localDateISO } from "../../shared/dssc-clinics.js";

// Brand palette (DSC-25-05 style guide). Greenbriar is decorative only — it
// fails AA against every other brand color, so it never carries text here.
export const DS = {
  bg: "#104946", panel: "#0C3A37", panel2: "#082C2A", line: "rgba(255,255,255,0.12)", lineStrong: "rgba(255,255,255,0.22)",
  text: "#FFFFFF", mut: "#A9C7C3", dim: "#6F9995",
  lime: "#B2D049", limeSoft: "rgba(178,208,73,0.14)", orange: "#FF7300", orangeSoft: "rgba(255,115,0,0.14)",
  earth: "#87533E", brier: "#0F8B76", black: "#191919",
  font: '"Founders Grotesk", "Archivo", "Outfit", -apple-system, "Segoe UI", sans-serif',
};
const nrm = (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
const rid = () => Math.random().toString(36).slice(2, 10);
const fmtDay = (iso, today) => { if (!iso) return "—"; if (iso === today) return "Today"; const d = new Date(iso + "T12:00:00"); const t = new Date(today + "T12:00:00"); if ((d - t) / 86400000 === 1) return "Tomorrow"; return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); };
const fmtLong = (iso) => iso ? new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : "—";
const timeRange = (s) => (s.start_time || "") + (s.end_time ? "–" + s.end_time : "");
const hasPlan = (c) => Array.isArray(c?.plan?.blocks) && c.plan.blocks.some(b => String(b.name || "").trim());

// ── Small brand primitives ──────────────────────────────────────────────────
function Btn({ kind = "ghost", small, style, children, ...rest }) {
  const base = { fontFamily: DS.font, fontWeight: 700, fontSize: small ? 12 : 13, padding: small ? "6px 11px" : "9px 15px", borderRadius: 9, cursor: "pointer", border: "1px solid transparent", display: "inline-flex", alignItems: "center", gap: 6, lineHeight: 1.1, whiteSpace: "nowrap" };
  const kinds = {
    primary: { background: DS.lime, color: DS.bg, borderColor: DS.lime },
    ghost:   { background: "transparent", color: DS.text, borderColor: DS.lineStrong },
    warn:    { background: DS.orange, color: DS.black, borderColor: DS.orange },
    quiet:   { background: "rgba(255,255,255,0.06)", color: DS.mut, borderColor: "transparent" },
    link:    { background: "none", color: DS.lime, padding: 0, border: "none" },
  };
  return <button {...rest} style={{ ...base, ...kinds[kind], ...(rest.disabled ? { opacity: 0.5, cursor: "default" } : {}), ...style }}>{children}</button>;
}
const Card = ({ style, children, accent }) => <div style={{ background: DS.panel, border: "1px solid " + (accent || DS.line), borderRadius: 14, padding: 16, marginBottom: 14, ...style }}>{children}</div>;
const Label = ({ children, style }) => <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: DS.lime, marginBottom: 8, ...style }}>{children}</div>;
const Tag = ({ color = DS.mut, children, fill }) => <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: fill ? DS.bg : color, background: fill ? color : "transparent", border: "1px solid " + color, borderRadius: 6, padding: "2px 7px", whiteSpace: "nowrap" }}>{children}</span>;
const inputStyle = { background: DS.panel2, border: "1px solid " + DS.line, borderRadius: 8, color: DS.text, fontFamily: DS.font, fontSize: 14, padding: "9px 11px", width: "100%", boxSizing: "border-box", lineHeight: 1.45 };
function Grow({ value, onChange, minRows = 2, style, ...rest }) {
  const ref = useRef(null);
  const resize = () => { const el = ref.current; if (!el) return; el.style.height = "auto"; el.style.height = Math.min(Math.max(el.scrollHeight, minRows * 22) + 2, 480) + "px"; };
  useEffect(() => { resize(); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <textarea ref={ref} rows={minRows} value={value} onChange={(e) => { onChange(e); resize(); }} style={{ ...inputStyle, resize: "none", ...style }} {...rest} />;
}
// Edit locally, write once typing pauses — one Supabase update per thought, not per key.
function Field({ value, onSave, multiline, minRows, placeholder, style, readOnly }) {
  const [v, setV] = useState(value ?? "");
  const t = useRef(null), last = useRef(value ?? "");
  useEffect(() => { if ((value ?? "") !== last.current && !t.current) { setV(value ?? ""); last.current = value ?? ""; } }, [value]);
  const commit = (nv) => { last.current = nv; if (nv !== (value ?? "")) onSave(nv); };
  const change = (e) => { const nv = e.target.value; setV(nv); clearTimeout(t.current); t.current = setTimeout(() => { t.current = null; commit(nv); }, 700); };
  const blur = () => { if (t.current) { clearTimeout(t.current); t.current = null; commit(v); } };
  if (readOnly) return <div style={{ fontSize: 14, color: v ? DS.text : DS.dim, whiteSpace: "pre-wrap", lineHeight: 1.5, ...style }}>{v || placeholder || "—"}</div>;
  return multiline
    ? <Grow value={v} onChange={change} onBlur={blur} minRows={minRows || 2} placeholder={placeholder} style={style} />
    : <input value={v} onChange={change} onBlur={blur} placeholder={placeholder} style={{ ...inputStyle, ...style }} />;
}

// ── The hub ─────────────────────────────────────────────────────────────────
export default function DsscHub({
  coach, coachRoster = [], clinics = [], dsscCheckins = [], dsscAvail = [], podAttendance = [],
  isDirector = false, initialClinicId = null, onConsumedInitial,
  setClinics, reload = {}, staffDsscSession, unstaffDsscSession, notifyDirectors,
  onOpenAdmin, onOpenPlaybook,
}) {
  const today = localDateISO();
  const coachName = coach?.display_name || coach?.email || "";
  const coachEmail = nrm(coach?.email);
  const me = useMemo(() => {
    const s = new Set(); if (coach?.display_name) s.add(nrm(coach.display_name));
    const r = coachRoster.find(x => coachEmail && nrm(x.email) === coachEmail);
    if (r) s.add(nrm(((r.first_name || "") + " " + (r.last_name || "")).trim()));
    return s;
  }, [coach, coachRoster, coachEmail]);
  const isMe = (nm) => me.has(nrm(nm));
  const myStaffEntry = (s) => sessionStaff(s).find(x => isMe(x.name) && x.status !== "declined") || null;

  const [sel, setSel] = useState(null);            // { clinicId, sessionId }
  const [tab, setTab] = useState("plan");
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState("");
  const [run, setRun] = useState(null);            // class runner
  const [, tick] = useState(0);
  useEffect(() => { if (!run || run.paused) return; const id = setInterval(() => tick(n => n + 1), 500); return () => clearInterval(id); }, [run]);

  // Every session I'm on, flattened.
  const rows = useMemo(() => {
    const out = [];
    for (const c of clinics) for (const s of (Array.isArray(c.sessions) ? c.sessions : [])) {
      if (!s?.date) continue;
      out.push({ c, s, mine: myStaffEntry(s), short: sessionShort(s, c) });
    }
    out.sort((a, b) => a.s.date.localeCompare(b.s.date) || ((parseClock(a.s.start_time) || 0) - (parseClock(b.s.start_time) || 0)));
    return out;
  }, [clinics, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = rows.filter(r => r.mine);
  const upcoming = mine.filter(r => r.s.date >= today);
  const since14 = localDateISO(new Date(Date.now() - 14 * 86400000));
  const recent = mine.filter(r => r.s.date < today && r.s.date >= since14).reverse();
  const openShifts = rows.filter(r => !r.mine && r.s.date >= today && r.short > 0 && !sessionStaff(r.s).some(x => isMe(x.name)));
  const myAvail = dsscAvail.find(a => isMe(a.coach_name));

  // Deep-link from the home card: open that clinic's next class of mine.
  useEffect(() => {
    if (!initialClinicId || !clinics.length) return;
    const pick = upcoming.find(r => r.c.id === initialClinicId) || rows.find(r => r.c.id === initialClinicId && r.s.date >= today) || rows.filter(r => r.c.id === initialClinicId).slice(-1)[0];
    if (pick) { setSel({ clinicId: pick.c.id, sessionId: pick.s.id }); setTab("plan"); }
    onConsumedInitial && onConsumedInitial();
  }, [initialClinicId, clinics.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Writes ───────────────────────────────────────────────────────────────
  const saveClinic = async (id, patch) => {
    setClinics && setClinics(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
    const { error } = await supabase.from("dssc_clinics").update({ ...patch, updated_by: coachName, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { window.alert("Couldn't save: " + error.message); reload.clinics && reload.clinics(); }
  };
  const saveSession = (c, sid, patch) => saveClinic(c.id, { sessions: (c.sessions || []).map(x => String(x.id) === String(sid) ? { ...x, ...patch } : x) });
  const checkedIn = (sid) => dsscCheckins.some(x => String(x.session_id) === String(sid) && isMe(x.coach_name));
  const nowH = new Date().getHours() + new Date().getMinutes() / 60;
  const winState = (s) => { const a = parseClock(s.start_time), b = parseClock(s.end_time); if (a == null) return "open"; if (nowH < a - 0.5) return "early"; if (b != null && nowH > b) return "past"; return "open"; };
  const clockIn = async (c, s, late) => {
    setBusy("ci|" + s.id);
    const { error } = await supabase.from("dssc_checkins").insert({ coach_name: coachName, coach_email: coach?.email || null, clinic_id: c.id, session_id: s.id, session_date: s.date, clinic_name: c.name, hours: sessionHours(s), status: "present", source: late ? "app-late" : "app", created_by: coachName });
    if (error && !/duplicate|unique/i.test(error.message || "")) window.alert("Couldn't clock in: " + error.message);
    reload.checkins && (await reload.checkins()); setBusy("");
  };
  const pickUp = async (c, s) => {
    const lead = !staffApproved(s).some(x => x.role === "lead");
    if (!window.confirm(`Pick up ${c.name} on ${fmtDay(s.date, today)} (${timeRange(s)})?${lead ? "\n\nThis class has no lead yet — the director will confirm you before it's yours." : ""}`)) return;
    setBusy("pu|" + s.id);
    await staffDsscSession(c.id, s.id, coachName, lead ? "lead" : "assist", "pending");
    notifyDirectors && notifyDirectors("DSSC shift pickup — " + c.name, `${coachName} wants ${c.name} on ${fmtDay(s.date, today)} (${timeRange(s)}). Approve it in DSSC → Coverage Calendar.`);
    setBusy("");
  };
  const dropOut = async (c, s) => {
    if (!window.confirm(`Give up ${c.name} on ${fmtDay(s.date, today)} and ask for coverage?`)) return;
    await unstaffDsscSession(c.id, s.id, coachName);
    notifyDirectors && notifyDirectors("DSSC shift needs coverage — " + c.name, `${coachName} can't make ${c.name} on ${fmtDay(s.date, today)} (${timeRange(s)}). It's open for another coach to pick up.`);
    if (sel && String(sel.sessionId) === String(s.id)) setSel(null);
  };
  const togglePool = async () => {
    const row = { coach_name: myAvail?.coach_name || coachName, coach_email: coach?.email || myAvail?.coach_email || null, available: !myAvail?.available, note: myAvail?.note || null, skills: myAvail?.skills || null, interest_source: myAvail?.interest_source === "self" ? "self" : (myAvail?.interest_source || "self"), updated_at: new Date().toISOString() };
    const { error } = await supabase.from("dssc_availability").upsert(row, { onConflict: "coach_name" });
    if (error) { window.alert("Couldn't save: " + error.message); return; }
    reload.avail && reload.avail();
  };

  // ── Shell ────────────────────────────────────────────────────────────────
  const shell = (inner) => (
    <div style={{ margin: "-14px -18px", padding: "16px 16px 48px", background: DS.bg, minHeight: "calc(100vh - 56px)", fontFamily: DS.font, color: DS.text }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>{inner}</div>
    </div>
  );
  const header = (sub) => (
    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
      <img src="/dssc/logo-horizontal-white.png" alt="Dripping Springs Sports Club" style={{ height: 34, width: "auto" }} />
      <div style={{ flex: 1 }} />
      {sub}
    </div>
  );

  // ── Class view ───────────────────────────────────────────────────────────
  const open = sel ? (() => { const c = clinics.find(x => x.id === sel.clinicId); const s = c && (c.sessions || []).find(x => String(x.id) === String(sel.sessionId)); return c && s ? { c, s } : null; })() : null;
  if (open) {
    return shell(
      <ClassView key={open.c.id + "|" + open.s.id} c={open.c} s={open.s} today={today} coach={coach} coachName={coachName} isMe={isMe} isDirector={isDirector}
        header={header} onBack={() => setSel(null)} tab={tab} setTab={setTab}
        saveClinic={saveClinic} saveSession={saveSession} clockIn={clockIn} checkedIn={checkedIn} winState={winState} dropOut={dropOut} busy={busy}
        podAttendance={podAttendance} reloadAttendance={reload.attendance} run={run} setRun={setRun} onOpenPlaybook={onOpenPlaybook}
        sessions={(open.c.sessions || []).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""))} onPickSession={(sid) => setSel({ clinicId: open.c.id, sessionId: sid })} />
    );
  }

  // ── Home: my classes, clock-in, open shifts ──────────────────────────────
  const todays = upcoming.filter(r => r.s.date === today);
  const lateOnes = recent.filter(r => !checkedIn(r.s.id) && r.mine.status === "approved");
  const list = showAll ? upcoming : upcoming.slice(0, 12);
  const byDate = []; for (const r of list) { const g = byDate.find(x => x.date === r.s.date); if (g) g.rows.push(r); else byDate.push({ date: r.s.date, rows: [r] }); }
  const needRecap = recent.filter(r => !(r.s.recap || "").trim());
  const classRow = (r, extra) => {
    const planned = hasPlan(r.c), pending = r.mine?.status === "pending";
    return (
      <button key={r.c.id + "|" + r.s.id} onClick={() => { setSel({ clinicId: r.c.id, sessionId: r.s.id }); setTab("plan"); }}
        style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "12px 14px", borderRadius: 12, border: "1px solid " + (r.s.date === today ? DS.lime : DS.line), background: r.s.date === today ? DS.limeSoft : DS.panel2, cursor: "pointer", fontFamily: DS.font, color: DS.text }}>
        <div style={{ minWidth: 74 }}>
          <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.1 }}>{r.s.start_time || "—"}</div>
          <div style={{ fontSize: 11, color: DS.mut, marginTop: 2 }}>{sessionHours(r.s)}h{r.s.court ? " · " + r.s.court : ""}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>{r.c.name}</div>
          <div style={{ fontSize: 12, color: DS.mut, marginTop: 3, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {[r.c.age_group, r.c.location].filter(Boolean).join(" · ")}
            {r.mine?.role === "lead" && <Tag color={DS.lime}>Lead</Tag>}
            {pending && <Tag color={DS.orange}>Awaiting approval</Tag>}
            {!planned && !pending && <Tag color={DS.orange}>Needs plan</Tag>}
            {extra}
          </div>
        </div>
        <span style={{ color: DS.lime, fontWeight: 800, fontSize: 18 }}>›</span>
      </button>
    );
  };
  return shell(<>
    {header(<>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Coach {coachName.split(" ")[0]}</div>
        <div style={{ fontSize: 11, color: DS.mut }}>{upcoming.length} class{upcoming.length === 1 ? "" : "es"} coming up</div>
      </div>
      {isDirector && onOpenAdmin && <Btn small onClick={onOpenAdmin}>Admin view →</Btn>}
    </>)}

    {(todays.length > 0 || lateOnes.length > 0) && (
      <Card accent={DS.lime}>
        <Label>Clock in</Label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[...todays, ...lateOnes].map(r => {
            const done = checkedIn(r.s.id), ws = r.s.date < today ? "past" : winState(r.s), b = busy === "ci|" + r.s.id;
            return (
              <div key={r.s.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 12px", borderRadius: 10, background: DS.panel2, border: "1px solid " + (done ? DS.lime : DS.line) }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{r.c.name}</div>
                  <div style={{ fontSize: 12, color: DS.mut }}>{fmtDay(r.s.date, today)} · {timeRange(r.s)}{r.s.court ? " · " + r.s.court : ""} · {sessionHours(r.s)}h</div>
                </div>
                {done ? <span style={{ color: DS.lime, fontWeight: 800, fontSize: 13 }}>✓ Clocked in</span>
                  : ws === "early" ? <span style={{ color: DS.mut, fontSize: 12, fontWeight: 700 }}>Opens 30 min before</span>
                  : ws === "past" ? <Btn small disabled={b} onClick={() => clockIn(r.c, r.s, true)}>Clock in late</Btn>
                  : <Btn kind="primary" disabled={b} onClick={() => clockIn(r.c, r.s)}>{b ? "…" : "I'm here"}</Btn>}
              </div>
            );
          })}
        </div>
      </Card>
    )}

    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Label style={{ marginBottom: 0 }}>Your classes</Label>
        <div style={{ flex: 1 }} />
        {upcoming.length > 12 && <Btn kind="link" small onClick={() => setShowAll(v => !v)}>{showAll ? "Show fewer" : `All ${upcoming.length}`}</Btn>}
      </div>
      {!upcoming.length ? (
        <div style={{ fontSize: 14, color: DS.mut, lineHeight: 1.5 }}>
          Nothing on your schedule yet.{openShifts.length ? " Pick up an open shift below to get started." : ""}
          {!myAvail?.available && <div style={{ marginTop: 10 }}><Btn kind="primary" onClick={togglePool}>I want to coach club classes</Btn><div style={{ fontSize: 12, color: DS.mut, marginTop: 6 }}>$25/hr, separate from DS Elite. We'll match you to classes.</div></div>}
        </div>
      ) : byDate.map(g => (
        <div key={g.date} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: g.date === today ? DS.lime : DS.text, margin: "0 0 6px", letterSpacing: "0.02em" }}>{fmtDay(g.date, today)}{g.date === today || fmtDay(g.date, today) === "Tomorrow" ? <span style={{ color: DS.dim, fontWeight: 600 }}> · {new Date(g.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span> : null}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{g.rows.map(r => classRow(r))}</div>
        </div>
      ))}
    </Card>

    {needRecap.length > 0 && (
      <Card>
        <Label style={{ color: DS.orange }}>Recap these</Label>
        <div style={{ fontSize: 12, color: DS.mut, marginBottom: 8 }}>A line or two on how it went — the next coach on this pod builds from it.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {needRecap.slice(0, 5).map(r => (
            <button key={r.s.id} onClick={() => { setSel({ clinicId: r.c.id, sessionId: r.s.id }); setTab("recap"); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "9px 12px", borderRadius: 10, border: "1px solid " + DS.line, background: DS.panel2, cursor: "pointer", fontFamily: DS.font, color: DS.text }}>
              <span style={{ fontSize: 12, color: DS.mut, minWidth: 90 }}>{fmtDay(r.s.date, today)}</span>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{r.c.name}</span>
              <span style={{ color: DS.orange, fontSize: 12, fontWeight: 800 }}>Write recap ›</span>
            </button>
          ))}
        </div>
      </Card>
    )}

    <Card accent={openShifts.length ? DS.orange : undefined}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Label style={{ marginBottom: 0, color: openShifts.length ? DS.orange : DS.lime }}>Open shifts</Label>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: DS.mut }}>$25/hr</span>
      </div>
      {!openShifts.length ? <div style={{ fontSize: 13, color: DS.mut }}>Every upcoming class is covered. Check back — new pods land here first.</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {openShifts.slice(0, 15).map(r => {
            const b = busy === "pu|" + r.s.id;
            return (
              <div key={r.c.id + "|" + r.s.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 12px", borderRadius: 10, background: DS.panel2, border: "1px solid " + DS.line }}>
                <div style={{ minWidth: 92 }}>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{fmtDay(r.s.date, today)}</div>
                  <div style={{ fontSize: 12, color: DS.mut }}>{timeRange(r.s)}</div>
                </div>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{r.c.name}{r.s.needsCoverage && <span style={{ color: DS.orange }}> · needs coverage</span>}</div>
                  <div style={{ fontSize: 12, color: DS.mut }}>{[r.c.age_group, r.s.court || r.c.location].filter(Boolean).join(" · ")} · {r.short} coach{r.short === 1 ? "" : "es"} short · {sessionHours(r.s)}h · ${25 * sessionHours(r.s)}</div>
                </div>
                <Btn kind="warn" small disabled={b} onClick={() => pickUp(r.c, r.s)}>{b ? "…" : "I'll take it"}</Btn>
              </div>
            );
          })}
          {openShifts.length > 15 && <div style={{ fontSize: 12, color: DS.mut }}>+{openShifts.length - 15} more</div>}
        </div>
      )}
    </Card>

    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12, color: DS.mut, marginTop: 4 }}>
      <span>{myAvail?.available ? "✓ You're in the club coaching pool." : "Not in the coaching pool."}</span>
      <Btn kind="link" small onClick={togglePool}>{myAvail?.available ? "Leave the pool" : "Join the pool"}</Btn>
      {onOpenPlaybook && <><span>·</span><Btn kind="link" small onClick={onOpenPlaybook}>Coaching playbook →</Btn></>}
    </div>
  </>);
}

// ── One class ───────────────────────────────────────────────────────────────
function ClassView({ c, s, sessions, onPickSession, today, coach, coachName, isMe, isDirector, header, onBack, tab, setTab,
  saveClinic, saveSession, clockIn, checkedIn, winState, dropOut, busy, podAttendance, reloadAttendance, run, setRun, onOpenPlaybook }) {
  const crew = sessionStaff(s).filter(x => x.status !== "declined");
  const mineEntry = crew.find(x => isMe(x.name));
  const canEdit = isDirector || !!mineEntry;
  const idx = sessions.findIndex(x => String(x.id) === String(s.id));
  const prev = idx > 0 ? sessions[idx - 1] : null, next = idx >= 0 && idx < sessions.length - 1 ? sessions[idx + 1] : null;
  const isToday = s.date === today, isPast = s.date < today;
  const done = checkedIn(s.id), ws = isPast ? "past" : winState(s);

  // Per-class data.
  const [roster, setRoster] = useState(null);
  const [media, setMedia] = useState([]);
  const [messages, setMessages] = useState([]);
  const loadRoster = useCallback(async () => { const { data } = await supabase.from("dssc_pod_roster").select("*").eq("clinic_id", c.id).order("player_name"); setRoster((data || []).filter(r => !r.session_id || String(r.session_id) === String(s.id))); }, [c.id, s.id]);
  const loadMedia = useCallback(async () => { const { data } = await supabase.from("dssc_class_media").select("*").eq("clinic_id", c.id).eq("session_id", String(s.id)).order("created_at", { ascending: false }); setMedia(data || []); }, [c.id, s.id]);
  const loadMessages = useCallback(async () => { const { data } = await supabase.from("dssc_class_messages").select("*").eq("clinic_id", c.id).eq("session_id", String(s.id)).order("created_at", { ascending: false }).limit(20); setMessages(data || []); }, [c.id, s.id]);
  useEffect(() => { loadRoster(); loadMedia(); loadMessages(); }, [loadRoster, loadMedia, loadMessages]);
  const [picked, setPicked] = useState([]);   // media ids queued for the next message

  const tabs = [["plan", "Plan"], ["players", "Players" + (roster?.length ? " · " + roster.length : "")], ["message", "Message"], ["media", "Photos & video" + (media.length ? " · " + media.length : "")], ["recap", "Recap"]];
  return (<>
    {header(<Btn small onClick={onBack}>‹ My classes</Btn>)}
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
        <Tag color={DS.lime}>{c.kind === "camp" ? "Camp" : /pod/i.test(c.name || "") ? "Skill pod" : "Clinic"}</Tag>
        {mineEntry?.status === "pending" && <Tag color={DS.orange}>Awaiting director approval</Tag>}
        {isToday && <Tag color={DS.lime} fill>Today</Tag>}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 0.95, letterSpacing: "-0.01em", margin: "6px 0 8px" }}>{c.name}</div>
      <div style={{ fontSize: 14, color: DS.mut }}>{fmtLong(s.date)} · {timeRange(s)}{s.court ? " · " + s.court : ""}{c.location ? " · " + c.location : ""}{c.age_group ? " · " + c.age_group : ""}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {crew.map(x => <span key={x.name} style={{ fontSize: 12, fontWeight: 700, color: isMe(x.name) ? DS.bg : DS.text, background: isMe(x.name) ? DS.lime : "rgba(255,255,255,0.08)", borderRadius: 999, padding: "4px 10px" }}>{x.name}{x.role === "lead" ? " · lead" : ""}{x.status === "pending" ? " · pending" : ""}</span>)}
        {sessionShort(s, c) > 0 && <Tag color={DS.orange}>{sessionShort(s, c)} coach{sessionShort(s, c) === 1 ? "" : "es"} short</Tag>}
        <div style={{ flex: 1 }} />
        {(prev || next) && <div style={{ display: "flex", gap: 4 }}>
          <Btn kind="quiet" small disabled={!prev} onClick={() => prev && onPickSession(prev.id)} title={prev ? fmtLong(prev.date) : ""}>‹ Prev class</Btn>
          <Btn kind="quiet" small disabled={!next} onClick={() => next && onPickSession(next.id)} title={next ? fmtLong(next.date) : ""}>Next class ›</Btn>
        </div>}
      </div>
      {mineEntry && (isToday || (isPast && !done && s.date >= localDateISO(new Date(Date.now() - 14 * 86400000)))) && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 12, padding: "10px 12px", borderRadius: 10, background: DS.panel2, border: "1px solid " + (done ? DS.lime : DS.line) }}>
          <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{done ? "✓ Clocked in" : "Clock in for this class"} <span style={{ color: DS.mut, fontWeight: 500 }}>· {sessionHours(s)}h · ${25 * sessionHours(s)}</span></span>
          {!done && (ws === "early" ? <span style={{ fontSize: 12, color: DS.mut, fontWeight: 700 }}>Opens 30 min before</span>
            : ws === "past" ? <Btn small disabled={busy === "ci|" + s.id} onClick={() => clockIn(c, s, true)}>Clock in late</Btn>
            : <Btn kind="primary" disabled={busy === "ci|" + s.id} onClick={() => clockIn(c, s)}>I'm here</Btn>)}
        </div>
      )}
      {mineEntry && !isPast && !done && <div style={{ marginTop: 8 }}><Btn kind="link" small style={{ color: DS.orange }} onClick={() => dropOut(c, s)}>Can't make this one — ask for coverage</Btn></div>}
    </div>

    <div style={{ display: "flex", gap: 2, borderBottom: "1px solid " + DS.line, marginBottom: 14, overflowX: "auto" }}>
      {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} style={{ fontFamily: DS.font, fontSize: 13, fontWeight: 700, padding: "9px 12px", background: "none", border: "none", borderBottom: "3px solid " + (tab === k ? DS.lime : "transparent"), color: tab === k ? DS.lime : DS.mut, cursor: "pointer", whiteSpace: "nowrap" }}>{l}</button>)}
    </div>

    {tab === "plan" && <PlanTab c={c} s={s} prev={prev} canEdit={canEdit} isDirector={isDirector} coachName={coachName} saveClinic={saveClinic} saveSession={saveSession} onLaunch={(blocks) => setRun({ idx: 0, paused: false, endsAt: Date.now() + (Number(blocks[0].minutes) || 10) * 60000, remainingMs: null })} onOpenPlaybook={onOpenPlaybook} />}
    {tab === "players" && <PlayersTab c={c} s={s} roster={roster} reload={loadRoster} canEdit={canEdit} coachName={coachName} podAttendance={podAttendance} reloadAttendance={reloadAttendance} />}
    {tab === "message" && <MessageTab c={c} s={s} roster={roster || []} media={media} picked={picked} setPicked={setPicked} messages={messages} reloadMessages={loadMessages} reloadMedia={loadMedia} canEdit={canEdit} coachName={coachName} />}
    {tab === "media" && <MediaTab c={c} s={s} media={media} reload={loadMedia} picked={picked} setPicked={setPicked} canEdit={canEdit} coachName={coachName} goMessage={() => setTab("message")} />}
    {tab === "recap" && <RecapTab c={c} s={s} canEdit={canEdit} isDirector={isDirector} coachName={coachName} saveClinic={saveClinic} saveSession={saveSession} />}

    {run && <Runner c={c} run={run} setRun={setRun} saveClinic={saveClinic} onEnd={() => { setRun(null); setTab("recap"); }} />}
  </>);
}

// ── Plan ────────────────────────────────────────────────────────────────────
function PlanTab({ c, s, prev, canEdit, isDirector, coachName, saveClinic, saveSession, onLaunch, onOpenPlaybook }) {
  const plan = c.plan || {}, blocks = Array.isArray(plan.blocks) ? plan.blocks : [];
  const setPlan = (next) => saveClinic(c.id, { plan: { ...plan, ...next } });
  const setBlock = (i, patch) => setPlan({ blocks: blocks.map((b, ix) => ix === i ? { ...b, ...patch } : b) });
  const [paste, setPaste] = useState(null);
  const status = c.plan_status || "draft";
  const ST = { draft: ["Draft", DS.mut], submitted: ["Submitted for review", DS.orange], approved: ["Approved", DS.lime] };
  const total = blocks.reduce((n, b) => n + (Number(b.minutes) || 0), 0);
  const field = (label, key, ph) => (
    <div style={{ marginBottom: 12 }}>
      <Label>{label}</Label>
      <Field value={c[key] || ""} onSave={v => saveClinic(c.id, { [key]: v })} multiline minRows={2} placeholder={ph} readOnly={!canEdit} />
    </div>
  );
  return (<>
    <Card accent={DS.lime}>
      <Label>This class</Label>
      {prev && (prev.focus || prev.recap) && (
        <div style={{ fontSize: 13, color: DS.mut, marginBottom: 10, paddingLeft: 10, borderLeft: "3px solid " + DS.brier, lineHeight: 1.5 }}>
          <b style={{ color: DS.text }}>Last class ({fmtDay(prev.date, "")}{prev.coach_name ? " · " + prev.coach_name : ""}):</b>{prev.focus ? " " + prev.focus : ""}{prev.recap ? <><br /><i>Recap:</i> {prev.recap}</> : ""}
        </div>
      )}
      <Field value={s.focus || ""} onSave={v => saveSession(c, s.id, { focus: v })} multiline minRows={2} placeholder="What this class is building — the one thing every kid should leave better at…" readOnly={!canEdit} />
    </Card>

    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <Label style={{ marginBottom: 0 }}>Program plan</Label>
        <Tag color={ST[status][1]}>{ST[status][0]}{status === "approved" && c.plan_approved_by ? " · " + c.plan_approved_by : ""}</Tag>
        <div style={{ flex: 1 }} />
        {canEdit && !isDirector && status !== "submitted" && status !== "approved" && <Btn small onClick={() => { saveClinic(c.id, { plan_status: "submitted" }); }}>Submit for review</Btn>}
        {isDirector && status !== "approved" && <Btn small kind="primary" onClick={() => saveClinic(c.id, { plan_status: "approved", plan_approved_by: coachName, plan_approved_at: new Date().toISOString() })}>✓ Approve</Btn>}
        {blocks.length > 0 && <Btn small kind="primary" onClick={() => onLaunch(blocks)}>▶ Run class{total ? " · " + total + " min" : ""}</Btn>}
      </div>
      {field("Goals", "goals", "What players walk away with…")}
      {field("Focus & level", "focus", "Skills and concepts, matched to the level…")}
      {field("Coach expectations", "expectations", "Energy, structure, safety, our standards…")}
      <Label>Blocks{total ? <span style={{ color: DS.mut, fontWeight: 600, letterSpacing: 0, textTransform: "none" }}> · {total} min</span> : null}</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {blocks.map((b, i) => (
          <div key={b.id || i} style={{ display: "flex", gap: 8, alignItems: "flex-start", background: DS.panel2, borderRadius: 10, padding: 10, border: "1px solid " + DS.line }}>
            {canEdit ? <input type="number" min="0" value={b.minutes ?? ""} onChange={e => setBlock(i, { minutes: e.target.value === "" ? "" : +e.target.value })} style={{ ...inputStyle, width: 60, textAlign: "right", padding: "7px 8px" }} /> : <span style={{ fontSize: 13, color: DS.mut, width: 44, textAlign: "right", paddingTop: 6 }}>{b.minutes || 0}m</span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              {canEdit ? <Field value={b.name || ""} onSave={v => setBlock(i, { name: v })} placeholder="Block" style={{ fontWeight: 700, padding: "7px 9px", marginBottom: 4 }} /> : <div style={{ fontSize: 14, fontWeight: 700 }}>{b.name}</div>}
              {canEdit ? <Field value={b.desc || ""} onSave={v => setBlock(i, { desc: v })} multiline minRows={1} placeholder="Drills, cues, setup…" style={{ fontSize: 13, padding: "7px 9px" }} /> : (b.desc && <div style={{ fontSize: 13, color: DS.mut, lineHeight: 1.45 }}>{b.desc}</div>)}
            </div>
            {canEdit && <Btn kind="quiet" small onClick={() => setPlan({ blocks: blocks.filter((_, ix) => ix !== i) })} style={{ color: DS.orange }}>✕</Btn>}
          </div>
        ))}
        {!blocks.length && <div style={{ fontSize: 13, color: DS.mut }}>{canEdit ? "No blocks yet — add one, or paste a plan from a doc." : "No plan yet."}</div>}
      </div>
      {canEdit && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <Btn small onClick={() => setPlan({ blocks: [...blocks, { id: rid(), name: "", minutes: 15, desc: "" }] })}>+ Block</Btn>
          <Btn small onClick={() => setPaste(paste == null ? "" : null)}>{paste == null ? "Paste a plan" : "Close"}</Btn>
          {onOpenPlaybook && <Btn kind="link" small onClick={onOpenPlaybook} style={{ marginLeft: "auto" }}>Playbook →</Btn>}
        </div>
      )}
      {canEdit && paste != null && (() => {
        const parsed = parsePlanPaste(paste), keep = blocks.filter(b => String(b.name || "").trim() || String(b.desc || "").trim());
        const apply = (mode) => { if (!parsed.length) { window.alert("Each row needs a time (like 0–10), then the block name, then the focus."); return; } setPlan({ blocks: mode === "replace" ? parsed : [...keep, ...parsed] }); setPaste(null); };
        return (
          <div style={{ marginTop: 10, padding: 12, borderRadius: 10, border: "1px dashed " + DS.lime, background: DS.limeSoft }}>
            <div style={{ fontSize: 12, color: DS.mut, marginBottom: 6 }}>Rows like <b style={{ color: DS.text }}>0–10 · Warm-up · Start close, back up</b> — tab, pipe or two-space separated.</div>
            <Grow value={paste} onChange={e => setPaste(e.target.value)} minRows={5} placeholder={"Time\tSegment\tFocus\n0–10\tThrowing warm-up\tStart close and back up…"} style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: parsed.length ? DS.lime : DS.mut }}>{parsed.length ? `${parsed.length} blocks · ${parsed.reduce((n, b) => n + (Number(b.minutes) || 0), 0)} min` : "Nothing parsed yet"}</span>
              <div style={{ flex: 1 }} />
              {keep.length > 0 && <Btn small disabled={!parsed.length} onClick={() => apply("append")}>Add to existing</Btn>}
              <Btn small kind="primary" disabled={!parsed.length} onClick={() => apply("replace")}>{keep.length ? "Replace blocks" : "Create blocks"}</Btn>
            </div>
          </div>
        );
      })()}
      {c.director_notes && <div style={{ marginTop: 12, fontSize: 13, color: DS.mut, borderLeft: "3px solid " + DS.orange, paddingLeft: 10, whiteSpace: "pre-wrap" }}><b style={{ color: DS.text }}>Director notes:</b> {c.director_notes}</div>}
    </Card>
  </>);
}

// ── Players ─────────────────────────────────────────────────────────────────
function PlayersTab({ c, s, roster, reload, canEdit, coachName, podAttendance, reloadAttendance }) {
  const att = podAttendance.find(a => a.clinic_id === c.id && String(a.session_id) === String(s.id));
  const present = new Set((Array.isArray(att?.present) ? att.present : []).map(String));
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ player_name: "", parent_name: "", parent_email: "", parent_phone: "", sms_consent: false, all: true });
  const [saving, setSaving] = useState(false);
  const savePresent = async (nextSet) => {
    const ids = [...nextSet];
    const row = { clinic_id: c.id, session_id: String(s.id), session_date: s.date, players: ids.length, present: ids, recorded_by: coachName, recorded_at: new Date().toISOString() };
    const { error } = await supabase.from("dssc_pod_attendance").upsert(row, { onConflict: "clinic_id,session_id" });
    if (error) window.alert("Couldn't save attendance: " + error.message);
    reloadAttendance && reloadAttendance();
  };
  const toggle = (id) => { const n = new Set(present); n.has(String(id)) ? n.delete(String(id)) : n.add(String(id)); savePresent(n); };
  const add = async () => {
    if (!f.player_name.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("dssc_pod_roster").insert({ clinic_id: c.id, session_id: f.all ? null : String(s.id), player_name: f.player_name.trim(), parent_name: f.parent_name.trim() || null, parent_email: f.parent_email.trim() || null, parent_phone: f.parent_phone.trim() || null, sms_consent: !!f.sms_consent, source: "manual", added_by: coachName });
    setSaving(false);
    if (error) { window.alert("Couldn't add: " + error.message); return; }
    setF({ player_name: "", parent_name: "", parent_email: "", parent_phone: "", sms_consent: false, all: true }); setAdding(false); reload();
  };
  const remove = async (r) => { if (!window.confirm("Remove " + r.player_name + " from this roster?")) return; await supabase.from("dssc_pod_roster").delete().eq("id", r.id); reload(); };
  const fi = (k, ph, type) => <input type={type || "text"} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} placeholder={ph} style={{ ...inputStyle, padding: "8px 10px", fontSize: 13 }} />;
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <Label style={{ marginBottom: 0 }}>Signed up{roster ? " · " + roster.length : ""}</Label>
        {roster?.length > 0 && <span style={{ fontSize: 12, color: DS.mut }}>{present.size} here</span>}
        <div style={{ flex: 1 }} />
        {canEdit && <Btn small onClick={() => setAdding(v => !v)}>{adding ? "Close" : "+ Add player"}</Btn>}
      </div>
      {roster == null ? <div style={{ fontSize: 13, color: DS.mut }}>Loading…</div> : !roster.length ? (
        <div style={{ fontSize: 13, color: DS.mut, lineHeight: 1.5 }}>No one on the roster yet. Sign-ups come over from Playbook; a walk-in can be added by hand.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {roster.map(r => {
            const on = present.has(String(r.id));
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 10, background: on ? DS.limeSoft : DS.panel2, border: "1px solid " + (on ? DS.lime : DS.line) }}>
                <button onClick={() => canEdit && toggle(r.id)} disabled={!canEdit} title={on ? "Here" : "Mark here"} style={{ width: 26, height: 26, borderRadius: 8, border: "2px solid " + (on ? DS.lime : DS.lineStrong), background: on ? DS.lime : "transparent", color: DS.bg, fontWeight: 900, cursor: canEdit ? "pointer" : "default", flexShrink: 0, fontFamily: DS.font }}>{on ? "✓" : ""}</button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{r.player_name}{r.age ? <span style={{ color: DS.mut, fontWeight: 500 }}> · {r.age}</span> : null}{r.session_id ? <Tag color={DS.mut}> this class only</Tag> : null}</div>
                  <div style={{ fontSize: 12, color: DS.mut, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{[r.parent_name, r.parent_phone ? r.parent_phone + (r.sms_consent ? " ✓ text" : " (no text consent)") : null, r.parent_email].filter(Boolean).join(" · ") || "no contact on file"}</div>
                  {r.notes && <div style={{ fontSize: 12, color: DS.orange }}>{r.notes}</div>}
                </div>
                {canEdit && r.source === "manual" && <Btn kind="quiet" small onClick={() => remove(r)} style={{ color: DS.orange }}>✕</Btn>}
              </div>
            );
          })}
        </div>
      )}
      {adding && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 10, border: "1px dashed " + DS.lime, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 }}>
          {fi("player_name", "Player name")}{fi("parent_name", "Parent name")}{fi("parent_email", "Parent email", "email")}{fi("parent_phone", "Parent mobile", "tel")}
          <label style={{ fontSize: 12, color: DS.mut, display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={f.sms_consent} onChange={e => setF({ ...f, sms_consent: e.target.checked })} /> Parent agreed to texts</label>
          <label style={{ fontSize: 12, color: DS.mut, display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={f.all} onChange={e => setF({ ...f, all: e.target.checked })} /> Every class of this program</label>
          <div style={{ gridColumn: "1/-1", display: "flex", gap: 8 }}><Btn small kind="primary" disabled={saving || !f.player_name.trim()} onClick={add}>{saving ? "…" : "Add"}</Btn></div>
        </div>
      )}
    </Card>
  );
}

// ── Message the class ───────────────────────────────────────────────────────
function MessageTab({ c, s, roster, media, picked, setPicked, messages, reloadMessages, reloadMedia, canEdit, coachName }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const emails = new Set(roster.map(r => nrm(r.parent_email)).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)));
  const phones = roster.filter(r => String(r.parent_phone || "").replace(/\D/g, "").length >= 10);
  const texting = phones.filter(r => r.sms_consent).length, noConsent = phones.length - texting;
  const send = async () => {
    if (!body.trim() && !picked.length) return;
    if (!window.confirm(`Send to ${roster.length} famil${roster.length === 1 ? "y" : "ies"} on ${c.name} (${fmtDay(s.date, "")})?`)) return;
    setSending(true); setResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/dssc-class-message", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify({ clinic_id: c.id, session_id: String(s.id), body: body.trim(), media_ids: picked }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
      setResult(d); setBody(""); setPicked([]); reloadMessages(); reloadMedia();
    } catch (e) { setResult({ error: e.message }); }
    setSending(false);
  };
  const pub = (m) => supabase.storage.from("dssc-media").getPublicUrl(m.storage_path).data.publicUrl;
  return (<>
    <Card accent={DS.lime}>
      <Label>Message the families in this class</Label>
      <div style={{ fontSize: 12, color: DS.mut, marginBottom: 8, lineHeight: 1.5 }}>
        {roster.length ? <>{roster.length} famil{roster.length === 1 ? "y" : "ies"} · {emails.size} by email · {texting} by text{noConsent ? ` · ${noConsent} phone${noConsent === 1 ? "" : "s"} without text consent` : ""}</> : "Nobody on the roster yet — add players first."}
        <span style={{ display: "block", color: DS.dim, marginTop: 2 }}>Texts go out once the club's texting number is approved; until then everyone gets email.</span>
      </div>
      <Grow value={body} onChange={e => setBody(e.target.value)} minRows={4} placeholder={"Hi families — great class today! We worked on…\n\nNext week: bring…"} disabled={!canEdit} />
      {media.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: DS.mut, marginBottom: 6 }}>Attach from this class's photos & video:</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {media.map(m => { const on = picked.includes(m.id); return (
              <button key={m.id} onClick={() => setPicked(on ? picked.filter(x => x !== m.id) : [...picked, m.id])} style={{ width: 64, height: 64, borderRadius: 8, overflow: "hidden", border: "3px solid " + (on ? DS.lime : "transparent"), padding: 0, background: DS.panel2, cursor: "pointer", position: "relative" }}>
                {m.kind === "image" ? <img src={pub(m)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <video src={pub(m)} muted preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                {m.kind !== "image" && <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#fff", fontSize: 20, textShadow: "0 1px 4px #000" }}>▶</span>}
              </button>); })}
          </div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <Btn kind="primary" disabled={!canEdit || sending || !roster.length || (!body.trim() && !picked.length)} onClick={send}>{sending ? "Sending…" : `Send${picked.length ? " + " + picked.length + " attachment" + (picked.length === 1 ? "" : "s") : ""}`}</Btn>
        {result?.error && <span style={{ fontSize: 13, color: DS.orange, fontWeight: 700 }}>{result.error}</span>}
        {result && !result.error && <span style={{ fontSize: 13, color: DS.lime, fontWeight: 700 }}>Sent · {result.emails_sent} email{result.emails_sent === 1 ? "" : "s"}{result.texts_sent ? ` · ${result.texts_sent} texts` : ""}{result.note ? <span style={{ color: DS.mut, fontWeight: 500 }}> · {result.note}</span> : null}</span>}
      </div>
    </Card>
    {messages.length > 0 && (
      <Card>
        <Label>Sent to this class</Label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {messages.map(m => (
            <div key={m.id} style={{ padding: "9px 11px", borderRadius: 10, background: DS.panel2, border: "1px solid " + DS.line }}>
              <div style={{ fontSize: 12, color: DS.mut, marginBottom: 3 }}>{new Date(m.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {m.sent_by} · {m.emails_sent} email{m.emails_sent === 1 ? "" : "s"}{m.texts_sent ? ` · ${m.texts_sent} texts` : ""}{(m.media_ids || []).length ? ` · ${m.media_ids.length} attachment${m.media_ids.length === 1 ? "" : "s"}` : ""}</div>
              <div style={{ fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{m.body || <i style={{ color: DS.mut }}>(attachments only)</i>}</div>
            </div>
          ))}
        </div>
      </Card>
    )}
  </>);
}

// ── Photos & video ──────────────────────────────────────────────────────────
function MediaTab({ c, s, media, reload, picked, setPicked, canEdit, coachName, goMessage }) {
  const [prog, setProg] = useState(null);   // "2 / 5"
  const fileRef = useRef(null);
  const pub = (m) => supabase.storage.from("dssc-media").getPublicUrl(m.storage_path).data.publicUrl;
  const upload = async (files) => {
    const list = [...files]; if (!list.length) return;
    let n = 0;
    for (const f of list) {
      n++; setProg(n + " / " + list.length);
      const ext = (f.name.split(".").pop() || "bin").toLowerCase();
      const path = `${c.id}/${s.id}/${Date.now()}-${rid()}.${ext}`;
      const kind = f.type.startsWith("video/") ? "video" : "image";
      const up = await supabase.storage.from("dssc-media").upload(path, f, { contentType: f.type || undefined, cacheControl: "31536000" });
      if (up.error) { window.alert(f.name + ": " + up.error.message); continue; }
      const { error } = await supabase.from("dssc_class_media").insert({ clinic_id: c.id, session_id: String(s.id), storage_path: path, kind, content_type: f.type || null, bytes: f.size, uploaded_by: coachName });
      if (error) { await supabase.storage.from("dssc-media").remove([path]); window.alert(f.name + ": " + error.message); }
    }
    setProg(null); if (fileRef.current) fileRef.current.value = ""; reload();
  };
  const del = async (m) => { if (!window.confirm("Delete this " + m.kind + "?")) return; await supabase.from("dssc_class_media").delete().eq("id", m.id); await supabase.storage.from("dssc-media").remove([m.storage_path]); setPicked(picked.filter(x => x !== m.id)); reload(); };
  const caption = async (m, v) => { await supabase.from("dssc_class_media").update({ caption: v || null }).eq("id", m.id); reload(); };
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <Label style={{ marginBottom: 0 }}>Photos & video · this class only</Label>
        <div style={{ flex: 1 }} />
        {picked.length > 0 && <Btn small kind="primary" onClick={goMessage}>Send {picked.length} to the class ›</Btn>}
        {canEdit && <><input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display: "none" }} onChange={e => upload(e.target.files)} />
          <Btn small onClick={() => fileRef.current?.click()} disabled={!!prog}>{prog ? "Uploading " + prog : "＋ Upload"}</Btn></>}
      </div>
      {!media.length ? <div style={{ fontSize: 13, color: DS.mut, lineHeight: 1.5 }}>Nothing yet. Snap a few during class — pick them here and they go to these families only, never the whole program.</div> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10 }}>
          {media.map(m => { const on = picked.includes(m.id); return (
            <div key={m.id} style={{ borderRadius: 10, overflow: "hidden", background: DS.panel2, border: "2px solid " + (on ? DS.lime : DS.line) }}>
              <button onClick={() => setPicked(on ? picked.filter(x => x !== m.id) : [...picked, m.id])} style={{ display: "block", width: "100%", aspectRatio: "1", padding: 0, border: "none", background: "#000", cursor: "pointer", position: "relative" }}>
                {m.kind === "image" ? <img src={pub(m)} alt={m.caption || ""} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : <video src={pub(m)} muted preload="metadata" playsInline style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                {m.kind !== "image" && <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#fff", fontSize: 28, textShadow: "0 1px 6px #000" }}>▶</span>}
                <span style={{ position: "absolute", top: 6, left: 6, width: 22, height: 22, borderRadius: 6, background: on ? DS.lime : "rgba(0,0,0,0.5)", color: DS.bg, fontWeight: 900, display: "grid", placeItems: "center", fontSize: 13 }}>{on ? "✓" : ""}</span>
                {m.sent_at && <span style={{ position: "absolute", bottom: 6, right: 6, fontSize: 10, fontWeight: 800, background: DS.lime, color: DS.bg, borderRadius: 5, padding: "1px 6px" }}>SENT</span>}
              </button>
              <div style={{ padding: "6px 8px", display: "flex", gap: 4, alignItems: "center" }}>
                {canEdit ? <Field value={m.caption || ""} onSave={v => caption(m, v)} placeholder="Caption" style={{ fontSize: 12, padding: "5px 7px" }} /> : <span style={{ fontSize: 12, color: DS.mut, flex: 1 }}>{m.caption || ""}</span>}
                <a href={pub(m)} target="_blank" rel="noreferrer" style={{ color: DS.mut, fontSize: 12, textDecoration: "none" }} title="Open">↗</a>
                {canEdit && <Btn kind="quiet" small onClick={() => del(m)} style={{ color: DS.orange, padding: "4px 6px" }}>✕</Btn>}
              </div>
            </div>); })}
        </div>
      )}
    </Card>
  );
}

// ── Recap ───────────────────────────────────────────────────────────────────
function RecapTab({ c, s, canEdit, isDirector, coachName, saveClinic, saveSession }) {
  const notes = (Array.isArray(c.plan?.blocks) ? c.plan.blocks : []).filter(b => String(b.notes || "").trim());
  return (<>
    <Card accent={DS.lime}>
      <Label>This class — how it went</Label>
      <div style={{ fontSize: 12, color: DS.mut, marginBottom: 8 }}>Shows on the next class so whoever coaches it picks up where you left off.</div>
      <Field value={s.recap || ""} onSave={v => saveSession(c, s.id, { recap: v })} multiline minRows={3} placeholder="What clicked, what didn't, who stood out, where to pick up next time…" readOnly={!canEdit} />
    </Card>
    {notes.length > 0 && (
      <Card>
        <Label>Block notes from the run</Label>
        {notes.map((b, i) => <div key={b.id || i} style={{ fontSize: 13, marginBottom: 6 }}><b>{b.name}</b> <span style={{ color: DS.mut }}>— {b.notes}</span></div>)}
      </Card>
    )}
    <Card>
      <Label>Program feedback for the director</Label>
      <Field value={c.coach_feedback || ""} onSave={v => saveClinic(c.id, { coach_feedback: v, coach_feedback_by: coachName, coach_feedback_at: new Date().toISOString() })} multiline minRows={3} placeholder="Attendance, what's working across the program, anything the director should know…" readOnly={!canEdit} />
      {c.coach_feedback_by && <div style={{ fontSize: 11, color: DS.dim, marginTop: 4 }}>— {c.coach_feedback_by}{c.coach_feedback_at ? " · " + new Date(c.coach_feedback_at).toLocaleDateString() : ""}</div>}
      <Label style={{ marginTop: 14, color: DS.orange }}>Director notes</Label>
      <Field value={c.director_notes || ""} onSave={v => saveClinic(c.id, { director_notes: v })} multiline minRows={2} placeholder="—" readOnly={!isDirector} />
    </Card>
  </>);
}

// ── Class runner (per-block timer) ──────────────────────────────────────────
function Runner({ c, run, setRun, saveClinic, onEnd }) {
  const plan = c.plan || {}, blocks = Array.isArray(plan.blocks) ? plan.blocks : [];
  const setBlock = (i, patch) => saveClinic(c.id, { plan: { ...plan, blocks: blocks.map((b, ix) => ix === i ? { ...b, ...patch } : b) } });
  const goTo = (i) => { const mins = Number(blocks[i]?.minutes) || 10; setRun({ idx: i, paused: false, endsAt: Date.now() + mins * 60000, remainingMs: null }); };
  const idx = run.idx, b = blocks[idx] || {};
  const remMs = run.paused ? (run.remainingMs || 0) : (run.endsAt - Date.now());
  const over = remMs < 0, soon = !over && remMs <= 60000;
  const secs = Math.max(0, Math.ceil(Math.abs(remMs) / 1000));
  const mmss = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
  const col = over ? DS.orange : soon ? DS.orange : DS.lime;
  const blockMs = (Number(b.minutes) || 10) * 60000, pct = Math.max(0, Math.min(100, over ? 0 : (remMs / blockMs) * 100));
  const big = { padding: "12px 22px", borderRadius: 12, fontSize: 18, fontWeight: 900 };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: DS.bg, overflowY: "auto", fontFamily: DS.font, color: DS.text }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "14px 16px 40px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <img src="/dssc/icon-white.png" alt="" style={{ height: 26 }} />
          <div style={{ fontSize: 14, fontWeight: 800, flex: 1 }}>{c.name}</div>
          <Btn small onClick={() => setRun(null)}>Exit</Btn>
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: DS.mut, textAlign: "center" }}>Block {idx + 1} of {blocks.length}{over ? " · time up" : soon ? " · finishing" : ""}</div>
        <div style={{ fontSize: 26, fontWeight: 900, textAlign: "center", lineHeight: 1.05, margin: "6px 0 2px" }}>{b.name || "Block"}</div>
        <div style={{ fontSize: 72, fontWeight: 900, color: col, textAlign: "center", lineHeight: 1, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>{over ? "+" : ""}{mmss}</div>
        <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.1)", overflow: "hidden", margin: "10px 0 2px" }}><div style={{ height: "100%", width: pct + "%", background: col, transition: "width .4s linear" }} /></div>
        {run.paused && <div style={{ fontSize: 12, fontWeight: 800, color: DS.orange, textAlign: "center" }}>Paused</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "center", margin: "14px 0", flexWrap: "wrap" }}>
          <Btn onClick={() => idx > 0 && goTo(idx - 1)} disabled={idx === 0} style={{ fontSize: 20, padding: "10px 14px" }}>⏮</Btn>
          {run.paused ? <Btn kind="primary" style={big} onClick={() => setRun(r => ({ ...r, paused: false, endsAt: Date.now() + (r.remainingMs || 0) }))}>▶ Resume</Btn>
            : <Btn kind="warn" style={big} onClick={() => setRun(r => ({ ...r, paused: true, remainingMs: r.endsAt - Date.now() }))}>⏸ Pause</Btn>}
          <Btn onClick={() => setRun(r => r.paused ? ({ ...r, remainingMs: (r.remainingMs || 0) + 60000 }) : ({ ...r, endsAt: r.endsAt + 60000 }))} style={{ fontWeight: 800 }}>+1:00</Btn>
          <Btn onClick={() => goTo(idx)} style={{ fontSize: 18, padding: "10px 14px" }}>↺</Btn>
          <Btn onClick={() => idx < blocks.length - 1 && goTo(idx + 1)} disabled={idx >= blocks.length - 1} style={{ fontSize: 20, padding: "10px 14px" }}>⏭</Btn>
        </div>
        {b.desc && <div style={{ fontSize: 15, lineHeight: 1.5, background: DS.panel, border: "1px solid " + DS.line, borderRadius: 10, padding: "12px 14px", marginBottom: 10, whiteSpace: "pre-wrap" }}>{b.desc}</div>}
        <div style={{ marginBottom: 14 }}>
          <Label>How did it go?</Label>
          <Field value={b.notes || ""} onSave={v => setBlock(idx, { notes: v })} multiline minRows={2} placeholder="What worked, what to fix, standout kids…" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {blocks.map((bl, i) => (
            <button key={bl.id || i} onClick={() => goTo(i)} style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", padding: "10px 12px", borderRadius: 10, border: "1px solid " + (i === idx ? DS.lime : DS.line), background: i === idx ? DS.limeSoft : DS.panel, cursor: "pointer", fontFamily: DS.font, color: DS.text }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: i === idx ? DS.lime : DS.mut, minWidth: 20 }}>{i + 1}</span>
              <span style={{ flex: 1, fontSize: 14, fontWeight: i === idx ? 800 : 600 }}>{bl.name || "Block"}</span>
              {(bl.notes || "").trim() && <span>📝</span>}
              <span style={{ fontSize: 12, color: DS.mut, fontWeight: 700 }}>{Number(bl.minutes) || 0}m</span>
            </button>
          ))}
        </div>
        <Btn kind="primary" style={{ width: "100%", justifyContent: "center", padding: 14, fontSize: 16, fontWeight: 900 }} onClick={() => { if (window.confirm("End the class?")) onEnd(); }}>✓ End class → write the recap</Btn>
      </div>
    </div>
  );
}
