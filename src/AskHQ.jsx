// Ask HQ — the assistant panel, available on every admin screen.
//
// Slides in from the right. The admin asks in plain English; the server
// (api/ask-hq.js) has Claude query the database read-only and answer. Any
// email the assistant drafts comes back as a card with a Send button — the
// send is the admin's click, through the same /api/send-email everything
// else uses. The conversation lives in sessionStorage so switching screens
// doesn't lose it; "New" clears it.

import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";

const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", grn: "#22c55e", red: "#ef4444", amber: "#f59e0b" };
const KEY = "dse.askhq.v1";
const SUGGEST = {
  home: ["Who hasn't signed the commitment yet, by team?", "Which coaches haven't clocked in for their practices this week?", "What's on the calendar this weekend?"],
  housing: ["Who hasn't booked their room for the next stay-to-play tournament?", "Draft a reminder to the families who haven't booked."],
  travel: ["Which coaches still need flights booked for upcoming stay-over tournaments?"],
  timecards: ["Total hours per coach this pay week, with anything unusual.", "Who clocked in late or as a sub this week?"],
  clinics: ["Which DSSC classes this week have fewer than 3 signed up?", "Which pods have no coach in the next two weeks?"],
  dssc: ["Which DSSC classes this week have fewer than 3 signed up?"],
  roster: ["List each team's roster with parent emails.", "Which players are missing a jersey number?"],
  coaches: ["Which coaches are on more than one team, and which teams?"],
  email: ["What emails went out in the last 7 days and to how many people?"],
};

function Md({ text }) {
  // Just enough: paragraphs, bullets, bold.
  const lines = String(text || "").split("\n");
  const out = []; let list = [];
  const flush = () => { if (list.length) { out.push(<ul key={out.length} style={{ margin: "4px 0 8px", paddingLeft: 18 }}>{list.map((l, i) => <li key={i} style={{ marginBottom: 3 }}>{inline(l)}</li>)}</ul>); list = []; } };
  const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p);
  for (const l of lines) {
    const m = /^\s*(?:[-•*]|\d+[.)])\s+(.*)$/.exec(l);
    if (m) { list.push(m[1]); continue; }
    flush();
    if (l.trim()) out.push(<p key={out.length} style={{ margin: "0 0 8px" }}>{inline(l)}</p>);
  }
  flush();
  return <div style={{ fontSize: 14, lineHeight: 1.5 }}>{out}</div>;
}

