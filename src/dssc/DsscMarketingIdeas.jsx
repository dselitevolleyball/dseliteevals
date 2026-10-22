// DSSC Marketing → Ideas. What the idea scout suggests (holidays, the season,
// what's on around Dripping Springs, the club's own news, fun formats) and the
// "Meet the Coaches" spotlights. A director makes an idea into a draft with
// one tap (it still needs approving in the Approve tab) or turns it down with
// a reason the scout learns from; sends a coach their interview, nudges them,
// types in answers that came back another way, and makes the drafts.
// Server: api/marketing.js (ideas_* / idea_* / spotlight_*); the weekly scout
// and the spotlight drafts also run from api/marketing-cron.js.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Tag, inputStyle, Grow } from "./DsscHub.jsx";
import { mktApi, isMissingTable, MIGRATION_MSG, LINES, lineMeta, LineChip, chipStyle, Msg, Panel, H, fmtDate, mondayOf } from "./DsscMarketingKit.jsx";

const KIND = {
  season: ["Season", "#7FD1C3"], holiday: ["Holiday", "#F5C542"], local: ["Local news", "#60A5FA"], club: ["Club news", DS.lime],
  program: ["Program", "#A9C7C3"], spotlight: ["Coach spotlight", "#F06BB4"], fun: ["Just for fun", "#FF9F5A"],
};
const REASONS = ["Not our vibe", "Wrong timing", "Already covered", "Too salesy", "Too silly"];
const SP_STATUS = { draft: ["Ready to send", DS.orange], sent: ["Waiting on the coach", "#60A5FA"], answered: ["Answered", DS.lime], drafted: ["Drafts made", "#7FD1C3"], declined: ["Declined", DS.dim], cancelled: ["Cancelled", DS.dim] };
const first = (n) => String(n || "").split(/\s+/)[0];
const big = (narrow) => narrow ? { minHeight: 44 } : {};
const formLink = (sp) => `https://www.drippingsportsclub.com/hq/api/spotlight-form?t=${sp.token}`;

