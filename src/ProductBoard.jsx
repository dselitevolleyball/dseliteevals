// Product (Drew, Oct 28 2026): a Linear-style board for HQ itself.
//   Board     Inbox (staff requests from the 💡 Feedback button) -> Backlog ->
//             Planned -> Building (an agent is on it) -> In review (PR +
//             preview) -> Shipped. Drag cards between columns; click one to
//             edit the spec, pick the model and effort, hand it to the agent,
//             ask for changes, and ship.
//   Usage     Claude spend, tokens and calls by day / feature / model, agent
//             runs, the latest rate-limit headers, and (with an Admin API key)
//             the whole Anthropic organization's month.
//   Settings  GitHub tokens (so HQ can start agents), budget, defaults, who
//             hears about new requests.
// Server: api/product.js (+ api/product-agent.js for the agent itself).

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "./supabase";
import { HQ_DSSC } from "./hq-base.js";
import { STATUSES, STATUS_LABEL, KINDS, PRIORITIES, AREAS, REPOS, itemKey } from "../shared/product.js";
import { MODELS, EFFORTS, priceOf, modelLabel } from "../shared/ai-pricing.js";

const C = { bg: "#0a0a0a", card: "#141414", card2: "#1b1b1b", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", dim: "#6f6f6f", red: "#ef4444", grn: "#22c55e", amber: "#f59e0b", blue: "#60a5fa" };
// drippingsportsclub.com/hq wears the DSSC greens, like the rest of that app.
if (HQ_DSSC) Object.assign(C, { bg: "#082C2A", card: "#0C3A37", card2: "#104946", border: "#1F5A55", gold: "#B2D049", mut: "#A9C7C3", dim: "#7FA39F" });
const BOARD = ["inbox", "backlog", "planned", "building", "review", "shipped"];
const statusColor = Object.fromEntries(STATUSES.map(([k, , c]) => [k, c]));
const PRI_GLYPH = { 0: "—", 1: "!!!", 2: "▲", 3: "■", 4: "▼" };
const PRI_COLOR = { 0: C.dim, 1: C.red, 2: C.amber, 3: C.blue, 4: C.mut };
const RUN_LABEL = { queued: "Waiting for GitHub", running: "Agent working", succeeded: "Done", failed: "Failed", canceled: "Canceled" };
const RUN_COLOR = { queued: C.amber, running: C.amber, succeeded: C.grn, failed: C.red, canceled: C.dim };
const money = (n, d = 2) => "$" + Number(n || 0).toFixed(d);
const num = (n) => Number(n || 0).toLocaleString();
const tok = (n) => { n = Number(n || 0); return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n); };
const ago = (iso) => { if (!iso) return ""; const s = (Date.now() - new Date(iso)) / 1000; return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + "m ago" : s < 86400 ? Math.round(s / 3600) + "h ago" : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
const dur = (ms) => { const s = Math.round(Number(ms || 0) / 1000); return s >= 60 ? Math.floor(s / 60) + "m " + (s % 60) + "s" : s + "s"; };
const initials = (n) => String(n || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();

const btn = (kind = "primary", small) => ({
  padding: small ? "5px 10px" : "8px 14px", borderRadius: 8, fontWeight: 800, fontSize: small ? 12 : 13, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
  border: kind === "ghost" ? "1px solid " + C.border : kind === "danger" ? "1px solid " + C.red : "none",
  background: kind === "primary" ? C.gold : kind === "ok" ? C.grn : "transparent", color: kind === "primary" || kind === "ok" ? "#000" : kind === "danger" ? C.red : C.text,
});
const input = { width: "100%", boxSizing: "border-box", background: "#0f0f0f", border: "1px solid " + C.border, borderRadius: 8, color: C.text, fontFamily: "inherit", fontSize: 14, padding: "8px 10px" };
const lbl = { fontSize: 10, fontWeight: 800, color: C.mut, textTransform: "uppercase", letterSpacing: 0.5, margin: "12px 0 4px", display: "block" };
const chip = (text, color) => <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 999, background: color + "22", color, whiteSpace: "nowrap" }}>{text}</span>;

