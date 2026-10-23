// DSSC Marketing → Rules. The directors' standing rules for everything the
// machine writes ("Don't combine sport programming and birthday parties").
// Each rule is plain words every writer follows; when it keeps two groups of
// programs apart, the machine reads that out of the words (Claude, keyword
// fallback - api/marketing.js rule_interpret) and the planner enforces it too:
// those lines never share a post, story, email or reel. Shared logic:
// shared/marketing-rules.js. Saves on every change (settings_save { rules }).
// After a change, the drafts that break a rule are listed with one tap to redo them.

import { useState, useEffect, useCallback } from "react";
import { DS, Btn, Tag, Grow } from "./DsscHub.jsx";
import { mktApi, LINES, lineMeta, chipStyle, Msg, Panel, H } from "./DsscMarketingKit.jsx";
import { normRules } from "../../shared/marketing-rules.js";

const EXAMPLES = ["Don't combine sport programming and birthday parties", "Never mention prices or discounts", "Say \"the Warehouse\", never \"the gym\"", "Keep Camp Elevate and Reach Performance in separate posts"];
const big = (narrow) => narrow ? { minHeight: 44 } : {};
const fmtDay = (iso) => iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric" }) : "";

export default function MarketingRules({ status, narrow, onChanged }) {
  const [rules, setRules] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [check, setCheck] = useState(null);       // [{ id, headline, issues, status, ... }]

  useEffect(() => { if (status?.settings && rules == null) setRules(normRules(status.settings.rules)); }, [status, rules]);

  const runCheck = useCallback(async () => {
    try { setCheck((await mktApi("rules_check")).items); } catch (e) { setMsg({ err: e.message }); }
  }, []);
  useEffect(() => { if (rules?.length) runCheck(); }, [rules == null]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (next, note) => {
    const prev = rules;
    setRules(next); setMsg(null);
    try {
      const d = await mktApi("settings_save", { patch: { rules: next } });
      setRules(normRules(d.settings?.rules ?? next));
      if (note) setMsg({ ok: note });
      onChanged?.();
      await runCheck();
    } catch (e) { setRules(prev); setMsg({ err: e.message }); }
  };
  const add = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy("add"); setMsg(null);
    try {
      const { apart } = await mktApi("rule_interpret", { text: t });
      await save([...(rules || []), { id: "r" + Date.now().toString(36), text: t, active: true, apart: apart || null }], apart ? "Rule added — the planner keeps those programs apart from now on." : "Rule added — every writer follows it from now on.");
      setText("");
    } catch (e) { setMsg({ err: e.message }); }
    setBusy("");
  };
  const patch = (id, ch) => save(rules.map(r => r.id === id ? { ...r, ...ch } : r));
  const redo = async () => {
    const ids = (check || []).filter(i => i.status === "draft").map(i => i.id);
    if (!ids.length) return;
    setBusy("redo"); setMsg(null);
    try {
      const d = await mktApi("rules_redo", { ids });
      setMsg({ ok: `Redid ${d.removed} draft${d.removed === 1 ? "" : "s"} — ${d.items.length} new draft${d.items.length === 1 ? "" : "s"} follow the rules. Review them in the Week tab.` });
      onChanged?.(); await runCheck();
    } catch (e) { setMsg({ err: e.message }); }
    setBusy("");
  };

  const drafts = (check || []).filter(i => i.status === "draft");
  const locked = (check || []).filter(i => i.status !== "draft");
  return (
    <div>
      <div style={{ fontSize: 13, color: DS.mut, marginBottom: 12, lineHeight: 1.5, maxWidth: 820 }}>Standing rules for everything the machine writes — posts, stories, emails, texts, rewrites, ideas and reels. Write them the way you'd tell a new staff member. When a rule keeps programs apart, the planner enforces it too: those programs never share a post or an email.</div>

      <Panel style={{ marginBottom: 14 }}>
        <H>Add a rule</H>
        <Grow value={text} onChange={e => setText(e.target.value)} minRows={2} placeholder={'e.g. "Don\'t combine sport programming and birthday parties"'} style={{ fontSize: narrow ? 16 : 14 }}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") add(); }} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          <Btn kind="primary" disabled={!!busy || text.trim().length < 4} onClick={add} style={big(narrow)}>{busy === "add" ? "Reading the rule…" : "Add rule"}</Btn>
          {!text && EXAMPLES.filter(x => !(rules || []).some(r => r.text === x)).slice(0, 3).map(x => <button key={x} onClick={() => setText(x)} style={{ ...chipStyle(false, DS.lime), whiteSpace: "normal", textAlign: "left" }}>{x}</button>)}
        </div>
        <Msg msg={msg} style={{ marginTop: 10 }} />
      </Panel>

      {rules == null ? <div style={{ color: DS.mut }}>Loading…</div>
        : !rules.length ? <Panel style={{ color: DS.mut, borderStyle: "dashed", textAlign: "center", padding: 24, marginBottom: 14 }}>No rules yet.</Panel>
        : <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
            {rules.map(r => <RuleCard key={r.id} r={r} narrow={narrow} busy={!!busy} onPatch={(ch) => patch(r.id, ch)} onDelete={() => save(rules.filter(x => x.id !== r.id), "Rule removed.")} />)}
          </div>}

      {check && rules?.length > 0 && (
        <Panel style={{ borderColor: check.length ? DS.orange : DS.line }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <H style={{ margin: 0, flex: 1, color: check.length ? DS.orange : DS.lime }}>{check.length ? `${check.length} upcoming item${check.length === 1 ? "" : "s"} break${check.length === 1 ? "s" : ""} a rule` : "Every upcoming draft follows the rules ✓"}</H>
            {drafts.length > 0 && <Btn kind="primary" disabled={!!busy} onClick={redo} style={big(narrow)}>{busy === "redo" ? "Redoing…" : `Redo ${drafts.length} draft${drafts.length === 1 ? "" : "s"}`}</Btn>}
          </div>
          {check.map(i => (
            <div key={i.id} style={{ padding: "8px 0", borderTop: "1px solid " + DS.line, marginTop: 8 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: DS.mut }}>{fmtDay(i.scheduled_at)} · {i.channel === "email" ? "Email" : i.channel === "sms" ? "Text" : "Post"}</span>
                <Tag color={i.status === "draft" ? DS.mut : DS.orange}>{i.status}</Tag>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{i.headline}</span>
              </div>
              {i.issues.map((x, k) => <div key={k} style={{ fontSize: 12, color: DS.orange, marginTop: 2 }}>{x}</div>)}
            </div>
          ))}
          {locked.length > 0 && <div style={{ fontSize: 12, color: DS.mut, marginTop: 8 }}>Approved items aren't changed automatically — unapprove them in the Week tab, then redo.</div>}
          {drafts.length > 0 && <div style={{ fontSize: 12, color: DS.mut, marginTop: 6 }}>Redo drops those drafts and plans their days again around the rules.</div>}
        </Panel>
      )}
    </div>
  );
}

function RuleCard({ r, narrow, busy, onPatch, onDelete }) {
  const [edit, setEdit] = useState(!!r.apart);
  const sides = r.apart || [[], []];
  const toggle = (side, key) => {
    const next = [sides[0].slice(), sides[1].slice()];
    const other = 1 - side;
    next[side] = next[side].includes(key) ? next[side].filter(x => x !== key) : [...next[side], key];
    next[other] = next[other].filter(x => x !== key);
    onPatch({ apart: next[0].length && next[1].length ? next : (next[0].length || next[1].length ? next : null) });
  };
  return (
    <Panel style={{ opacity: r.active ? 1 : 0.55 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px", minWidth: 0, fontSize: 16, fontWeight: 700, lineHeight: 1.35 }}>{r.text}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Btn small kind="quiet" disabled={busy} onClick={() => onPatch({ active: !r.active })} style={big(narrow)}>{r.active ? "Turn off" : "Turn on"}</Btn>
          <Btn small kind="link" disabled={busy} onClick={onDelete} style={{ color: DS.dim }}>Delete</Btn>
        </div>
      </div>
      {r.apart && r.apart[0].length > 0 && r.apart[1].length > 0
        ? <div style={{ fontSize: 13, color: DS.mut, marginTop: 6 }}>The planner keeps <b style={{ color: DS.text }}>{r.apart[0].map(k => lineMeta(k).label).join(", ")}</b> apart from <b style={{ color: DS.text }}>{r.apart[1].map(k => lineMeta(k).label).join(", ")}</b> — never in the same post, story, email or reel.</div>
        : <div style={{ fontSize: 13, color: DS.mut, marginTop: 6 }}>Every writer follows this rule.</div>}
      <button onClick={() => setEdit(e => !e)} style={{ background: "none", border: 0, color: DS.lime, fontSize: 12, fontWeight: 700, padding: "6px 0 0", cursor: "pointer", fontFamily: DS.font }}>{edit ? "Hide which programs it keeps apart ▴" : "Keep programs apart… ▾"}</button>
      {edit && <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        {[0, 1].map(side => (
          <div key={side}>
            <div style={{ fontSize: 11, fontWeight: 700, color: DS.mut, marginBottom: 5 }}>{side ? "…never together with" : "These programs…"}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {LINES.filter(l => l.key !== "club").map(l0 => lineMeta(l0.key)).map(l => <button key={l.key} disabled={busy} onClick={() => toggle(side, l.key)} style={chipStyle(sides[side].includes(l.key), l.color, narrow)}>{l.label}</button>)}
            </div>
          </div>
        ))}
      </div>}
    </Panel>
  );
}