export default function MarketingIdeas({ narrow, onOpenWeek, onChanged }) {
  const [ideas, setIdeas] = useState(null);
  const [past, setPast] = useState([]);
  const [spots, setSpots] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState("");
  const [ask, setAsk] = useState("");
  const [showPast, setShowPast] = useState(false);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      supabase.from("mkt_ideas").select("*").eq("status", "new").order("best_day", { ascending: true }).order("id"),
      supabase.from("mkt_ideas").select("*").neq("status", "new").order("decided_at", { ascending: false, nullsFirst: false }).limit(20),
      supabase.from("mkt_spotlights").select("*").neq("status", "cancelled").order("created_at", { ascending: false }).limit(12),
    ]);
    const err = a.error || b.error || c.error;
    if (err) { setMsg({ err: isMissingTable(err) || /mkt_ideas|mkt_spotlights/.test(err.message) ? "The ideas tables aren't set up yet — run migrations/20261024_marketing_ideas_spotlights.sql." : err.message }); setIdeas([]); setSpots([]); return; }
    setIdeas(a.data || []); setPast(b.data || []); setSpots(c.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const scout = async (askText = "") => {
    setBusy(askText ? "ask" : "scout"); setMsg({ ok: askText ? "Asking the scout… about a minute." : "The scout is checking the calendar, what's on around town and the club's news… about a minute." });
    try {
      const d = await mktApi("ideas_refresh", askText ? { ask: askText } : {});
      setMsg({ ok: `${(d.ideas || []).length} new idea${(d.ideas || []).length === 1 ? "" : "s"}${d.spotlight ? ` and a spotlight for ${d.spotlight.name}` : ""}.${d.local?.error ? " (Local search didn't work this time.)" : ""}${d.error && !(d.ideas || []).length ? " " + d.error : ""}` });
      if (askText) setAsk("");
    } catch (e) { setMsg({ err: e.message }); }
    setBusy(""); load();
  };
  const make = async (idea, instruction = "") => {
    setBusy("idea:" + idea.id); setMsg(null);
    try {
      const d = await mktApi("idea_accept", { id: idea.id, instruction });
      setMsg({ ok: `"${idea.title}" is a draft for ${d.item?.scheduled_at ? new Date(d.item.scheduled_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "its day"} — approve it in the Approve tab.`, week: d.item?.week_of });
      onChanged?.();
    } catch (e) { setMsg({ err: e.message }); }
    setBusy(""); load();
  };
  const dismiss = async (idea, feedback) => {
    setIdeas(xs => (xs || []).filter(x => x.id !== idea.id));
    try { await mktApi("idea_dismiss", { id: idea.id, feedback }); } catch (e) { setMsg({ err: e.message }); }
    load();
  };
  const spotCall = async (action, payload, okText) => {
    setBusy(action + ":" + payload.id); setMsg(null);
    try { const d = await mktApi(action, payload); setMsg({ ok: typeof okText === "function" ? okText(d) : okText }); if (action === "spotlight_draft") onChanged?.(); return d; }
    catch (e) { setMsg({ err: e.message }); return null; }
    finally { setBusy(""); load(); }
  };

  const open = (ideas || []);
  const spotIdeas = new Map(open.filter(i => i.spotlight_id).map(i => [i.spotlight_id, i]));
  return (
    <div>
      <div style={{ fontSize: 13, color: DS.mut, marginBottom: 12, lineHeight: 1.5 }}>Ideas the weekly rhythm wouldn't make on its own — holidays, the season, what's happening around Dripping Springs, club news and fun formats — plus the "Meet the Coaches" series. The scout looks every week and emails you; nothing posts until you approve it.</div>
      <Msg msg={msg} style={{ marginBottom: 6 }} />
      {msg?.week && <Btn small kind="link" onClick={() => onOpenWeek?.(msg.week)} style={{ marginBottom: 10 }}>Open that week →</Btn>}

      {/* ── Coach spotlights ── */}
      <Panel style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
          <H style={{ margin: 0, flex: 1 }}>Meet the Coaches</H>
          <Btn small kind="ghost" onClick={() => setStarting(s => !s)} style={big(narrow)}>{starting ? "Close" : "+ Start a spotlight"}</Btn>
        </div>
        {starting && <StartSpotlight narrow={narrow} onDone={(sp) => { setStarting(false); if (sp) setMsg({ ok: `Questions written for ${sp.name} — check them and press Send.` }); load(); }} />}
        {spots == null ? <div style={{ color: DS.mut }}>Loading…</div>
          : !spots.length ? <div style={{ color: DS.mut, fontSize: 13 }}>No spotlights yet. The scout lines one up every couple of weeks, or start one now.</div>
          : spots.map(sp => <Spotlight key={sp.id} sp={sp} narrow={narrow} busy={busy} idea={spotIdeas.get(sp.id)} call={spotCall} onOpenWeek={onOpenWeek} reload={load} />)}
      </Panel>

      {/* ── Ideas ── */}
      <Panel style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <H style={{ margin: 0, flex: 1 }}>Ideas for the next few weeks</H>
          <Btn small kind="ghost" disabled={!!busy} onClick={() => scout("")} style={big(narrow)}>{busy === "scout" ? "Looking…" : "Get fresh ideas"}</Btn>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <input value={ask} onChange={e => setAsk(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && ask.trim() && !busy) scout(ask.trim()); }} placeholder='Ask the scout — "something fun for Halloween", "a Reach post for runners"' style={{ ...inputStyle, flex: "1 1 260px", fontSize: narrow ? 16 : 14 }} />
          <Btn kind="primary" disabled={!ask.trim() || !!busy} onClick={() => scout(ask.trim())} style={big(narrow)}>{busy === "ask" ? "Asking…" : "Ask"}</Btn>
        </div>
        {ideas == null ? <div style={{ color: DS.mut }}>Loading…</div>
          : !open.filter(i => i.kind !== "spotlight").length ? <div style={{ color: DS.mut, fontSize: 13, padding: "10px 0" }}>No open ideas. Press <b>Get fresh ideas</b>, or ask for something specific.</div>
          : open.filter(i => i.kind !== "spotlight").map(i => <IdeaCard key={i.id} idea={i} narrow={narrow} busy={busy} onMake={make} onDismiss={dismiss} />)}
        {past.length > 0 && <div style={{ marginTop: 10 }}>
          <Btn small kind="link" onClick={() => setShowPast(s => !s)}>{showPast ? "Hide" : "Show"} what you made and turned down ({past.length})</Btn>
          {showPast && past.map(i => (
            <div key={i.id} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", padding: "6px 0", borderTop: "1px solid " + DS.line, fontSize: 13 }}>
              <Tag color={i.status === "accepted" ? DS.lime : DS.dim}>{i.status === "accepted" ? "Made" : i.status === "dismissed" ? "Not this" : i.status}</Tag>
              <span style={{ fontWeight: 700 }}>{i.title}</span>
              {i.feedback && <span style={{ color: DS.mut }}>— "{i.feedback}"</span>}
            </div>
          ))}
        </div>}
      </Panel>
    </div>
  );
}

