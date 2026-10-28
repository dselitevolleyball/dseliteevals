// The check-in card (Drew, Oct 28 2026): "make it easier for people to update
// tasks by asking them simple questions about tasks and progress when they
// login or open the HQ".
//
// When someone with Tasks & Projects opens HQ, up to five quick questions
// about their own tasks, one at a time, most pressing first:
//   overdue    where is it?          Done / New date / Blocked / Need help
//   blocked    still blocked on …?   Moving again / Still blocked / Done
//   due today  on track?             Done / On track / New date / Need help
//   gone quiet any progress?         a one-line note / Still on it / Done
// Once a day ("Skip for today"), or again on the next visit ("Later"). The
// answers go through /api/projects like any other change (Slack hears about
// done, new dates, blockers and help; "on track" is logged quietly).
import { useEffect, useState } from "react";
import { DS } from "./DsscHub.jsx";
import { realApi } from "./taskKit.jsx";

const fmt = (ymd) => ymd ? new Date(ymd + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
const store = { get: (k, s = localStorage) => { try { return s.getItem(k); } catch { return null; } }, set: (k, v, s = localStorage) => { try { s.setItem(k, v); } catch { /* private window */ } } };

export default function TaskCheckin({ email, api = realApi, onOpenTasks }) {
  const [qs, setQs] = useState(null);
  const [i, setI] = useState(0);
  const [mode, setMode] = useState(null);      // "date" | "blocked" | "help" | "note"
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0);
  const [err, setErr] = useState("");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const doneKey = `hq-checkin:${email}:${today}`;

  useEffect(() => {
    if (!email || store.get(doneKey) || store.get("hq-checkin-later", sessionStorage)) return;
    let live = true;
    // Give HQ a moment to settle before asking anything.
    const t = setTimeout(() => api("checkin").then(d => { if (live && d.questions?.length) setQs(d.questions); }).catch(() => {}), 1500);
    return () => { live = false; clearTimeout(t); };
  }, [email]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!qs) return null;
  const close = (forToday) => { if (forToday) store.set(doneKey, "1"); else store.set("hq-checkin-later", "1", sessionStorage); setQs(null); };
  if (i >= qs.length) return (
    <Shell onClose={() => close(true)}>
      <div style={{ fontSize: 30, textAlign: "center" }}>🙌</div>
      <div style={{ fontSize: 17, fontWeight: 800, textAlign: "center", margin: "6px 0 4px" }}>{saved ? "Thanks, that's everything" : "All skipped"}</div>
      <div style={{ fontSize: 13, color: DS.mut, textAlign: "center", marginBottom: 14 }}>{saved ? `${saved} update${saved === 1 ? "" : "s"} saved to your tasks.` : "No changes. You'll get these again tomorrow."}</div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        {onOpenTasks && <Btn onClick={() => { close(true); onOpenTasks(); }}>Open my tasks</Btn>}
        <Btn primary onClick={() => close(true)}>Done</Btn>
      </div>
    </Shell>
  );

  const t = qs[i];
  const next = () => { setI(n => n + 1); setMode(null); setText(""); setDate(""); setErr(""); };
  const act = async (fn) => { setBusy(true); setErr(""); try { await fn(); setSaved(n => n + 1); next(); } catch (e) { setErr(e.message); } setBusy(false); };
  const save = (patch) => act(() => api("save_task", { task: { id: t.id, ...patch } }));
  const ok = (note) => act(() => api("checkin_ok", { task_id: t.id, note }));
  const help = (note) => act(() => api("help", { task_id: t.id, note }));
  const late = t.due_date && t.due_date < today;
  const q = t.kind === "overdue" ? `This was due ${fmt(t.due_date)}. Where is it?`
    : t.kind === "blocked" ? `Still blocked${t.blocker ? ` on "${t.blocker}"` : ""}?`
    : t.kind === "today" ? "This is due today. On track?"
    : "No update in a week. Any progress?";

  return (
    <Shell onClose={() => close(false)}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: DS.lime }}>Quick check-in · {i + 1} of {qs.length}</span>
        <div style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", gap: 3 }}>{qs.map((_, k) => <span key={k} style={{ width: 7, height: 7, borderRadius: 7, background: k < i ? DS.lime : k === i ? "#fff" : "rgba(255,255,255,0.2)" }} />)}</span>
      </div>
      <div style={{ fontSize: 12, color: DS.mut }}>{t.project_name ? "📌 " + t.project_name : t.series_id ? "🔁 Repeating task" : "Task"}</div>
      <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.3, margin: "2px 0 8px" }}>{t.title}</div>
      <div style={{ fontSize: 15, marginBottom: 14, color: late ? "#ff8a7a" : DS.text }}>{q}</div>

      {!mode && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {t.kind === "blocked" ? (<>
            <Btn primary disabled={busy} onClick={() => save({ status: "doing" })}>▶ Moving again</Btn>
            <Btn disabled={busy} onClick={() => ok()}>⛔ Still blocked</Btn>
            <Btn disabled={busy} onClick={() => save({ status: "done" })}>✓ It's done</Btn>
            <Btn disabled={busy} onClick={() => setMode("help")}>🙋 I need help</Btn>
          </>) : t.kind === "quiet" ? (<>
            <Btn primary disabled={busy} onClick={() => setMode("note")}>✍ Add a quick update</Btn>
            <Btn disabled={busy} onClick={() => ok()}>👍 Still on it</Btn>
            <Btn disabled={busy} onClick={() => save({ status: "done" })}>✓ It's done</Btn>
            <Btn disabled={busy} onClick={() => setMode("blocked")}>⛔ I'm blocked</Btn>
          </>) : (<>
            <Btn primary disabled={busy} onClick={() => save({ status: "done" })}>✓ {t.kind === "today" ? "Already done" : "It's done"}</Btn>
            {t.kind === "today" ? <Btn disabled={busy} onClick={() => ok()}>👍 On track</Btn> : <Btn disabled={busy} onClick={() => setMode("date")}>📅 New date</Btn>}
            {t.kind === "today" ? <Btn disabled={busy} onClick={() => setMode("date")}>📅 Needs a new date</Btn> : <Btn disabled={busy} onClick={() => setMode("blocked")}>⛔ I'm blocked</Btn>}
            <Btn disabled={busy} onClick={() => setMode("help")}>🙋 I need help</Btn>
          </>)}
        </div>
      )}
      {mode === "date" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: DS.mut }}>New due date</span>
          <input type="date" value={date} min={today} onChange={e => setDate(e.target.value)} style={input} autoFocus />
          <Btn primary disabled={busy || !date} onClick={() => save({ due_date: date, ...(t.status === "todo" ? { status: "doing" } : {}) })}>Save</Btn>
        </div>
      )}
      {(mode === "blocked" || mode === "help" || mode === "note") && (
        <div>
          <textarea value={text} onChange={e => setText(e.target.value)} autoFocus rows={2}
            placeholder={mode === "blocked" ? "What's it waiting on? (who or what)" : mode === "help" ? "What do you need? Drew and Slack will see it." : "Where it stands, in a line"}
            style={{ ...input, width: "100%", resize: "vertical" }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Btn primary disabled={busy || !text.trim()} onClick={() => mode === "blocked" ? save({ status: "blocked", blocker: text.trim() }) : mode === "help" ? help(text.trim()) : ok(text.trim())}>{mode === "help" ? "Ask for help" : "Save"}</Btn>
            <Btn onClick={() => { setMode(null); setText(""); }}>Back</Btn>
          </div>
        </div>
      )}
      {err && <div style={{ color: "#ff8a7a", fontSize: 13, marginTop: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 12, marginTop: 14, fontSize: 12 }}>
        <button onClick={next} style={link}>Skip this one</button>
        <div style={{ flex: 1 }} />
        <button onClick={() => close(false)} style={link}>Later</button>
        <button onClick={() => close(true)} style={link}>Skip for today</button>
      </div>
    </Shell>
  );
}

const input = { background: DS.panel2, border: "1px solid " + DS.line, borderRadius: 8, color: DS.text, fontFamily: DS.font, fontSize: 14, padding: "8px 10px", colorScheme: "dark", boxSizing: "border-box" };
const link = { background: "none", border: "none", color: DS.mut, cursor: "pointer", fontFamily: DS.font, fontSize: 12, padding: 0, textDecoration: "underline" };
function Btn({ primary, children, ...rest }) {
  return <button {...rest} style={{ padding: "11px 12px", borderRadius: 10, border: "1px solid " + (primary ? DS.lime : DS.lineStrong), background: primary ? DS.lime : "transparent", color: primary ? DS.bg : DS.text, fontFamily: DS.font, fontWeight: 800, fontSize: 14, cursor: rest.disabled ? "wait" : "pointer", opacity: rest.disabled ? 0.6 : 1, textAlign: "center" }}>{children}</button>;
}
function Shell({ children, onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Quick check-in on your tasks" style={{ width: "100%", maxWidth: 440, background: DS.panel, border: "1px solid " + DS.lineStrong, borderRadius: 18, padding: 18, boxSizing: "border-box", fontFamily: DS.font, color: DS.text, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>{children}</div>
    </div>
  );
}
