// Class Comms (Drew, Oct 28 2026, for Hunter): which classes got a message to
// families before and/or after class - what we're working on, the focus,
// practice-at-home ideas - and which coaches are doing it. Worked out from
// the classes and the class messages HQ already records (shared/class-comms.js);
// coaches don't log anything extra.
//
//   tiles        classes held, % messaged before, after, at all, recap written
//   by coach     a bar per lead coach: before & after / one of the two / none
//   by week      % of classes messaged each week
//   today        today's classes with no message yet, one tap to message them
//   classes      every class with ✓ before / after / recap, filterable to the misses
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Card, Label } from "./DsscHub.jsx";
import { classRows, coachStats, weeklyStats, totals, centralStamp, centralToday, clock24, leadOf } from "../../shared/class-comms.js";

// Ordinal greens, validated against the panel (dataviz validate_palette --ordinal --mode dark).
const BOTH = "#C9E36A", ONE = "#7A9A2E", TRACK = "rgba(255,255,255,0.10)", MISS = "#ff6b5a";
const plus = (ymd, n) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmtDay = (ymd) => new Date(ymd + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const pct = (n, d) => (d ? Math.round((100 * n) / d) : null);
const chipStyle = (on) => ({ fontFamily: DS.font, fontSize: 12, fontWeight: 700, padding: "5px 11px", borderRadius: 999, cursor: "pointer", border: "1px solid " + (on ? DS.lime : DS.line), background: on ? "rgba(178,208,73,0.13)" : "transparent", color: on ? DS.lime : DS.mut, whiteSpace: "nowrap" });

// load: a stand-in data source for a preview; HQ reads Supabase.
export default function ClassComms({ onMessageClass, load }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [sport, setSport] = useState("volleyball");
  const [days, setDays] = useState(30);
  const [coach, setCoach] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const today = centralToday();

  useEffect(() => {
    let live = true;
    const since = new Date(Date.now() - 100 * 864e5).toISOString();
    if (load) { load().then(d => live && setData(d)); return () => { live = false; }; }
    Promise.all([
      supabase.from("dssc_clinics").select("id, name, sport, coach_name, status, sessions"),
      supabase.from("dssc_class_messages").select("clinic_id, session_id, sent_by, created_at, emails_sent, texts_sent").gte("created_at", since),
    ]).then(([c, m]) => {
      if (!live) return;
      if (c.error || m.error) { setErr((c.error || m.error).message); return; }
      setData({ clinics: c.data || [], messages: m.data || [] });
    });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const now = centralStamp(new Date().toISOString());
  const rows = useMemo(() => data ? classRows({ ...data, from: plus(today, -days + 1), to: today, sport, now }) : [], [data, sport, days]); // eslint-disable-line react-hooks/exhaustive-deps
  const trendRows = useMemo(() => data ? classRows({ ...data, from: plus(today, -83), to: today, sport, now }) : [], [data, sport]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div style={{ padding: 24, color: DS.orange, fontFamily: DS.font }}>{err}</div>;
  if (!data) return <div style={{ padding: 24, color: DS.mut, fontFamily: DS.font }}>Loading class comms…</div>;

  const shown = coach ? rows.filter(r => r.lead.toLowerCase() === coach.toLowerCase()) : rows;
  const t = totals(shown);
  const coaches = coachStats(rows);
  const weeks = weeklyStats(trendRows).slice(-12);
  // Today's classes still to come or under way with no message yet.
  const upcoming = (data.clinics || []).filter(c => !sport || (c.sport || "volleyball") === sport).flatMap(c => (c.sessions || []).filter(s => s && s.date === today && !s.cancelled).map(s => {
    const msgs = data.messages.filter(m => m.clinic_id === c.id && m.session_id === s.id);
    return { c, s, lead: leadOf(c, s), start: clock24(s.start_time), messaged: msgs.length > 0 };
  })).filter(x => !x.messaged && (!coach || x.lead.toLowerCase() === coach.toLowerCase())).sort((a, b) => a.start.localeCompare(b.start));
  const tiles = [
    ["Classes held", t.classes, null, DS.text],
    ["Messaged before class", pct(t.before, t.classes), t.before, BOTH],
    ["Messaged after class", pct(t.after, t.classes), t.after, BOTH],
    ["Got any message", pct(t.messaged, t.classes), t.messaged, DS.lime],
    ["Coach recap written", pct(t.recap, t.classes), t.recap, "#7FD1C3"],
  ];
  const list = shown.filter(r => !missingOnly || r.state === "none").slice(0, 200);

  return (
    <div style={{ fontFamily: DS.font, color: DS.text, maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>📣 Class Comms</div>
        <div style={{ flex: 1 }} />
        {[["volleyball", "Volleyball"], ["basketball", "Basketball"], ["", "All"]].map(([k, l]) => <button key={l} onClick={() => { setSport(k); setCoach(""); }} style={chipStyle(sport === k)}>{l}</button>)}
        <span style={{ width: 6 }} />
        {[7, 30, 90].map(n => <button key={n} onClick={() => setDays(n)} style={chipStyle(days === n)}>{n} days</button>)}
      </div>
      <div style={{ fontSize: 13, color: DS.mut, marginBottom: 14, lineHeight: 1.5 }}>Did each class's families hear from the coach before class (what we're working on, the focus) and after it (how it went, practice-at-home ideas)? Worked out from the messages sent to a class in HQ. "Before" means sent before the class started. A class belongs to its lead coach.</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 14 }}>
        {tiles.map(([l, v, n, color]) => (
          <div key={l} style={{ background: DS.panel, border: "1px solid " + DS.line, borderRadius: 12, padding: "10px 12px" }}>
            <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.1, color: v == null ? DS.dim : color }}>{v == null ? "-" : n == null ? v : v + "%"}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: DS.mut }}>{l}{n != null ? ` · ${n} of ${t.classes}` : ""}</div>
          </div>
        ))}
      </div>

      {upcoming.length > 0 && (
        <Card accent="rgba(178,208,73,0.4)" style={{ padding: 12 }}>
          <Label>Today · no message to families yet · {upcoming.length}</Label>
          {upcoming.map(x => (
            <div key={x.c.id + x.s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 2px", borderTop: "1px solid " + DS.line, flexWrap: "wrap" }}>
              <b style={{ fontSize: 13, minWidth: 64 }}>{x.s.start_time}</b>
              <span style={{ flex: "1 1 240px", fontSize: 14 }}>{x.c.name}</span>
              <span style={{ fontSize: 13, color: DS.mut }}>{x.lead}</span>
              {onMessageClass && <Btn small kind="ghost" onClick={() => onMessageClass(x.c.id, x.s.id)}>Message the class</Btn>}
            </div>
          ))}
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14 }}>
        <Card style={{ padding: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <Label style={{ marginBottom: 2 }}>By coach · last {days} days</Label>
            <div style={{ flex: 1 }} />
            <span style={{ display: "inline-flex", gap: 10, fontSize: 11, color: DS.mut, alignItems: "center" }}>
              <span><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: BOTH, marginRight: 4, verticalAlign: -1 }} />Before &amp; after</span>
              <span><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: ONE, marginRight: 4, verticalAlign: -1 }} />One of the two</span>
              <span><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: TRACK, marginRight: 4, verticalAlign: -1, border: "1px solid " + DS.line }} />No message</span>
            </span>
          </div>
          <div style={{ fontSize: 12, color: DS.dim, marginBottom: 8 }}>Tap a coach to see only their classes.</div>
          {!coaches.length && <div style={{ color: DS.mut, fontSize: 13 }}>No classes in this period.</div>}
          {coaches.map(c => {
            const p = pct(c.both + c.one, c.classes), on = coach.toLowerCase() === c.coach.toLowerCase();
            return (
              <button key={c.coach} onClick={() => setCoach(on ? "" : c.coach)} title={`${c.coach}: ${c.classes} classes · before & after ${c.both} · one of the two ${c.one} · no message ${c.none} · sent by the coach ${c.byLead} · recaps ${c.recap}`}
                style={{ display: "grid", gridTemplateColumns: "minmax(110px, 160px) 1fr 70px", gap: 10, alignItems: "center", width: "100%", background: on ? "rgba(178,208,73,0.08)" : "transparent", border: "none", borderRadius: 8, padding: "6px 4px", cursor: "pointer", color: DS.text, fontFamily: DS.font, textAlign: "left" }}>
                <span style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.coach}</span>
                <span style={{ display: "flex", height: 12, borderRadius: 4, overflow: "hidden", background: TRACK, gap: 2 }}>
                  {c.both > 0 && <span style={{ width: (100 * c.both) / c.classes + "%", background: BOTH, borderRadius: "4px 0 0 4px" }} />}
                  {c.one > 0 && <span style={{ width: (100 * c.one) / c.classes + "%", background: ONE, borderRadius: c.both ? 0 : "4px 0 0 4px" }} />}
                </span>
                <span style={{ fontSize: 12, textAlign: "right", whiteSpace: "nowrap" }}><b>{p}%</b> <span style={{ color: DS.dim }}>of {c.classes}</span></span>
              </button>
            );
          })}
        </Card>

        <Card style={{ padding: 14 }}>
          <Label style={{ marginBottom: 2 }}>Classes messaged, by week</Label>
          <div style={{ fontSize: 12, color: DS.dim, marginBottom: 10 }}>Share of {sport || "all"} classes that got any message, last 12 weeks{coach ? " (everyone)" : ""}.</div>
          {!weeks.length ? <div style={{ color: DS.mut, fontSize: 13 }}>No classes yet.</div> : (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 150, borderBottom: "1px solid " + DS.line, paddingTop: 18 }}>
              {weeks.map(w => {
                const p = pct(w.messaged, w.classes) || 0;
                return (
                  <div key={w.week} title={`Week of ${fmtDay(w.week)}: ${w.messaged} of ${w.classes} classes messaged (${p}%) · before ${w.before} · after ${w.after}`} style={{ flex: 1, minWidth: 14, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", cursor: "default" }}>
                    <span style={{ fontSize: 10, color: DS.mut, marginBottom: 3 }}>{p}%</span>
                    <span style={{ width: "100%", maxWidth: 28, height: Math.max(2, p) + "%", background: DS.lime, borderRadius: "4px 4px 0 0" }} />
                  </div>
                );
              })}
            </div>
          )}
          {weeks.length > 0 && <div style={{ display: "flex", gap: 6, marginTop: 4 }}>{weeks.map(w => <span key={w.week} style={{ flex: 1, minWidth: 14, fontSize: 9, color: DS.dim, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden" }}>{new Date(w.week + "T12:00:00").toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</span>)}</div>}
        </Card>
      </div>

      <Card style={{ padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
          <Label style={{ marginBottom: 0 }}>Classes{coach ? " · " + coach : ""} · {list.length}</Label>
          {coach && <Btn small kind="link" onClick={() => setCoach("")}>Show every coach</Btn>}
          <div style={{ flex: 1 }} />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: DS.mut, cursor: "pointer" }}><input type="checkbox" checked={missingOnly} onChange={e => setMissingOnly(e.target.checked)} style={{ accentColor: DS.lime }} />Only classes with no message</label>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead><tr style={{ fontSize: 11, color: DS.mut, textAlign: "left" }}><th style={{ padding: 6 }}>When</th><th style={{ padding: 6 }}>Class</th><th style={{ padding: 6 }}>Lead coach</th><th style={{ padding: 6, textAlign: "center" }}>Before</th><th style={{ padding: 6, textAlign: "center" }}>After</th><th style={{ padding: 6, textAlign: "center" }}>Recap</th><th style={{ padding: 6 }}>Sent by</th></tr></thead>
            <tbody>
              {list.map(r => (
                <tr key={r.clinicId + r.sessionId} style={{ borderTop: "1px solid " + DS.line, fontSize: 13 }}>
                  <td style={{ padding: 6, whiteSpace: "nowrap" }}>{fmtDay(r.date)} · {r.startTime}</td>
                  <td style={{ padding: 6 }}>{r.name}</td>
                  <td style={{ padding: 6, whiteSpace: "nowrap" }}>{r.lead}</td>
                  <Mark on={r.before} /><Mark on={r.after} /><Mark on={r.recap} soft />
                  <td style={{ padding: 6, color: DS.mut, fontSize: 12 }}>{[...new Set(r.messages.map(m => m.sent_by).filter(Boolean))].join(", ") || <span style={{ color: MISS }}>No message</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <div style={{ color: DS.mut, fontSize: 13, padding: 8 }}>{missingOnly ? "Every class in this period got a message." : "No classes in this period."}</div>}
        </div>
      </Card>
    </div>
  );
}

function Mark({ on, soft }) {
  return <td style={{ padding: 6, textAlign: "center", fontWeight: 900, color: on ? (soft ? "#7FD1C3" : BOTH) : DS.dim }} aria-label={on ? "yes" : "no"}>{on ? "✓" : "–"}</td>;
}