function IdeaCard({ idea: i, narrow, busy, onMake, onDismiss }) {
  const [mode, setMode] = useState("");       // "" | tweak | no
  const [text, setText] = useState("");
  const [k, kc] = KIND[i.kind] || [i.kind, DS.mut];
  const working = busy === "idea:" + i.id;
  return (
    <div style={{ padding: "12px 0", borderTop: "1px solid " + DS.line }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
        <Tag color={kc}>{k}</Tag>
        <LineChip line={i.line} />
        <span style={{ fontSize: 12, color: DS.mut }}>{i.channel === "email" ? "✉️ Email" : i.format === "reel" ? "🎬 Reel" : i.format === "story" ? "📱 Story" : "📱 Post"} · {fmtDate(String(i.best_day || "").slice(0, 10), { weekday: "short", month: "short", day: "numeric" })}</span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 2 }}>{i.title}</div>
      <div style={{ fontSize: 14, color: DS.text, lineHeight: 1.5 }}>{i.pitch}</div>
      {i.hook && <div style={{ fontSize: 13, color: DS.lime, marginTop: 4 }}>Try: {i.hook}</div>}
      {(i.sources || []).length > 0 && <div style={{ fontSize: 12, marginTop: 4 }}>{i.sources.map(s => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" style={{ color: DS.mut, marginRight: 10 }}>{s.title} ↗</a>)}</div>}
      {mode === "tweak" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder='e.g. "make it a story", "mention the 3v3 league"' style={{ ...inputStyle, flex: "1 1 240px", fontSize: narrow ? 16 : 14 }} />
        <Btn kind="primary" disabled={working} onClick={() => onMake(i, text)} style={big(narrow)}>Make it</Btn>
      </div>}
      {mode === "no" && <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12, color: DS.mut, marginBottom: 6 }}>Why not? The scout learns from it.</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {REASONS.map(r => <button key={r} onClick={() => onDismiss(i, r)} style={chipStyle(false, DS.orange, narrow)}>{r}</button>)}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          <input value={text} onChange={e => setText(e.target.value)} placeholder="Or say why…" style={{ ...inputStyle, flex: "1 1 220px", fontSize: narrow ? 16 : 14 }} />
          <Btn kind="warn" disabled={!text.trim()} onClick={() => onDismiss(i, text.trim())} style={big(narrow)}>Not this</Btn>
        </div>
      </div>}
      {!mode && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <Btn kind="primary" disabled={!!busy} onClick={() => onMake(i)} style={big(narrow)}>{working ? "Drafting…" : "Make it"}</Btn>
        <Btn kind="ghost" disabled={!!busy} onClick={() => setMode("tweak")} style={big(narrow)}>Make it with a tweak</Btn>
        <Btn kind="quiet" disabled={!!busy} onClick={() => setMode("no")} style={big(narrow)}>Not this</Btn>
      </div>}
      {mode && !working && <Btn small kind="link" onClick={() => { setMode(""); setText(""); }} style={{ marginTop: 6 }}>Cancel</Btn>}
    </div>
  );
}