export default function AskHQ({ open, onClose, view, coach }) {
  const [msgs, setMsgs] = useState(() => { try { return JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch { return []; } });
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState({});
  const endRef = useRef(null), inputRef = useRef(null);
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-30))); } catch {} }, [msgs]);
  useEffect(() => { if (open) { setTimeout(() => inputRef.current?.focus(), 50); endRef.current?.scrollIntoView({ block: "end" }); } }, [open, msgs.length]);

  const ask = async (text) => {
    const question = String(text || q).trim();
    if (!question || busy) return;
    setQ(""); setBusy(true);
    const history = msgs.filter(m => m.role === "user" || m.role === "assistant").map(m => ({ role: m.role, content: m.content }));
    setMsgs(m => [...m, { role: "user", content: question }]);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/ask-hq", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify({ question, history, context: { view } }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
      setMsgs(m => [...m, { role: "assistant", content: d.answer || "", tools: d.tools || [], drafts: (d.drafts || []).map(x => ({ ...x, sent: false })), ms: d.ms }]);
    } catch (e) {
      setMsgs(m => [...m, { role: "assistant", content: "Couldn't answer: " + (e.message || "error"), error: true }]);
    }
    setBusy(false);
  };
  const sendDraft = async (mi, di) => {
    const d = msgs[mi].drafts[di];
    if (!window.confirm(`Send "${d.subject}" to ${d.to.join(", ")}?`)) return;
    setSending(s => ({ ...s, [mi + ":" + di]: true }));
    const r = await fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skipPush: true, subject: d.subject, body: d.body, recipients: d.to, sentBy: coach?.display_name || coach?.email || "HQ", source: "ask-hq" }) });
    const ok = r.ok;
    setMsgs(m => m.map((x, i) => i === mi ? { ...x, drafts: x.drafts.map((y, j) => j === di ? { ...y, sent: ok, failed: !ok } : y) } : x));
    setSending(s => ({ ...s, [mi + ":" + di]: false }));
  };
  const sendAll = async (mi) => {
    const list = msgs[mi].drafts.map((d, di) => [d, di]).filter(([d]) => !d.sent);
    if (!list.length) return;
    if (!window.confirm(`Send all ${list.length} drafts?`)) return;
    for (const [, di] of list) {
      const d = msgs[mi].drafts[di];
      const r = await fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skipPush: true, subject: d.subject, body: d.body, recipients: d.to, sentBy: coach?.display_name || coach?.email || "HQ", source: "ask-hq" }) });
      const ok = r.ok;
      setMsgs(m => m.map((x, i) => i === mi ? { ...x, drafts: x.drafts.map((y, j) => j === di ? { ...y, sent: ok, failed: !ok } : y) } : x));
    }
  };

  if (!open) return null;
  const suggestions = SUGGEST[view] || SUGGEST.home;
  return (
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(520px, 100vw)", zIndex: 60, background: C.bg, borderLeft: "1px solid " + C.border, display: "flex", flexDirection: "column", boxShadow: "-12px 0 40px rgba(0,0,0,0.5)", fontFamily: "inherit", color: C.text }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid " + C.border }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: C.gold }}>✦ Ask HQ</span>
        <span style={{ fontSize: 11, color: C.mut }}>reads the database · never changes it</span>
        <div style={{ flex: 1 }} />
        {msgs.length > 0 && <button onClick={() => setMsgs([])} style={{ background: "none", border: "1px solid " + C.border, color: C.mut, borderRadius: 6, padding: "3px 9px", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>New</button>}
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.mut, fontSize: 18, cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
        {!msgs.length && (
          <div>
            <div style={{ fontSize: 13, color: C.mut, marginBottom: 10, lineHeight: 1.5 }}>Ask about players, rosters, coaches, hours, tournaments, housing, clinics, emails — anything in HQ. It looks the answer up and shows its work. Ask it to draft an email and you get a Send button.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {suggestions.map(s => <button key={s} onClick={() => ask(s)} style={{ textAlign: "left", padding: "9px 12px", borderRadius: 10, border: "1px solid " + C.border, background: C.card, color: C.text, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, mi) => (
          <div key={mi} style={{ marginBottom: 14 }}>
            {m.role === "user" ? (
              <div style={{ display: "flex", justifyContent: "flex-end" }}><div style={{ background: "rgba(233,30,140,0.14)", border: "1px solid rgba(233,30,140,0.4)", borderRadius: 12, padding: "8px 12px", fontSize: 14, maxWidth: "88%", whiteSpace: "pre-wrap" }}>{m.content}</div></div>
            ) : (
              <div style={{ background: C.card, border: "1px solid " + (m.error ? C.red : C.border), borderRadius: 12, padding: "10px 12px" }}>
                {m.tools?.length > 0 && (
                  <details style={{ marginBottom: 8 }}>
                    <summary style={{ fontSize: 11, color: C.mut, cursor: "pointer" }}>{m.tools.length} lookup{m.tools.length === 1 ? "" : "s"}{m.ms ? ` · ${(m.ms / 1000).toFixed(1)}s` : ""}</summary>
                    {m.tools.map((t, i) => <div key={i} style={{ fontSize: 11, color: t.error ? C.red : C.mut, fontFamily: "ui-monospace, Menlo, monospace", padding: "3px 0", borderBottom: "1px solid " + C.border, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{t.name}{t.rows != null ? ` · ${t.rows} rows` : ""}{t.error ? " · " + t.error : ""}{t.input ? "\n" + t.input : ""}</div>)}
                  </details>
                )}
                <Md text={m.content} />
                {m.drafts?.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {m.drafts.length > 1 && <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><span style={{ fontSize: 12, color: C.mut }}>{m.drafts.length} drafts</span><div style={{ flex: 1 }} />{m.drafts.some(d => !d.sent) && <button onClick={() => sendAll(mi)} style={{ padding: "5px 11px", borderRadius: 8, border: "none", background: C.gold, color: "#000", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Send all</button>}</div>}
                    {m.drafts.map((d, di) => (
                      <div key={di} style={{ border: "1px solid " + (d.sent ? C.grn : C.border), borderRadius: 10, padding: 10, marginBottom: 6, background: C.bg }}>
                        {d.label && <div style={{ fontSize: 11, color: C.mut, marginBottom: 2 }}>{d.label}</div>}
                        <div style={{ fontSize: 12, color: C.mut }}>To: <span style={{ color: C.text }}>{d.to.join(", ")}</span></div>
                        <div style={{ fontSize: 13, fontWeight: 700, margin: "3px 0" }}>{d.subject}</div>
                        <div style={{ fontSize: 13, whiteSpace: "pre-wrap", color: C.text, lineHeight: 1.45, maxHeight: 220, overflowY: "auto" }}>{d.body}</div>
                        <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                          {d.sent ? <span style={{ color: C.grn, fontSize: 12, fontWeight: 700 }}>✓ Sent</span> : d.failed ? <span style={{ color: C.red, fontSize: 12 }}>Failed — try again</span> : null}
                          {!d.sent && <button disabled={!!sending[mi + ":" + di]} onClick={() => sendDraft(mi, di)} style={{ padding: "5px 11px", borderRadius: 8, border: "none", background: C.gold, color: "#000", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>{sending[mi + ":" + di] ? "Sending…" : "Send"}</button>}
                          <button onClick={() => navigator.clipboard?.writeText(`To: ${d.to.join(", ")}\nSubject: ${d.subject}\n\n${d.body}`)} style={{ padding: "5px 11px", borderRadius: 8, border: "1px solid " + C.border, background: "transparent", color: C.text, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Copy</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <div style={{ fontSize: 13, color: C.mut, padding: "4px 2px" }}>Looking that up…</div>}
        <div ref={endRef} />
      </div>
      <div style={{ padding: 12, borderTop: "1px solid " + C.border }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }} placeholder="Ask HQ anything… (Enter to send, Shift+Enter for a new line)" rows={2}
            style={{ flex: 1, background: C.card, border: "1px solid " + C.border, borderRadius: 10, color: C.text, fontFamily: "inherit", fontSize: 14, padding: "9px 11px", resize: "none" }} />
          <button onClick={() => ask()} disabled={busy || !q.trim()} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: C.gold, color: "#000", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit", opacity: busy || !q.trim() ? 0.5 : 1 }}>Ask</button>
        </div>
      </div>
    </div>
  );
}