async function api(action, payload = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch("/api/product", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify({ action, ...payload }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
  return d;
}

export default function ProductBoard({ narrow }) {
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem("product.tab") || "board"; } catch { return "board"; } });
  const [boot, setBoot] = useState(null);
  const [err, setErr] = useState("");
  const go = (t) => { setTab(t); try { sessionStorage.setItem("product.tab", t); } catch { /* ignore */ } };
  const loadBoot = useCallback(() => api("boot").then(setBoot).catch(e => setErr(e.message)), []);
  useEffect(() => { loadBoot(); }, [loadBoot]);
  if (err) return <div style={{ padding: 24, color: C.red }}>{err}</div>;
  if (!boot) return <div style={{ padding: 24, color: C.mut }}>Loading…</div>;
  if (!boot.settings) return <div style={{ padding: 24, color: C.mut }}>The product board is for Drew and HQ admins. Use the 💡 Feedback button to send an idea.</div>;
  const connected = (boot.github || []).length > 0;
  return (
    <div style={{ maxWidth: tab === "board" && !narrow ? "none" : 1150, margin: "0 auto", color: C.text }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.gold }}>Product</div>
        <div style={{ display: "flex", gap: 4 }}>
          {[["board", "Board"], ["usage", "Usage"], ["settings", "Settings"]].map(([k, l]) => (
            <button key={k} onClick={() => go(k)} style={{ ...btn("ghost", true), borderColor: tab === k ? C.gold : C.border, color: tab === k ? C.gold : C.text }}>{l}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {!connected && <button onClick={() => go("settings")} style={{ ...btn("ghost", true), borderColor: C.amber, color: C.amber }}>Connect GitHub so agents can build →</button>}
      </div>
      {tab === "board" && <Board boot={boot} narrow={narrow} />}
      {tab === "usage" && <Usage boot={boot} narrow={narrow} />}
      {tab === "settings" && <Settings boot={boot} onSaved={loadBoot} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── board
function Board({ boot, narrow }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState(() => { const v = new URLSearchParams(location.search).get("item"); return v ? Number(v) : null; });
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [phoneCol, setPhoneCol] = useState("inbox");
  const [drag, setDrag] = useState(null);
  const [adding, setAdding] = useState("");
  const load = useCallback(() => api("items").then(d => setItems(d.items)).catch(e => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  // Agents report back on their own; look again while something is running.
  const active = (items || []).some(i => i.last_run && ["queued", "running"].includes(i.last_run.status));
  useEffect(() => { const t = setInterval(load, active ? 15000 : 60000); return () => clearInterval(t); }, [load, active]);

  const shown = useMemo(() => (items || []).filter(i => (!q || (i.title + " " + i.body + " " + itemKey(i.id) + " " + (i.requested_name || "")).toLowerCase().includes(q.toLowerCase())) && (!kind || i.kind === kind)), [items, q, kind]);
  const cols = [...BOARD, ...(showClosed ? ["declined", "canceled"] : [])];
  const byCol = (s) => shown.filter(i => i.status === s).sort((a, b) => (a.sort - b.sort) || (b.id - a.id));

  const move = async (id, status) => {
    const it = items.find(x => x.id === id); if (!it || it.status === status) return;
    setItems(xs => xs.map(x => x.id === id ? { ...x, status } : x));
    try { await api("move", { id, status }); } catch (e) { setErr(e.message); }
    load();
  };
  const quickAdd = async (status) => {
    const t = adding.trim(); if (!t) return;
    try { const d = await api("create", { item: { title: t, status } }); setAdding(""); await load(); setOpenId(d.item.id); } catch (e) { setErr(e.message); }
  };

  if (!items) return <div style={{ color: C.mut, padding: 12 }}>{err || "Loading the board…"}</div>;
  const col = (s) => {
    const list = byCol(s);
    return (
      <div key={s} onDragOver={e => { e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (drag) move(drag, s); setDrag(null); }}
        style={{ flex: narrow ? "1 1 auto" : "1 0 220px", maxWidth: narrow ? "none" : 320, minWidth: 0, background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 10, display: "flex", flexDirection: "column", gap: 8, maxHeight: narrow ? "none" : "calc(100vh - 210px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: 9, background: statusColor[s] }} />
          <b style={{ fontSize: 13 }}>{STATUS_LABEL[s]}</b>
          <span style={{ fontSize: 12, color: C.mut }}>{list.length}</span>
          <div style={{ flex: 1 }} />
          {(s === "backlog" || s === "planned") && <button onClick={() => setAdding(a => a === "" ? " " : "")} title="New card" style={{ ...btn("ghost", true), padding: "2px 8px" }}>+</button>}
        </div>
        {s === "inbox" && <div style={{ fontSize: 11, color: C.dim }}>Staff requests from the 💡 Feedback button - approve or decline.</div>}
        {(s === "backlog") && adding !== "" && (
          <div style={{ display: "flex", gap: 6 }}>
            <input autoFocus value={adding.trimStart()} onChange={e => setAdding(e.target.value || " ")} onKeyDown={e => { if (e.key === "Enter") quickAdd(s); if (e.key === "Escape") setAdding(""); }} placeholder="What should HQ do?" style={{ ...input, fontSize: 13 }} />
            <button onClick={() => quickAdd(s)} style={btn("primary", true)}>Add</button>
          </div>
        )}
        <div style={{ overflowY: narrow ? "visible" : "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 2 }}>
          {list.map(i => <Card key={i.id} i={i} onOpen={() => setOpenId(i.id)} onDrag={() => setDrag(i.id)} />)}
          {!list.length && <div style={{ fontSize: 12, color: C.dim, padding: "10px 4px" }}>{s === "inbox" ? "Nothing waiting." : "—"}</div>}
        </div>
      </div>
    );
  };
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search cards…" style={{ ...input, width: narrow ? "100%" : 240 }} />
        <select value={kind} onChange={e => setKind(e.target.value)} style={{ ...input, width: "auto" }}>
          <option value="">All types</option>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <label style={{ fontSize: 12, color: C.mut, display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} style={{ accentColor: C.gold }} />Show declined</label>
        {err && <span style={{ color: C.red, fontSize: 12 }}>{err}</span>}
      </div>
      {narrow ? (
        <>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 10, paddingBottom: 4 }}>
            {cols.map(s => <button key={s} onClick={() => setPhoneCol(s)} style={{ ...btn("ghost", true), borderColor: phoneCol === s ? statusColor[s] : C.border, color: phoneCol === s ? statusColor[s] : C.text }}>{STATUS_LABEL[s]} {byCol(s).length}</button>)}
          </div>
          {col(phoneCol)}
        </>
      ) : <div style={{ display: "flex", gap: 10, overflowX: "auto", alignItems: "flex-start", paddingBottom: 8 }}>{cols.map(col)}</div>}
      {openId && <Detail id={openId} boot={boot} narrow={narrow} onClose={() => { setOpenId(null); const u = new URL(location.href); if (u.searchParams.has("item")) { u.searchParams.delete("item"); history.replaceState(null, "", u); } }} onChanged={load} />}
    </div>
  );
}

function Card({ i, onOpen, onDrag }) {
  const r = i.last_run;
  const running = r && ["queued", "running"].includes(r.status);
  return (
    <div draggable onDragStart={onDrag} onClick={onOpen} style={{ background: C.card2, border: "1px solid " + (running ? C.amber : C.border), borderRadius: 10, padding: "9px 10px", cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.dim }}>
        <span title={PRIORITIES.find(p => p[0] === i.priority)?.[1]} style={{ color: PRI_COLOR[i.priority], fontWeight: 900, minWidth: 18 }}>{PRI_GLYPH[i.priority]}</span>
        <span>{itemKey(i.id)}</span>
        <div style={{ flex: 1 }} />
        {i.kind === "bug" && chip("Bug", C.red)}
        {i.kind === "improvement" && chip("Better", C.blue)}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, margin: "4px 0 6px", lineHeight: 1.3 }}>{i.title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 11, color: C.mut }}>
        {i.area && chip(i.area, C.mut)}
        {(i.votes || []).length > 1 && <span title="Staff who want this">▲ {(i.votes || []).length}</span>}
        {r && <span style={{ color: RUN_COLOR[r.status] }}>{running ? "● " : ""}{RUN_LABEL[r.status]}</span>}
        <div style={{ flex: 1 }} />
        {Number(i.agent_cost) > 0 && <span title="Agent spend on this card">{money(i.agent_cost)}</span>}
        {i.requested_name && <span title={"From " + i.requested_name} style={{ width: 20, height: 20, borderRadius: 20, background: "#333", color: "#ddd", fontSize: 9, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{initials(i.requested_name)}</span>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── one card
function Detail({ id, boot, narrow, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [change, setChange] = useState("");
  const [comment, setComment] = useState("");
  const [openRun, setOpenRun] = useState(null);
  const load = useCallback(() => api("item", { id }).then(x => { setD(x); setF(x.item); }).catch(e => setMsg({ err: e.message })), [id]);
  useEffect(() => { load(); }, [load]);
  const active = d?.runs?.find(r => ["queued", "running"].includes(r.status));
  useEffect(() => { if (!active) return; const t = setInterval(load, 10000); return () => clearInterval(t); }, [active, load]);
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  const save = async (patch) => {
    const next = { ...f, ...patch }; setF(next);
    try { const x = await api("save", { item: { id, ...patch } }); setF(x.item); setD(dd => ({ ...dd, item: x.item })); onChanged(); } catch (e) { setMsg({ err: e.message }); }
  };
  const run = async (key, fn, ok) => {
    setBusy(key); setMsg(null);
    try { const x = await fn(); setMsg(x?.dispatch_error ? { err: x.dispatch_error } : ok ? { ok: typeof ok === "function" ? ok(x) : ok } : null); await load(); onChanged(); }
    catch (e) { setMsg({ err: e.message }); }
    setBusy("");
  };
  if (!d || !f) return <Shell narrow={narrow} onClose={onClose}><div style={{ color: msg?.err ? C.red : C.mut }}>{msg?.err || "Loading…"}</div></Shell>;
  const it = d.item, ctx = it.request_context || {};
  const price = priceOf(f.model);
  const canBuild = ["backlog", "planned", "review"].includes(it.status) && !active;

  return (
    <Shell narrow={narrow} onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.mut }}>
        <span>{itemKey(it.id)}</span>{chip(STATUS_LABEL[it.status], statusColor[it.status])}
        {it.requested_name && <span>from {it.requested_name} · {ago(it.created_at)}</span>}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={btn("ghost", true)}>Close</button>
      </div>
      <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} onBlur={() => f.title !== it.title && save({ title: f.title })}
        style={{ ...input, fontSize: 20, fontWeight: 800, border: "1px solid transparent", background: "transparent", padding: "6px 0", marginTop: 6 }} />

      {msg && <div style={{ fontSize: 13, margin: "6px 0", color: msg.err ? C.red : C.grn }}>{msg.err || msg.ok}</div>}

      {it.status === "inbox" && (
        <div style={{ background: "#1e1530", border: "1px solid #a78bfa55", borderRadius: 10, padding: 12, margin: "8px 0" }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Approve this request?</div>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional note to the person who sent it" style={{ ...input, fontSize: 13 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button disabled={!!busy} onClick={() => run("decide", () => api("decide", { id, approve: true, note }), "Approved - it's in the Backlog and they've been emailed.")} style={btn("ok")}>✓ Approve</button>
            <button disabled={!!busy} onClick={() => run("decide", () => api("decide", { id, approve: false, note }), "Declined - they've been emailed.")} style={btn("danger")}>Decline</button>
          </div>
        </div>
      )}

      <div style={{ display: narrow ? "block" : "grid", gridTemplateColumns: "minmax(0,1fr) 270px", gap: 18 }}>
        <div>
          <span style={lbl}>Description - what the agent builds from</span>
          <textarea value={f.body} onChange={e => setF({ ...f, body: e.target.value })} onBlur={() => f.body !== it.body && save({ body: f.body })} rows={narrow ? 8 : 12}
            placeholder={"What should it do, for whom, and where in HQ?\nWhat does done look like? Any screens, rules or edge cases?"} style={{ ...input, lineHeight: 1.5, resize: "vertical" }} />
          {(ctx.view_label || ctx.url || d.screenshot_url) && (
            <div style={{ fontSize: 12, color: C.mut, marginTop: 6 }}>
              {ctx.view_label && <>Sent from <b style={{ color: C.text }}>{ctx.view_label}</b>{ctx.app ? ` (${ctx.app === "dssc" ? "DSSC" : "DS Elite"})` : ""}. </>}
              {(it.votes || []).length > 1 && <>{(it.votes || []).length} people want this. </>}
              {d.screenshot_url && <div><a href={d.screenshot_url} target="_blank" rel="noreferrer"><img src={d.screenshot_url} alt="Screenshot they attached" style={{ maxWidth: "100%", maxHeight: 220, borderRadius: 8, marginTop: 6, border: "1px solid " + C.border }} /></a></div>}
            </div>
          )}

          {/* ── agent ── */}
          <div style={{ background: C.card2, border: "1px solid " + (active ? C.amber : C.border), borderRadius: 12, padding: 12, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <b style={{ fontSize: 14 }}>🤖 Agent</b>
              <span style={{ fontSize: 12, color: C.mut }}>{modelLabel(f.model)} · {EFFORTS.find(e => e[0] === f.effort)?.[1]} effort · up to {money(f.max_budget_usd, 0)} a run</span>
              <div style={{ flex: 1 }} />
              {it.pr_url && <a href={it.pr_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: C.blue }}>{it.pr_number ? `PR #${it.pr_number}` : "Branch"} ↗</a>}
              {it.preview_url && <a href={it.preview_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: C.gold, fontWeight: 800 }}>Open preview ↗</a>}
            </div>
            {active ? (
              <div style={{ marginTop: 8, fontSize: 13 }}>
                <span style={{ color: C.amber, fontWeight: 800 }}>● {RUN_LABEL[active.status]}</span> <span style={{ color: C.mut }}>({active.kind}, started {ago(active.created_at)})</span>
                {active.github_run_url && <> · <a href={active.github_run_url} target="_blank" rel="noreferrer" style={{ color: C.blue }}>watch it on GitHub ↗</a></>}
                {active.status === "queued" && active.error && <div style={{ color: C.red, fontSize: 12, marginTop: 4 }}>{active.error}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  {active.status === "queued" && <button disabled={!!busy} onClick={() => run("re", () => api("redispatch", { run_id: active.id }), "Asked GitHub to start it.")} style={btn("ghost", true)}>Start again</button>}
                  <button disabled={!!busy} onClick={() => run("cancel", () => api("cancel_run", { run_id: active.id }), "Canceled.")} style={btn("danger", true)}>Cancel run</button>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 10 }}>
                {!it.branch && canBuild && <button disabled={!!busy || !String(f.body || "").trim()} onClick={() => run("build", () => api("build", { id }), (x) => x.dispatched ? "The agent is starting on GitHub - this card updates as it works (usually 5-20 minutes)." : "Queued.")} style={btn("primary")} title={!String(f.body || "").trim() ? "Write the description first" : ""}>{busy === "build" ? "Starting…" : "▶ Build it with the agent"}</button>}
                {it.branch && it.status !== "shipped" && (
                  <>
                    <textarea value={change} onChange={e => setChange(e.target.value)} rows={3} placeholder="Ask for changes after looking at the preview - e.g. &quot;Make the button green and move it above the list&quot;" style={{ ...input, fontSize: 13 }} />
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <button disabled={!!busy || !change.trim()} onClick={() => run("revise", async () => { const x = await api("revise", { id, instructions: change }); setChange(""); return x; }, "Sent to the agent.")} style={btn("ghost")}>{busy === "revise" ? "Sending…" : "↻ Send changes to the agent"}</button>
                      <button disabled={!!busy} onClick={() => { if (window.confirm(`Ship ${itemKey(id)} to the live app?\n\nThis merges the branch into main and Vercel deploys it.${it.preview_url ? "" : "\n\nThere's no preview link yet - make sure you've checked it."}`)) run("ship", () => api("ship", { id }), "Shipping - it merges to main in a minute or two."); }} style={btn("ok")}>🚀 Ship it</button>
                    </div>
                  </>
                )}
                {it.status === "shipped" && <div style={{ fontSize: 13, color: C.grn }}>✓ Shipped.</div>}
                {!canBuild && !it.branch && it.status !== "shipped" && <div style={{ fontSize: 12, color: C.mut }}>{it.status === "inbox" ? "Approve it first." : "Move it to Backlog or Planned to build it."}</div>}
              </div>
            )}
            {d.runs.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <span style={{ ...lbl, marginTop: 0 }}>Runs</span>
                {d.runs.map(r => (
                  <div key={r.id} style={{ borderTop: "1px solid " + C.border, padding: "7px 0", fontSize: 12 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", cursor: r.summary || r.error ? "pointer" : "default" }} onClick={() => setOpenRun(o => o === r.id ? null : r.id)}>
                      <span style={{ color: RUN_COLOR[r.status], fontWeight: 800, minWidth: 74 }}>{RUN_LABEL[r.status]}</span>
                      <span style={{ textTransform: "capitalize" }}>{r.kind}</span>
                      <span style={{ color: C.mut }}>{modelLabel(r.model)} · {r.effort}</span>
                      <div style={{ flex: 1 }} />
                      {r.cost_usd != null && <b>{money(r.cost_usd)}</b>}
                      {r.input_tokens != null && <span style={{ color: C.mut }}>{tok(Number(r.input_tokens) + Number(r.cache_read_tokens || 0) + Number(r.cache_write_tokens || 0))} in · {tok(r.output_tokens)} out</span>}
                      {r.num_turns != null && <span style={{ color: C.mut }}>{r.num_turns} turns</span>}
                      {r.duration_ms != null && <span style={{ color: C.mut }}>{dur(r.duration_ms)}</span>}
                      <span style={{ color: C.dim }}>{ago(r.created_at)}</span>
                      {r.github_run_url && <a href={r.github_run_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: C.blue }}>log ↗</a>}
                    </div>
                    {openRun === r.id && (r.summary || r.error || r.instructions) && (
                      <div style={{ whiteSpace: "pre-wrap", color: r.error ? C.red : "#ddd", background: "#0f0f0f", borderRadius: 8, padding: 10, marginTop: 6, lineHeight: 1.45 }}>
                        {r.instructions && <div style={{ color: C.mut, marginBottom: 6 }}>Asked: {r.instructions}</div>}
                        {r.error || r.summary}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── activity ── */}
          <span style={lbl}>Activity</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {d.events.map(e => (
              <div key={e.id} style={{ fontSize: 12, color: e.kind === "comment" ? C.text : C.mut, background: e.kind === "comment" ? C.card2 : "transparent", borderRadius: 8, padding: e.kind === "comment" ? "7px 10px" : "0 2px" }}>
                {e.kind === "comment" && <b>{e.by_name}: </b>}{e.body} <span style={{ color: C.dim }}>· {ago(e.at)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input value={comment} onChange={e => setComment(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && comment.trim()) run("c", async () => { await api("comment", { id, body: comment }); setComment(""); }); }} placeholder="Add a note (the agent reads these too)…" style={{ ...input, fontSize: 13 }} />
            <button disabled={!comment.trim() || !!busy} onClick={() => run("c", async () => { await api("comment", { id, body: comment }); setComment(""); })} style={btn("ghost", true)}>Add</button>
          </div>
        </div>

        {/* ── properties ── */}
        <div>
          <span style={lbl}>Status</span>
          <select value={it.status} onChange={e => run("move", () => api("move", { id, status: e.target.value }))} style={input}>
            {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <span style={lbl}>Type</span>
          <select value={f.kind} onChange={e => save({ kind: e.target.value })} style={input}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <span style={lbl}>Priority</span>
          <select value={f.priority} onChange={e => save({ priority: Number(e.target.value) })} style={input}>{PRIORITIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <span style={lbl}>Area</span>
          <select value={f.area || ""} onChange={e => save({ area: e.target.value })} style={input}><option value="">—</option>{AREAS.map(a => <option key={a}>{a}</option>)}</select>
          <span style={lbl}>Codebase</span>
          <select value={f.repo} onChange={e => save({ repo: e.target.value })} style={input}>{Object.entries(REPOS).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}</select>

          <div style={{ borderTop: "1px solid " + C.border, marginTop: 14, paddingTop: 2 }} />
          <span style={lbl}>Model</span>
          <select value={f.model} onChange={e => save({ model: e.target.value })} style={input}>
            {MODELS.map(m => <option key={m.id} value={m.id}>{m.label} - {m.tier} (${m.in}/${m.out} per M)</option>)}
          </select>
          <span style={lbl}>Effort</span>
          <select value={f.effort} onChange={e => save({ effort: e.target.value })} style={input}>
            {EFFORTS.map(([k, l, hint]) => <option key={k} value={k}>{l} - {hint}</option>)}
          </select>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div><span style={lbl}>Max turns</span><input type="number" min={5} max={400} value={f.max_turns} onChange={e => setF({ ...f, max_turns: e.target.value })} onBlur={() => Number(f.max_turns) !== it.max_turns && save({ max_turns: Number(f.max_turns) })} style={input} /></div>
            <div><span style={lbl}>$ cap / run</span><input type="number" min={0.5} max={200} step={0.5} value={f.max_budget_usd} onChange={e => setF({ ...f, max_budget_usd: e.target.value })} onBlur={() => Number(f.max_budget_usd) !== Number(it.max_budget_usd) && save({ max_budget_usd: Number(f.max_budget_usd) })} style={input} /></div>
          </div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 6, lineHeight: 1.45 }}>
            {modelLabel(f.model)}: ${price.in} in / ${price.out} out per million tokens. Higher effort thinks longer and spends more. The run stops at the $ cap.
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ narrow, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 80, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: narrow ? "100%" : "min(980px, 94vw)", height: "100%", overflowY: "auto", background: C.bg, borderLeft: "1px solid " + C.border, padding: narrow ? "14px 14px 90px" : "18px 22px 40px", boxSizing: "border-box", color: C.text }}>
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── usage
const LIMIT_KINDS = [["requests", "Requests / min"], ["input-tokens", "Input tokens / min"], ["output-tokens", "Output tokens / min"], ["tokens", "Tokens / min"]];
function Usage({ boot, narrow }) {
  const [days, setDays] = useState(30);
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { setD(null); api("usage", { days }).then(setD).catch(e => setErr(e.message)); }, [days]);
  if (err) return <div style={{ color: C.red }}>{err}</div>;
  if (!d) return <div style={{ color: C.mut }}>Loading usage…</div>;
  const s = d.summary || {}, p = s.period || {}, m = s.month || {};
  const budget = Number(d.budget || 0), pct = budget ? Math.min(100, (Number(m.cost) / budget) * 100) : 0;
  const cacheIn = Number(p.input) + Number(p.cache_read) + Number(p.cache_write);
  const hit = cacheIn ? Math.round((Number(p.cache_read) / cacheIn) * 100) : 0;
  const maxDay = Math.max(0.0001, ...(s.days || []).map(x => Number(x.cost)));
  const box = { background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 14 };
  const stat = (k, v, sub) => <div style={box}><div style={{ fontSize: 11, color: C.mut, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4 }}>{k}</div><div style={{ fontSize: 24, fontWeight: 900, marginTop: 4 }}>{v}</div>{sub && <div style={{ fontSize: 12, color: C.mut, marginTop: 2 }}>{sub}</div>}</div>;
  const limits = d.limits?.headers || {};
  const lim = (k) => { const L = Number(limits[`anthropic-ratelimit-${k}-limit`]), R = Number(limits[`anthropic-ratelimit-${k}-remaining`]); return L ? { L, R, reset: limits[`anthropic-ratelimit-${k}-reset`] } : null; };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {[7, 30, 90].map(n => <button key={n} onClick={() => setDays(n)} style={{ ...btn("ghost", true), borderColor: days === n ? C.gold : C.border, color: days === n ? C.gold : C.text }}>{n} days</button>)}
        <span style={{ fontSize: 12, color: C.dim }}>HQ's own Claude calls and agent runs, priced at list rates.</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr 1fr" : "repeat(4, 1fr)", gap: 10 }}>
        <div style={box}>
          <div style={{ fontSize: 11, color: C.mut, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4 }}>This month</div>
          <div style={{ fontSize: 24, fontWeight: 900, marginTop: 4 }}>{money(m.cost)}</div>
          {budget > 0 && <><div style={{ height: 6, background: C.border, borderRadius: 3, marginTop: 6, overflow: "hidden" }}><div style={{ width: pct + "%", height: "100%", background: pct > 90 ? C.red : pct > 70 ? C.amber : C.grn }} /></div><div style={{ fontSize: 12, color: C.mut, marginTop: 4 }}>of {money(budget, 0)} budget · agents {money(m.agent_cost)}</div></>}
        </div>
        {stat(`Last ${days} days`, money(p.cost), `${num(p.calls)} calls${p.errors ? ` · ${p.errors} failed` : ""}`)}
        {stat("Tokens", tok(Number(p.input) + Number(p.output) + Number(p.cache_read) + Number(p.cache_write)), `${tok(p.input)} in · ${tok(p.output)} out`)}
        {stat("Cache hits", hit + "%", `${tok(p.cache_read)} tokens read from cache`)}
      </div>

      <div style={box}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Spend by day <span style={{ color: C.mut, fontWeight: 400, fontSize: 12 }}>· <span style={{ color: C.gold }}>■</span> HQ features <span style={{ color: C.blue }}>■</span> agents</span></div>
        {(s.days || []).length ? (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 120 }}>
            {s.days.map(x => (
              <div key={x.day} title={`${x.day}: ${money(x.cost)} · ${num(x.calls)} calls`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%", minWidth: 4 }}>
                <div style={{ height: (Number(x.agent || 0) / maxDay) * 100 + "%", background: C.blue, borderRadius: "2px 2px 0 0" }} />
                <div style={{ height: (Number(x.hq || 0) / maxDay) * 100 + "%", background: C.gold }} />
              </div>
            ))}
          </div>
        ) : <div style={{ color: C.dim, fontSize: 13 }}>No Claude calls logged yet - logging started Oct 28 2026.</div>}
      </div>

      <div style={{ display: narrow ? "block" : "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Table title="By feature" rows={s.features || []} cols={[["feature", "Feature", r => <>{r.feature}{r.source === "agent" ? " 🤖" : ""}</>], ["calls", "Calls", r => num(r.calls)], ["tokens", "Tokens", r => tok(Number(r.input) + Number(r.output) + Number(r.cache_read) + Number(r.cache_write))], ["cost", "Cost", r => money(r.cost)]]} />
        <Table title="By model" rows={s.models || []} cols={[["model", "Model", r => modelLabel(r.model)], ["calls", "Calls", r => num(r.calls)], ["tokens", "Tokens", r => `${tok(r.input)} / ${tok(r.output)}`], ["cost", "Cost", r => money(r.cost)]]} />
      </div>

      <Table title="Agent runs" rows={d.runs || []} empty="No agent runs yet." cols={[["title", "Card", r => <>{itemKey(r.item_id)} {r.title}</>], ["kind", "Run", r => r.kind], ["status", "Status", r => <span style={{ color: RUN_COLOR[r.status] }}>{RUN_LABEL[r.status]}</span>], ["model", "Model", r => `${modelLabel(r.model)} · ${r.effort || ""}`], ["turns", "Turns", r => r.num_turns ?? ""], ["cost", "Cost", r => r.cost_usd != null ? money(r.cost_usd) : ""]]} />

      <div style={box}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Rate limits <span style={{ color: C.mut, fontWeight: 400, fontSize: 12 }}>{d.limits?.at ? `· from HQ's last call, ${ago(d.limits.at)}${d.limits.model ? "" : ""}` : ""}</span></div>
        {LIMIT_KINDS.map(([k, l]) => { const x = lim(k); return x ? (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "150px 1fr 140px", gap: 10, alignItems: "center", fontSize: 12, padding: "4px 0" }}>
            <span style={{ color: C.mut }}>{l}</span>
            <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: "hidden" }}><div style={{ width: Math.max(0, Math.min(100, (x.R / x.L) * 100)) + "%", height: "100%", background: x.R / x.L < 0.2 ? C.red : C.grn }} /></div>
            <span>{num(x.R)} of {num(x.L)} left</span>
          </div>
        ) : null; })}
        {!Object.keys(limits).length && <div style={{ fontSize: 12, color: C.dim }}>Shows up after HQ's next Claude call.</div>}
      </div>

      <div style={box}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Whole Anthropic account (this month)</div>
        {d.org?.error ? <div style={{ color: C.red, fontSize: 12 }}>{d.org.error}</div>
          : d.org ? (<>
            <div style={{ fontSize: 22, fontWeight: 900 }}>{money(d.org.cost)} <span style={{ fontSize: 13, color: C.mut, fontWeight: 400 }}>· {tok(d.org.tokens)} tokens - everything on the API key's organization, not just HQ</span></div>
            <div style={{ fontSize: 12, color: C.mut, marginTop: 4 }}>{(d.org.by_model || []).slice(0, 6).map(x => `${x.model}: ${money(x.cost)}`).join(" · ")}</div>
          </>) : <div style={{ fontSize: 12, color: C.mut, lineHeight: 1.5 }}>Add an Anthropic Admin API key in Settings to see the whole account's spend here (including anything outside HQ). Your Claude app plan (claude.ai / Claude Code) limits aren't available to HQ - see <a href="https://claude.ai/settings/usage" target="_blank" rel="noreferrer" style={{ color: C.blue }}>claude.ai → Settings → Usage</a>.</div>}
      </div>
    </div>
  );
}

function Table({ title, rows, cols, empty = "Nothing yet." }) {
  return (
    <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 14, overflowX: "auto" }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>{title}</div>
      {rows.length ? (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr>{cols.map(([k, l]) => <th key={k} style={{ textAlign: k === "cost" || k === "calls" || k === "tokens" || k === "turns" ? "right" : "left", color: C.mut, fontWeight: 700, padding: "4px 6px", borderBottom: "1px solid " + C.border }}>{l}</th>)}</tr></thead>
          <tbody>{rows.slice(0, 40).map((r, i) => <tr key={i}>{cols.map(([k, , f]) => <td key={k} style={{ padding: "5px 6px", borderBottom: "1px solid #1f1f1f", textAlign: k === "cost" || k === "calls" || k === "tokens" || k === "turns" ? "right" : "left", whiteSpace: k === "title" || k === "feature" ? "normal" : "nowrap" }}>{f(r)}</td>)}</tr>)}</tbody>
        </table>
      ) : <div style={{ fontSize: 12, color: C.dim }}>{empty}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── settings
function Settings({ boot, onSaved }) {
  const s = boot.settings;
  const [f, setF] = useState({ budget_monthly: s.budget_monthly, model: s.model, effort: s.effort, max_turns: s.max_turns, max_budget_usd: s.max_budget_usd, notify: (s.notify || []).join(", ") });
  const [tokens, setTokens] = useState({});
  const [admin, setAdmin] = useState("");
  const [msg, setMsg] = useState(null);
  const [test, setTest] = useState(null);
  const box = { background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 16, marginBottom: 12 };
  const save = async (patch, ok = "Saved.") => { setMsg(null); try { await api("settings", { patch }); setMsg({ ok }); onSaved(); } catch (e) { setMsg({ err: e.message }); } };
  const runTest = () => { setTest("…"); api("test_github").then(d => setTest(d.repos)).catch(e => setTest([{ repo: "", note: e.message }])); };
  const tokenUrl = (owner) => `https://github.com/settings/personal-access-tokens/new?name=${encodeURIComponent("DSSC HQ agents (" + owner + ")")}&description=${encodeURIComponent("Lets HQ start the feature-agent workflow")}&target_name=${owner}&expires_in=366&actions=write`;
  return (
    <div style={{ maxWidth: 760 }}>
      {msg && <div style={{ fontSize: 13, marginBottom: 10, color: msg.err ? C.red : C.grn }}>{msg.err || msg.ok}</div>}
      <div style={box}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>GitHub - lets HQ start the agents</div>
        <div style={{ fontSize: 13, color: C.mut, margin: "6px 0 10px", lineHeight: 1.5 }}>
          One token per GitHub account. On the GitHub page: pick <b>Only select repositories</b> (or All), check <b>Actions: Read and write</b> (the link pre-fills it), then <b>Generate token</b> and paste it here. HQ keeps it on the server and only uses it to start the "Feature agent" workflow. The agents themselves don't need it.
        </div>
        {(boot.owners || []).map(o => (
          <div key={o} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "6px 0", borderTop: "1px solid " + C.border }}>
            <b style={{ minWidth: 150 }}>{o}</b>
            {(boot.github || []).includes(o) ? <span style={{ color: C.grn, fontSize: 12, fontWeight: 800 }}>✓ connected</span> : <a href={tokenUrl(o)} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: C.blue }}>Create a token for {o} ↗</a>}
            <input value={tokens[o] || ""} onChange={e => setTokens({ ...tokens, [o]: e.target.value })} placeholder={(boot.github || []).includes(o) ? "Paste a new token to replace it" : "github_pat_…"} style={{ ...input, flex: 1, minWidth: 200, fontSize: 13 }} />
            <button disabled={!String(tokens[o] || "").trim()} onClick={() => save({ github_token: { owner: o, token: tokens[o] } }, `Saved the ${o} token.`).then(() => setTokens({ ...tokens, [o]: "" }))} style={btn("primary", true)}>Save</button>
            {(boot.github || []).includes(o) && <button onClick={() => window.confirm(`Remove the ${o} token?`) && save({ github_token: { owner: o, token: "" } }, "Removed.")} style={btn("ghost", true)}>Remove</button>}
          </div>
        ))}
        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
          <button onClick={runTest} style={btn("ghost", true)}>Test connection</button>
          {Array.isArray(test) && <div style={{ fontSize: 12, lineHeight: 1.6 }}>{test.map(t => <div key={t.repo}><span style={{ color: t.ok ? C.grn : C.amber }}>{t.ok ? "✓" : "✗"}</span> {REPOS[t.repo]?.label || t.repo}: {t.note}</div>)}</div>}
          {test === "…" && <span style={{ fontSize: 12, color: C.mut }}>Checking…</span>}
        </div>
      </div>

      <div style={box}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>Budget and defaults</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
          <div><span style={lbl}>Monthly Claude budget ($)</span><input type="number" min={0} value={f.budget_monthly} onChange={e => setF({ ...f, budget_monthly: e.target.value })} style={input} /><div style={{ fontSize: 11, color: C.dim, marginTop: 3 }}>Agents won't start once the month passes it.</div></div>
          <div><span style={lbl}>Default model</span><select value={f.model} onChange={e => setF({ ...f, model: e.target.value })} style={input}>{MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></div>
          <div><span style={lbl}>Default effort</span><select value={f.effort} onChange={e => setF({ ...f, effort: e.target.value })} style={input}>{EFFORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><span style={lbl}>Default max turns</span><input type="number" value={f.max_turns} onChange={e => setF({ ...f, max_turns: e.target.value })} style={input} /></div>
          <div><span style={lbl}>Default $ cap per run</span><input type="number" step={0.5} value={f.max_budget_usd} onChange={e => setF({ ...f, max_budget_usd: e.target.value })} style={input} /></div>
        </div>
        <span style={lbl}>Email me about new requests</span>
        <input value={f.notify} onChange={e => setF({ ...f, notify: e.target.value })} placeholder="drew@…, kristen@…" style={input} />
        <button onClick={() => save({ ...f })} style={{ ...btn("primary"), marginTop: 12 }}>Save</button>
      </div>

      <div style={box}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>Anthropic Admin API key <span style={{ fontSize: 12, color: C.mut, fontWeight: 400 }}>(optional)</span></div>
        <div style={{ fontSize: 13, color: C.mut, margin: "6px 0 10px", lineHeight: 1.5 }}>
          Usage already shows everything HQ spends. An Admin key (Claude Console → Settings → Admin keys, starts with <code>sk-ant-admin</code>) adds the whole account's month, including use outside HQ. {boot.admin_key ? <b style={{ color: C.grn }}>✓ connected</b> : null}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={admin} onChange={e => setAdmin(e.target.value)} placeholder="sk-ant-admin…" style={{ ...input, fontSize: 13 }} />
          <button disabled={!admin.trim()} onClick={() => save({ admin_key: admin }, "Saved.").then(() => setAdmin(""))} style={btn("primary", true)}>Save</button>
          {boot.admin_key && <button onClick={() => save({ admin_key: "" }, "Removed.")} style={btn("ghost", true)}>Remove</button>}
        </div>
      </div>
    </div>
  );
}