function Spotlight({ sp, narrow, busy, call, onOpenWeek, reload }) {
  const [edit, setEdit] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [qs, setQs] = useState(sp.questions || []);
  const [intro, setIntro] = useState(sp.intro || "");
  const [email, setEmail] = useState(sp.email || "");
  const [phone, setPhone] = useState(sp.phone || "");
  const [via, setVia] = useState(() => [sp.email ? "email" : null, sp.phone ? "sms" : null].filter(Boolean));
  const [copied, setCopied] = useState(false);
  useEffect(() => { setQs(sp.questions || []); setIntro(sp.intro || ""); setEmail(sp.email || ""); setPhone(sp.phone || ""); }, [sp.id, sp.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const [label, color] = SP_STATUS[sp.status] || [sp.status, DS.mut];
  const isBusy = (a) => busy === a + ":" + sp.id;
  const save = async (extra = {}) => { const d = await call("spotlight_update", { id: sp.id, patch: { questions: qs.filter(q => String(q.q || "").trim()), intro, email, phone, ...extra } }, extra.mark_answered ? "Answers saved — press Make the drafts." : "Saved."); if (d) { setEdit(false); setAnswering(false); } };
  const answers = (sp.questions || []).filter(q => String(q.a || "").trim());
  const copy = async () => { try { await navigator.clipboard.writeText(formLink(sp)); } catch { window.prompt("Copy the coach's link:", formLink(sp)); } setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div style={{ padding: "12px 0", borderTop: "1px solid " + DS.line }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>{sp.name}</div>
        {sp.role && <span style={{ fontSize: 12, color: DS.mut }}>{sp.role}</span>}
        <LineChip line={sp.line} />
        {sp.episode && <span style={{ fontSize: 12, color: DS.mut }}>#{sp.episode}</span>}
        <span style={{ flex: 1 }} />
        <Tag color={color} fill={sp.status === "answered"}>{label}</Tag>
      </div>
      <div style={{ fontSize: 12, color: DS.dim, marginTop: 2 }}>
        {[sp.email, sp.phone].filter(Boolean).join(" · ") || "No email or phone yet"}
        {sp.sent_at && <> · sent {new Date(sp.sent_at).toLocaleDateString()} by {(sp.sent_via || []).map(v => v === "sms" ? "text" : v).join(" + ")}</>}
        {sp.reminded_at && <> · reminded {new Date(sp.reminded_at).toLocaleDateString()}</>}
        {sp.answered_at && <> · answered {new Date(sp.answered_at).toLocaleDateString()}</>}
      </div>
      {sp.error && <div style={{ fontSize: 12, color: DS.orange, marginTop: 4 }}>{sp.error}</div>}

      {(sp.status === "draft" || edit) && !answering && <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: DS.mut, marginBottom: 4 }}>The note at the top of their page</div>
        <Grow value={intro} onChange={e => setIntro(e.target.value)} minRows={2} style={{ fontSize: narrow ? 16 : 13 }} />
        <div style={{ fontSize: 11, fontWeight: 700, color: DS.mut, margin: "10px 0 4px" }}>Questions</div>
        {qs.map((q, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input value={q.q} onChange={e => setQs(qs.map((x, j) => j === i ? { ...x, q: e.target.value } : x))} style={{ ...inputStyle, fontSize: narrow ? 16 : 14 }} />
            <Btn small kind="quiet" onClick={() => setQs(qs.filter((_, j) => j !== i))} aria-label="Remove">✕</Btn>
          </div>
        ))}
        {qs.length < 10 && <Btn small kind="link" onClick={() => setQs([...qs, { q: "" }])}>+ Add a question</Btn>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" style={{ ...inputStyle, flex: "1 1 200px", fontSize: narrow ? 16 : 14 }} />
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Mobile (for a text)" style={{ ...inputStyle, flex: "1 1 160px", fontSize: narrow ? 16 : 14 }} />
        </div>
      </div>}

      {answering && <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 12, color: DS.mut, marginBottom: 6 }}>Answers that came back another way (a text, a chat) — type or paste them in.</div>
        {qs.map((q, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>{q.q}</div>
            <Grow value={q.a || ""} onChange={e => setQs(qs.map((x, j) => j === i ? { ...x, a: e.target.value } : x))} minRows={1} style={{ fontSize: narrow ? 16 : 14 }} />
          </div>
        ))}
      </div>}

      {["answered", "drafted"].includes(sp.status) && <div style={{ marginTop: 8 }}>
        {answers.slice(0, sp.status === "drafted" ? 2 : 8).map((q, i) => <div key={i} style={{ fontSize: 13, marginBottom: 6 }}><div style={{ color: DS.mut }}>{q.q}</div><div>"{q.a}"</div></div>)}
        {(sp.photos || []).length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>{sp.photos.map(p => <a key={p.url} href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={p.caption || ""} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, display: "block" }} /></a>)}</div>}
      </div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {sp.status === "draft" && <>
          <span style={{ display: "inline-flex", gap: 6 }}>
            {[["email", "Email"], ["sms", "Text"]].map(([k, l]) => <button key={k} onClick={() => setVia(v => v.includes(k) ? v.filter(x => x !== k) : [...v, k])} style={chipStyle(via.includes(k), DS.lime, narrow)}>{l}</button>)}
          </span>
          <Btn kind="primary" disabled={!!busy || !via.length} onClick={async () => { await call("spotlight_update", { id: sp.id, patch: { questions: qs.filter(q => String(q.q || "").trim()), intro, email, phone } }, ""); await call("spotlight_send", { id: sp.id, via }, (d) => `Sent to ${first(sp.name)}${d?.errors?.length ? " (" + d.errors.join(" · ") + ")" : ""}.`); }} style={big(narrow)}>{isBusy("spotlight_send") ? "Sending…" : `Send to ${first(sp.name)}`}</Btn>
          <Btn kind="ghost" disabled={!!busy} onClick={() => save()} style={big(narrow)}>Save</Btn>
        </>}
        {sp.status === "sent" && !answering && <>
          <Btn kind="ghost" onClick={copy} style={big(narrow)}>{copied ? "Copied ✓" : "Copy their link"}</Btn>
          <Btn kind="ghost" disabled={!!busy} onClick={() => call("spotlight_remind", { id: sp.id }, `Reminder sent to ${first(sp.name)}.`)} style={big(narrow)}>{isBusy("spotlight_remind") ? "Sending…" : "Remind now"}</Btn>
          <Btn kind="ghost" onClick={() => setEdit(e => !e)} style={big(narrow)}>{edit ? "Done editing" : "Edit questions"}</Btn>
          {edit && <Btn kind="primary" disabled={!!busy} onClick={() => save()} style={big(narrow)}>Save</Btn>}
          <Btn kind="quiet" onClick={() => setAnswering(true)} style={big(narrow)}>Type in answers</Btn>
        </>}
        {answering && <>
          <Btn kind="primary" disabled={!!busy} onClick={() => save({ mark_answered: true })} style={big(narrow)}>Save answers</Btn>
          <Btn kind="quiet" onClick={() => setAnswering(false)} style={big(narrow)}>Cancel</Btn>
        </>}
        {sp.status === "answered" && <Btn kind="primary" disabled={!!busy} onClick={() => call("spotlight_draft", { id: sp.id }, (d) => `${(d?.items || []).length} drafts made — they're in the Approve tab.`)} style={big(narrow)}>{isBusy("spotlight_draft") ? "Drafting…" : "Make the drafts now"}</Btn>}
        {sp.status === "drafted" && <Btn kind="ghost" onClick={async () => { const { data } = await supabase.from("mkt_items").select("week_of").in("id", sp.item_ids || []).order("scheduled_at").limit(1); onOpenWeek?.(data?.[0]?.week_of || mondayOf()); }} style={big(narrow)}>Open the drafts →</Btn>}
        {["draft", "sent", "answered"].includes(sp.status) && <Btn kind="quiet" disabled={!!busy} onClick={() => { if (window.confirm(`Cancel ${first(sp.name)}'s spotlight?`)) call("spotlight_cancel", { id: sp.id }, "Cancelled.").then(reload); }} style={big(narrow)}>Cancel</Btn>}
      </div>
    </div>
  );
}

