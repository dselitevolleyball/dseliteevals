// DSSC Marketing → Plan & flow, and Priorities.
//
// Plan & flow: the six-week rotation the planner will run (lines × weeks),
// how that balances against the line weights (and what actually went out
// the last four weeks), and the live program signals from the website feed —
// each with "Make a post".
// Priorities: what Drew wants pushed and when (the seeded Thanksgiving push
// lives here); the planner boosts the listed lines inside the window.

import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Tag, inputStyle, Grow } from "./DsscHub.jsx";
import { mktApi, isMissingTable, MIGRATION_MSG, LINES, lineMeta, lineLabel, LineChip, ANGLES, DEFAULT_WEIGHTS, addDays, fmtDate, mondayOf, isoLocal, chipStyle, Msg, Panel, H } from "./DsscMarketingKit.jsx";

const ANGLE_ORDER = ["last_call", "starting_soon", "just_started", "new", "priority", "reminder", "evergreen"];
const ANGLE_COLOR = { last_call: DS.orange, starting_soon: DS.lime, just_started: "#7FD1C3", new: "#7FD1C3", priority: DS.orange, reminder: DS.mut, evergreen: DS.dim };

// ── Plan & flow ─────────────────────────────────────────────────────────────
export function MarketingPlan({ week, status, narrow, onOpenWeek }) {
  const [flow, setFlow] = useState(null);
  const [flowErr, setFlowErr] = useState("");
  const [feed, setFeed] = useState(null);
  const [feedErr, setFeedErr] = useState("");
  const [history, setHistory] = useState([]);
  const [showEvergreen, setShowEvergreen] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const start = week < mondayOf() ? mondayOf() : week;

  useEffect(() => {
    setFlow(null); setFlowErr("");
    mktApi("flow", { start_week: start, weeks: 6 }).then(d => setFlow(Array.isArray(d) ? d : d.flow || d.weeks || [])).catch(e => { setFlowErr(e.message); setFlow([]); });
  }, [start]);
  useEffect(() => {
    mktApi("programs").then(setFeed).catch(e => { setFeedErr(e.message); setFeed({}); });
    supabase.from("mkt_items").select("id, week_of, channel, line, status").gte("week_of", addDays(mondayOf(), -28)).lt("week_of", mondayOf()).in("status", ["approved", "published", "publishing"])
      .then(({ data }) => setHistory(data || []));
  }, []);

  const weights = { ...DEFAULT_WEIGHTS, ...(status?.settings?.weights || {}) };
  const maxCell = useMemo(() => Math.max(1, ...(flow || []).flatMap(w => Object.values(w.lines || {}).map(Number))), [flow]);
  const totals = useMemo(() => { const t = {}; for (const w of flow || []) for (const [k, v] of Object.entries(w.lines || {})) t[k] = (t[k] || 0) + Number(v || 0); return t; }, [flow]);
  const past = useMemo(() => { const t = {}; for (const it of history) t[it.line] = (t[it.line] || 0) + 1; return t; }, [history]);
  const sum = (o) => Object.values(o).reduce((a, b) => a + Number(b || 0), 0) || 1;
  const wSum = sum(Object.fromEntries(LINES.map(l => [l.key, weights[l.key] || 0])));
  const tSum = sum(totals), pSum = sum(past);

  const signals = useMemo(() => {
    const s = Array.isArray(feed?.signals) ? feed.signals : [];
    return [...s].sort((a, b) => ANGLE_ORDER.indexOf(a.angle) - ANGLE_ORDER.indexOf(b.angle) || (b.urgency || 0) - (a.urgency || 0) || String(a.program?.first_date || "").localeCompare(String(b.program?.first_date || "")));
  }, [feed]);
  const groups = useMemo(() => { const m = new Map(); for (const s of signals) { if (!m.has(s.angle)) m.set(s.angle, []); m.get(s.angle).push(s); } return [...m.entries()]; }, [signals]);

  const makePost = async (s, key) => {
    setBusy(key); setMsg(null);
    const p = s.program || {};
    const instruction = `Make ONE social post (Facebook + Instagram) for "${p.name || lineLabel(s.line)}" — angle: ${ANGLES[s.angle] || s.angle}. ${s.reason || ""}`.trim();
    try {
      const d = await mktApi("generate", { week_of: start, instruction, single: true, channel: "social", line: s.line, angle: s.angle, program_id: p.id || null, replace_drafts: false });
      setMsg({ ok: `${(d.items || []).length || 1} draft added to the week of ${fmtDate(start)}.`, week: start });
    } catch (e) { setMsg({ err: e.message }); }
    setBusy("");
  };

  return (
    <div>
      <Panel style={{ marginBottom: 14 }}>
        <H>The next six weeks</H>
        <div style={{ fontSize: 12, color: DS.mut, marginBottom: 10 }}>How many posts, emails and texts each line gets per week if the planner runs as set — weights, priorities, what's starting, and nothing twice in a row. Tap a week to open it.</div>
        {flow == null ? <div style={{ color: DS.mut }}>Loading…</div> : flowErr ? <Msg msg={{ err: flowErr }} /> : !flow.length ? <div style={{ color: DS.mut }}>No plan yet.</div> : (
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table style={{ borderCollapse: "separate", borderSpacing: 3, fontSize: 13, minWidth: 420, width: "100%" }}>
              <thead><tr>
                <th style={{ textAlign: "left", fontSize: 11, color: DS.mut, fontWeight: 700, position: "sticky", left: 0, background: DS.panel, minWidth: narrow ? 86 : 120 }}>Line</th>
                {flow.map(w => <th key={w.weekOf} onClick={() => onOpenWeek?.(w.weekOf)} style={{ fontSize: 11, color: w.weekOf === week ? DS.lime : DS.mut, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", padding: "0 4px" }}>{fmtDate(w.weekOf)}</th>)}
              </tr></thead>
              <tbody>
                {LINES.map(l0 => { const l = lineMeta(l0.key); return (
                  <tr key={l.key}>
                    <td style={{ position: "sticky", left: 0, background: DS.panel, whiteSpace: "nowrap", fontWeight: 700, fontSize: 12, color: l.color }}>{l.label}</td>
                    {flow.map(w => { const n = Number(w.lines?.[l.key] || 0); return (
                      <td key={w.weekOf} style={{ textAlign: "center", height: 34, borderRadius: 6, background: n ? hexA(l.color, 0.18 + 0.62 * (n / maxCell)) : "rgba(255,255,255,0.03)", color: n ? (n / maxCell > 0.55 ? DS.bg : DS.text) : DS.dim, fontWeight: 800 }}>{n || "·"}</td>
                    ); })}
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        )}
        {(flow || []).some(w => (w.notes || []).length) && (showNotes
          ? <div style={{ marginTop: 10, fontSize: 12, color: DS.mut, lineHeight: 1.5 }}>
              {flow.filter(w => (w.notes || []).length).map(w => <div key={w.weekOf}><b style={{ color: DS.text }}>{fmtDate(w.weekOf)}:</b> {w.notes.join(" · ")}</div>)}
              <Btn kind="link" small onClick={() => setShowNotes(false)} style={{ marginTop: 6 }}>Hide the planner's notes ▴</Btn>
            </div>
          : <Btn kind="link" small onClick={() => setShowNotes(true)} style={{ marginTop: 10 }}>Why these? The planner's notes ▾</Btn>)}
      </Panel>

      <Panel style={{ marginBottom: 14 }}>
        <H>Line balance</H>
        <div style={{ display: "flex", gap: 14, fontSize: 11, color: DS.mut, marginBottom: 10, flexWrap: "wrap" }}>
          <span><Swatch c="rgba(255,255,255,0.35)" /> target (weights)</span><span><Swatch c={DS.lime} /> planned, next 6 weeks</span><span><Swatch c="#7FD1C3" /> went out, last 4 weeks</span>
        </div>
        {LINES.map(l0 => {
          const l = lineMeta(l0.key);
          const tgt = (weights[l.key] || 0) / wSum, pl = (totals[l.key] || 0) / tSum, pa = (past[l.key] || 0) / pSum;
          const off = flow && flow.length && Math.abs(pl - tgt) > 0.08;
          return (
            <div key={l.key} style={{ display: "grid", gridTemplateColumns: narrow ? "86px 1fr" : "130px 1fr 60px", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: l.color }}>{l.label}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Bar v={tgt} c="rgba(255,255,255,0.35)" /><Bar v={pl} c={DS.lime} /><Bar v={pa} c="#7FD1C3" />
              </div>
              {!narrow && <div style={{ fontSize: 11, color: off ? DS.orange : DS.dim, textAlign: "right" }}>w {weights[l.key] || 0}{off ? (pl > tgt ? " ▲" : " ▼") : ""}</div>}
            </div>
          );
        })}
      </Panel>

      <Panel>
        <H>What's happening (from the website)</H>
        <div style={{ fontSize: 12, color: DS.mut, marginBottom: 10 }}>Programs starting soon, new, just started or about to close — the planner leans on these. "Make a post" drafts one for the week of {fmtDate(start)}.</div>
        <Msg msg={msg} style={{ marginBottom: 10 }} />
        {msg?.week && <Btn kind="link" small onClick={() => onOpenWeek?.(msg.week)} style={{ marginBottom: 10 }}>Open that week to approve →</Btn>}
        {feed == null ? <div style={{ color: DS.mut }}>Loading…</div> : feedErr ? <Msg msg={{ err: feedErr }} /> : !signals.length ? <div style={{ color: DS.mut }}>No signals right now.</div> : groups.map(([angle, list]) => {
          if (angle === "evergreen" && !showEvergreen) return <Btn key={angle} kind="link" small onClick={() => setShowEvergreen(true)}>Show {list.length} ongoing programs ▾</Btn>;
          return (
            <div key={angle} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: ANGLE_COLOR[angle] || DS.mut, margin: "6px 0" }}>{ANGLES[angle] || angle} · {list.length}</div>
              {list.map((s, i) => {
                const p = s.program || {}, key = angle + ":" + (p.id || i);
                return (
                  <div key={key} style={{ display: "flex", gap: 10, alignItems: narrow ? "stretch" : "center", flexDirection: narrow ? "column" : "row", padding: "10px 0", borderTop: "1px solid " + DS.line }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <LineChip line={s.line} />
                        <b style={{ fontSize: 14 }}>{p.register_url ? <a href={p.register_url} target="_blank" rel="noreferrer" style={{ color: DS.text, textDecoration: "none" }}>{p.name}</a> : p.name || lineLabel(s.line)}</b>
                        {s.urgency > 0 && <span title={"urgency " + s.urgency} style={{ color: DS.orange, fontSize: 11, letterSpacing: 1 }}>{"●".repeat(Math.min(5, s.urgency))}</span>}
                      </div>
                      <div style={{ fontSize: 12, color: DS.mut, marginTop: 3 }}>
                        {[p.ages, p.days?.length ? p.days.join("/") : "", p.time, p.first_date ? (p.status === "in_progress" ? "started " : "starts ") + fmtDate(p.first_date) : "", p.sessions_left != null && p.status === "in_progress" ? p.sessions_left + " sessions left" : ""].filter(Boolean).join(" · ")}
                      </div>
                      {s.reason && <div style={{ fontSize: 12, color: DS.dim, marginTop: 2 }}>{s.reason}</div>}
                    </div>
                    <Btn kind="ghost" disabled={!!busy} onClick={() => makePost(s, key)} style={narrow ? { justifyContent: "center", minHeight: 44, fontSize: 14 } : {}}>{busy === key ? "Writing…" : "Make a post"}</Btn>
                  </div>
                );
              })}
            </div>
          );
        })}
      </Panel>
    </div>
  );
}
const Swatch = ({ c }) => <span style={{ display: "inline-block", width: 10, height: 10, background: c, borderRadius: 2, verticalAlign: "middle", marginRight: 4 }} />;
const Bar = ({ v, c }) => <div style={{ height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 3 }}><div style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%`, height: "100%", background: c, borderRadius: 3 }} /></div>;
function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return `rgba(178,208,73,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(2)})`;
}

// ── Priorities ──────────────────────────────────────────────────────────────
const CHANNELS = [["social", "Social"], ["email", "Email"], ["sms", "Texts"]];
const blank = () => ({ title: "", notes: "", lines: [], weight: 3, starts_on: mondayOf(), ends_on: addDays(mondayOf(), 13), channels: ["social", "email", "sms"], active: true });

export function MarketingPriorities({ narrow, onChanged }) {
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from("mkt_priorities").select("*").order("active", { ascending: false }).order("starts_on", { ascending: true, nullsFirst: false });
    if (error) { setMsg({ err: isMissingTable(error) ? MIGRATION_MSG : error.message }); setRows([]); return; }
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (p) => {
    if (!String(p.title || "").trim()) { setMsg({ err: "Give it a title." }); return; }
    if (p.starts_on && p.ends_on && p.ends_on < p.starts_on) { setMsg({ err: "The end date is before the start." }); return; }
    setBusy("save"); setMsg(null);
    try {
      const clean = { ...p, title: p.title.trim(), weight: Number(p.weight) || 3, starts_on: p.starts_on || null, ends_on: p.ends_on || null };
      delete clean.created_at; delete clean.updated_at;
      await mktApi("priority_save", { priority: clean });
      setEdit(null); setMsg({ ok: "Saved — the planner uses it from the next generate." }); await load(); onChanged?.();
    } catch (e) { setMsg({ err: e.message }); }
    setBusy("");
  };
  const toggle = async (p) => { setRows(rs => rs.map(r => r.id === p.id ? { ...r, active: !r.active } : r)); try { await mktApi("priority_save", { priority: { id: p.id, active: !p.active } }); onChanged?.(); } catch (e) { setMsg({ err: e.message }); load(); } };
  const del = async (p) => { if (!window.confirm(`Delete "${p.title}"?`)) return; try { await mktApi("priority_delete", { id: p.id }); setEdit(null); await load(); onChanged?.(); } catch (e) { setMsg({ err: e.message }); } };
  const today = isoLocal(new Date());

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: DS.mut, flex: 1, minWidth: 220 }}>What to push, and when. Inside the dates, the listed lines get their weight doubled (and more for weight 4–5), on the channels you pick.</div>
        <Btn kind="primary" onClick={() => setEdit(blank())} style={narrow ? { minHeight: 44, fontSize: 15 } : {}}>+ New priority</Btn>
      </div>
      <Msg msg={msg} style={{ marginBottom: 10 }} />
      {edit && !edit.id && <PriorityEditor p={edit} setP={setEdit} onSave={save} onCancel={() => setEdit(null)} busy={busy} narrow={narrow} />}
      {rows == null ? <div style={{ color: DS.mut }}>Loading…</div> : !rows.length ? <Panel style={{ color: DS.mut, borderStyle: "dashed" }}>No priorities yet.</Panel> : rows.map(p => {
        if (edit && edit.id === p.id) return <PriorityEditor key={p.id} p={edit} setP={setEdit} onSave={save} onCancel={() => setEdit(null)} onDelete={() => del(p)} busy={busy} narrow={narrow} />;
        const live = p.active && (!p.starts_on || p.starts_on <= today) && (!p.ends_on || p.ends_on >= today);
        const past = p.ends_on && p.ends_on < today;
        return (
          <Panel key={p.id} style={{ marginBottom: 10, opacity: p.active && !past ? 1 : 0.6, borderColor: live ? "rgba(255,115,0,0.45)" : DS.line }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <b style={{ fontSize: 15, flex: 1, minWidth: 180 }}>{p.title}</b>
              {live && <Tag color={DS.orange} fill>Live</Tag>}
              {past && <Tag color={DS.dim}>Ended</Tag>}
              <span title={"weight " + p.weight} style={{ color: DS.orange, letterSpacing: 2 }}>{"●".repeat(p.weight || 0)}<span style={{ color: DS.dim }}>{"●".repeat(Math.max(0, 5 - (p.weight || 0)))}</span></span>
            </div>
            <div style={{ fontSize: 12, color: DS.mut, marginTop: 4 }}>{p.starts_on ? fmtDate(p.starts_on) : "Now"} – {p.ends_on ? fmtDate(p.ends_on, { month: "short", day: "numeric", year: "numeric" }) : "open-ended"} · {(p.channels || []).join(", ") || "no channels"}</div>
            {p.notes && <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{p.notes}</div>}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
              {(p.lines || []).map(l => <LineChip key={l} line={l} />)}
              {(p.avoid_lines || []).length > 0 && <span style={{ fontSize: 11, color: DS.dim }}>less: {(p.avoid_lines || []).map(lineLabel).join(", ")}</span>}
              <span style={{ flex: 1 }} />
              <Btn small kind="quiet" onClick={() => toggle(p)} style={narrow ? { minHeight: 38 } : {}}>{p.active ? "Pause" : "Turn on"}</Btn>
              <Btn small kind="ghost" onClick={() => setEdit({ ...p })} style={narrow ? { minHeight: 38 } : {}}>Edit</Btn>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

function PriorityEditor({ p, setP, onSave, onCancel, onDelete, busy, narrow }) {
  const set = (k, v) => setP(x => ({ ...x, [k]: v }));
  const toggleIn = (k, v) => setP(x => { const a = x[k] || []; return { ...x, [k]: a.includes(v) ? a.filter(y => y !== v) : [...a, v] }; });
  const lbl = { fontSize: 11, fontWeight: 700, color: DS.mut, margin: "12px 0 5px" };
  return (
    <Panel style={{ marginBottom: 12, borderColor: DS.lime }}>
      <div style={lbl}>Title</div>
      <input value={p.title || ""} onChange={e => set("title", e.target.value)} placeholder="Thanksgiving break — push Camp Elevate" style={{ ...inputStyle, fontSize: narrow ? 16 : 14 }} />
      <div style={lbl}>Notes for the machine (what to say, what matters)</div>
      <Grow value={p.notes || ""} onChange={e => set("notes", e.target.value)} minRows={3} style={{ fontSize: narrow ? 16 : 14 }} />
      <div style={lbl}>Lines</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{LINES.map(l0 => lineMeta(l0.key)).map(l => <button key={l.key} onClick={() => toggleIn("lines", l.key)} style={chipStyle((p.lines || []).includes(l.key), l.color, narrow)}>{l.label}</button>)}</div>
      <div style={lbl}>Weight · {p.weight}</div>
      <input type="range" min={1} max={5} step={1} value={p.weight || 3} onChange={e => set("weight", Number(e.target.value))} style={{ width: "100%", maxWidth: 360, accentColor: DS.orange, height: 28 }} />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div><div style={lbl}>Starts</div><input type="date" value={p.starts_on || ""} onChange={e => set("starts_on", e.target.value)} style={{ ...inputStyle, width: "auto", colorScheme: "dark" }} /></div>
        <div><div style={lbl}>Ends</div><input type="date" value={p.ends_on || ""} onChange={e => set("ends_on", e.target.value)} style={{ ...inputStyle, width: "auto", colorScheme: "dark" }} /></div>
      </div>
      <div style={lbl}>Channels</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{CHANNELS.map(([k, l]) => <button key={k} onClick={() => toggleIn("channels", k)} style={chipStyle((p.channels || []).includes(k), DS.lime, narrow)}>{l}</button>)}</div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 14, cursor: "pointer" }}><input type="checkbox" checked={p.active !== false} onChange={e => set("active", e.target.checked)} style={{ width: 20, height: 20, accentColor: DS.lime }} /> Active</label>
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <Btn kind="primary" disabled={busy === "save"} onClick={() => onSave(p)} style={narrow ? { minHeight: 44, fontSize: 15 } : {}}>{busy === "save" ? "Saving…" : "Save"}</Btn>
        <Btn kind="quiet" onClick={onCancel} style={narrow ? { minHeight: 44, fontSize: 15 } : {}}>Cancel</Btn>
        {onDelete && <Btn kind="link" onClick={onDelete} style={{ color: DS.orange, marginLeft: "auto" }}>Delete</Btn>}
      </div>
    </Panel>
  );
}
