// The weekly meeting (Drew, Oct 28 2026): what the directors need to talk
// about, most critical first - tasks and projects in trouble, court
// discrepancies, programming gaps and overlaps, planned programs not in
// Playbook yet, school days off with nothing on them, classes with no coach or
// plan, and families who didn't hear from their coach. Everything comes from
// /api/weekly-meeting (worked out from HQ's own data). Each item shows how much
// time is left before it's late, opens the screen it lives on, and can be
// turned into a task. "Discussed" ticks are kept per week on this device.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Card } from "./DsscHub.jsx";
import { realApi, sel } from "./taskKit.jsx";

const SECTIONS = [
  ["tasks", "Tasks & projects", "✅"],
  ["courts", "Court discrepancies", "🏟"],
  ["programming", "Programming gaps & overlaps", "📆"],
  ["playbook", "Planned but not in Playbook", "📋"],
  ["school", "School days off", "🏫"],
  ["classes", "Coaches & class plans", "🧑‍🏫"],
  ["comms", "Class comms", "📣"],
];
const SEV = { critical: ["Critical", "#ff6b5a"], high: ["High", "#FF9F43"], watch: ["Watch", "#A9C7C3"] };
const mondayOf = (ymd) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const fmtWeek = (ymd) => new Date(ymd + "T12:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric" });
const store = { get: (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } } };

async function meetingApi(part) {
  const { data: { session } = {} } = await supabase.auth.getSession();
  const r = await fetch("/api/weekly-meeting" + (part ? "?part=" + part : ""), { headers: { Authorization: "Bearer " + (session?.access_token || "") } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || "Request failed (" + r.status + ")");
  return d;
}

function Countdown({ days }) {
  if (days == null) return null;
  const [txt, color] = days < 0 ? [`${-days}d late`, "#ff6b5a"] : days === 0 ? ["today", "#FF9F43"] : days <= 7 ? [`${days}d left`, "#FF9F43"] : [`${days}d left`, DS.mut];
  return <span style={{ fontSize: 11, fontWeight: 800, color, border: "1px solid " + color, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>{txt}</span>;
}

export default function WeeklyMeeting({ onOpenView, fetchPart = meetingApi, api = realApi }) {
  const [main, setMain] = useState(null);
  const [courts, setCourts] = useState(null);
  const [err, setErr] = useState("");
  const [courtErr, setCourtErr] = useState("");
  const [sev, setSev] = useState("");
  const [hideDone, setHideDone] = useState(false);
  const [people, setPeople] = useState([]);
  const [making, setMaking] = useState(null);           // { item, assignee, due }
  const [made, setMade] = useState({});
  const [tick, setTick] = useState(0);
  const load = () => {
    setMain(null); setCourts(null); setErr(""); setCourtErr("");
    fetchPart().then(setMain).catch(e => setErr(e.message));
    fetchPart("courts").then(setCourts).catch(e => setCourtErr(e.message));
  };
  useEffect(() => { load(); api("bootstrap").then(d => setPeople(d.people || [])).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const today = main?.today || new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const weekKey = "hq-meeting-discussed:" + mondayOf(today);
  const discussed = useMemo(() => store.get(weekKey) || {}, [weekKey, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id) => { const d = { ...(store.get(weekKey) || {}) }; d[id] ? delete d[id] : (d[id] = 1); store.set(weekKey, d); setTick(t => t + 1); };

  if (err) return <div style={{ padding: 24, color: DS.orange, fontFamily: DS.font }}>{err}</div>;
  const items = [...(main?.items || []), ...(courts?.items || [])];
  const shown = items.filter(x => (!sev || x.severity === sev) && !(hideDone && discussed[x.id]));
  const count = (s) => items.filter(x => x.severity === s).length;
  const doneN = items.filter(x => discussed[x.id]).length;

  const makeTask = async () => {
    const { item, assignee, due } = making;
    try {
      await api("save_task", { task: { title: item.task?.title || item.title, details: item.detail, due_date: due || null, assignee_email: assignee || null, category: item.task?.category || null, hq_view: item.task?.hq_view || item.link?.view || null, priority: item.severity === "critical" ? "high" : "normal" } });
      setMade(m => ({ ...m, [item.id]: true })); setMaking(null);
    } catch (e) { window.alert(e.message); }
  };
  const copyAgenda = () => {
    const lines = [`Weekly meeting - week of ${fmtWeek(mondayOf(today))}`, ""];
    for (const [k, label] of SECTIONS) {
      const list = items.filter(x => x.section === k);
      if (!list.length) continue;
      lines.push(label.toUpperCase());
      for (const x of list) lines.push(`- [${SEV[x.severity][0]}] ${x.title}${x.days_left != null ? ` (${x.days_left < 0 ? -x.days_left + "d late" : x.days_left + "d left"})` : ""}${x.who ? " - " + x.who : ""}`);
      lines.push("");
    }
    navigator.clipboard?.writeText(lines.join("\n")).then(() => window.alert("Agenda copied - paste it into Slack or a doc."), () => {});
  };

  return (
    <div style={{ fontFamily: DS.font, color: DS.text, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>🗓 Weekly Meeting</div>
        <span style={{ color: DS.mut, fontSize: 14 }}>week of {fmtWeek(mondayOf(today))}</span>
        <div style={{ flex: 1 }} />
        <Btn small kind="ghost" onClick={copyAgenda} disabled={!main}>Copy agenda</Btn>
        <Btn small kind="quiet" onClick={load}>Refresh</Btn>
      </div>
      <div style={{ fontSize: 13, color: DS.mut, marginBottom: 14, lineHeight: 1.5 }}>What needs a decision this week, worked out from HQ: the most critical first, with how long is left before each one is late. Tick items off as you talk about them, open the screen behind each one, or turn it into a task.</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 12 }}>
        {["critical", "high", "watch"].map(s => (
          <button key={s} onClick={() => setSev(sev === s ? "" : s)} style={{ textAlign: "left", background: sev === s ? SEV[s][1] + "22" : DS.panel, border: "1px solid " + (sev === s ? SEV[s][1] : DS.line), borderRadius: 12, padding: "10px 12px", cursor: "pointer", fontFamily: DS.font, color: DS.text }}>
            <div style={{ fontSize: 26, fontWeight: 900, color: count(s) ? SEV[s][1] : DS.dim, lineHeight: 1.1 }}>{count(s)}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: DS.mut }}>{SEV[s][0]}</div>
          </button>
        ))}
        <div style={{ background: DS.panel, border: "1px solid " + DS.line, borderRadius: 12, padding: "10px 12px" }}>
          <div style={{ fontSize: 26, fontWeight: 900, color: DS.lime, lineHeight: 1.1 }}>{doneN}<span style={{ fontSize: 14, color: DS.mut }}> / {items.length}</span></div>
          <div style={{ fontSize: 12, fontWeight: 700, color: DS.mut, display: "flex", gap: 8, alignItems: "center" }}>Discussed <label style={{ display: "inline-flex", gap: 4, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} style={{ accentColor: DS.lime }} />hide</label></div>
        </div>
      </div>

      {!main && <Card><div style={{ color: DS.mut }}>Pulling this week's agenda together…</div></Card>}
      {main && SECTIONS.map(([k, label, icon]) => {
        const list = shown.filter(x => x.section === k);
        const loadingCourts = k === "courts" && !courts && !courtErr;
        if (!list.length && !loadingCourts && !(k === "courts" && courtErr)) return null;
        return (
          <Card key={k} style={{ padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 16 }}>{icon}</span><b style={{ fontSize: 15 }}>{label}</b>
              <span style={{ fontSize: 12, color: DS.mut }}>{list.length}</span>
            </div>
            {loadingCourts && <div style={{ fontSize: 13, color: DS.mut, padding: "4px 2px" }}>Checking the next two weeks of courts against Playbook (takes a few seconds)…</div>}
            {k === "courts" && courtErr && <div style={{ fontSize: 13, color: DS.orange }}>{courtErr}</div>}
            {list.map(x => {
              const done = !!discussed[x.id];
              return (
                <div key={x.id} style={{ borderTop: "1px solid " + DS.line, padding: "9px 2px", opacity: done ? 0.5 : 1 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <input type="checkbox" checked={done} onChange={() => toggle(x.id)} title="Discussed" style={{ accentColor: DS.lime, width: 17, height: 17, marginTop: 2, flex: "0 0 auto" }} />
                    <span title={SEV[x.severity][0]} style={{ width: 10, height: 10, borderRadius: 10, background: SEV[x.severity][1], marginTop: 5, flex: "0 0 auto" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.35 }}>{x.title}</div>
                      {x.detail && <div style={{ fontSize: 12, color: DS.mut, marginTop: 2, lineHeight: 1.45 }}>{x.detail}</div>}
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
                        <Countdown days={x.days_left} />
                        {x.who && <span style={{ fontSize: 12, color: DS.text }}>👤 {x.who}</span>}
                        {x.link && onOpenView && <button onClick={() => onOpenView(x.link.view, x.link.params)} style={linkBtn}>Open ↗</button>}
                        {x.section !== "tasks" && (made[x.id] ? <span style={{ fontSize: 12, color: DS.lime, fontWeight: 700 }}>✓ Task made</span>
                          : <button onClick={() => setMaking({ item: x, assignee: "", due: x.task?.due_date && x.task.due_date >= today ? x.task.due_date : "" })} style={linkBtn}>＋ Make it a task</button>)}
                      </div>
                      {making?.item.id === x.id && (
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8, padding: 8, background: DS.panel2, borderRadius: 10 }}>
                          <span style={{ fontSize: 12, color: DS.mut }}>Who</span>
                          <select value={making.assignee} onChange={e => setMaking(m => ({ ...m, assignee: e.target.value }))} style={sel}><option value="">Unassigned</option>{people.map(p => <option key={p.email} value={p.email}>{p.name}</option>)}</select>
                          <span style={{ fontSize: 12, color: DS.mut }}>Due</span>
                          <input type="date" value={making.due} onChange={e => setMaking(m => ({ ...m, due: e.target.value }))} style={sel} />
                          <Btn small kind="primary" onClick={makeTask}>Add task</Btn>
                          <Btn small kind="quiet" onClick={() => setMaking(null)}>Cancel</Btn>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </Card>
        );
      })}
      {main && !shown.length && courts && <Card><div style={{ color: DS.mut }}>{items.length ? "Nothing left with these filters." : "Nothing to flag this week. 🎉"}</div></Card>}
    </div>
  );
}
const linkBtn = { background: "none", border: "none", color: DS.lime, fontWeight: 700, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: DS.font };