function StartSpotlight({ narrow, onDone }) {
  const [cands, setCands] = useState(null);
  const [pick, setPick] = useState("");
  const [manual, setManual] = useState({ name: "", role: "", email: "", phone: "", line: "volleyball" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { mktApi("spotlight_candidates").then(d => setCands(d.candidates || [])).catch(e => { setErr(e.message); setCands([]); }); }, []);
  const chosen = (cands || []).find(c => (c.email || c.name) === pick);
  const go = async () => {
    setBusy(true); setErr("");
    try { const d = await mktApi("spotlight_create", { person: chosen || manual }); onDone(d.spotlight); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <div style={{ background: DS.panel2, borderRadius: 10, padding: 12, marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: DS.mut, marginBottom: 6 }}>Who's next? Claude writes the questions; you check them and press Send.</div>
      <select value={pick} onChange={e => setPick(e.target.value)} style={{ ...inputStyle, colorScheme: "dark", fontSize: narrow ? 16 : 14 }}>
        <option value="">{cands == null ? "Loading coaches…" : "Someone not on this list (type below)"}</option>
        {(cands || []).map(c => <option key={c.email || c.name} value={c.email || c.name}>{c.name}{c.role ? ` — ${c.role}` : ""}{c.last_spotlight ? ` (spotlight ${c.last_spotlight.status})` : ""}</option>)}
      </select>
      {!chosen && <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr", gap: 8, marginTop: 8 }}>
        <input value={manual.name} onChange={e => setManual({ ...manual, name: e.target.value })} placeholder="Name" style={{ ...inputStyle, fontSize: narrow ? 16 : 14 }} />
        <input value={manual.role} onChange={e => setManual({ ...manual, role: e.target.value })} placeholder='Role, e.g. "Skill pod coach"' style={{ ...inputStyle, fontSize: narrow ? 16 : 14 }} />
        <input value={manual.email} onChange={e => setManual({ ...manual, email: e.target.value })} placeholder="Email" style={{ ...inputStyle, fontSize: narrow ? 16 : 14 }} />
        <input value={manual.phone} onChange={e => setManual({ ...manual, phone: e.target.value })} placeholder="Mobile" style={{ ...inputStyle, fontSize: narrow ? 16 : 14 }} />
        <select value={manual.line} onChange={e => setManual({ ...manual, line: e.target.value })} style={{ ...inputStyle, colorScheme: "dark", fontSize: narrow ? 16 : 14 }}>{LINES.map(l => <option key={l.key} value={l.key}>{lineMeta(l.key).label}</option>)}</select>
      </div>}
      {err && <div style={{ color: DS.orange, fontSize: 13, marginTop: 6 }}>{err}</div>}
      <Btn kind="primary" disabled={busy || !(chosen || manual.name.trim())} onClick={go} style={{ marginTop: 10, ...big(narrow) }}>{busy ? "Writing questions…" : "Write the questions"}</Btn>
    </div>
  );
}
