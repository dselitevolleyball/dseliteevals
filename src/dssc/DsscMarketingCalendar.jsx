// DSSC Marketing → Calendar. Everything the machine has planned, drafted,
// approved and sent, on a calendar: what goes out each day, what kind (post,
// story, email, text), what it's for (the line: volleyball, Camp Elevate…),
// and where it stands. Click anything to open it — the full graphic, caption
// or email, editable — and approve it there; or approve a whole week, or a
// selection, in one go. The cron keeps the coming weeks drafted (Settings →
// Automation), so Monday is "look, tweak, approve all".
//
// Two views: Month (the grid) and List (every item of the visible weeks with
// its picture and copy, for reading the week top to bottom). Phones get List.

import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Tag } from "./DsscHub.jsx";
import {
  mktApi, isMissingTable, MIGRATION_MSG, lineMeta, lineLabel, LineChip, ANGLES, STATUS_META, CHANNEL_META, KIND_LABEL, kindOf,
  mondayOf, addDays, fmtDate, timeOf, dayOf, approveItem, readyIssue, chipStyle, Msg, Panel, LINES, GraphicPreview, specOf, hasGraphic,
} from "./DsscMarketingKit.jsx";
import { ItemCard, PhotoPicker } from "./DsscMarketingApprove.jsx";

const firstOfMonth = (iso) => iso.slice(0, 8) + "01";
const monthLabel = (iso) => new Date(iso + "T12:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" });
const addMonths = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(1); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 8) + "01"; };
const todayIso = () => new Date().toLocaleDateString("en-CA");
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const titleOf = (it) => (it.channel === "email" ? it.email_subject : it.graphic?.headline) || it.headline || it.program?.name || lineLabel(it.line);
const thumbOf = (it) => it.asset_url || it.graphic?.custom_url || it.graphic?.photo_url || null;
const STATUS_ICON = { draft: "○", approved: "✓", publishing: "…", published: "✓✓", failed: "!", rejected: "✕" };

export default function MarketingCalendar({ narrow, status, onOpenWeek, onChanged }) {
  const [month, setMonth] = useState(() => firstOfMonth(todayIso()));
  const [view, setView] = useState(() => (narrow ? "list" : "month"));
  const [items, setItems] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [picker, setPicker] = useState(null);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [chan, setChan] = useState("all");
  const [only, setOnly] = useState("all");      // all | todo
  useEffect(() => { if (narrow) setView("list"); }, [narrow]);

  // The weeks on screen: Monday on/before the 1st through the Sunday on/after month end.
  const weeks = useMemo(() => {
    const start = mondayOf(month), end = addDays(addMonths(month, 1), -1);
    const out = []; for (let w = start; w <= end; w = addDays(w, 7)) out.push(w);
    return out;
  }, [month]);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("mkt_items").select("*").gte("week_of", weeks[0]).lte("week_of", weeks[weeks.length - 1]).order("scheduled_at", { ascending: true, nullsFirst: false }).order("id");
    if (error) { setMsg({ err: isMissingTable(error) ? MIGRATION_MSG : error.message }); setItems([]); return; }
    setItems(data || []);
  }, [weeks]);
  useEffect(() => { setItems(null); load(); }, [load]);

  const replace = (it) => setItems(xs => (xs || []).map(x => x.id === it.id ? { ...x, ...it } : x));
  const patchItem = async (it, patch) => {
    replace({ id: it.id, ...patch });
    try { const d = await mktApi("update", { id: it.id, patch }); if (d?.item) replace(d.item); }
    catch (e) { setMsg({ err: "Couldn't save: " + e.message }); load(); }
  };

  const shown = useMemo(() => (items || []).filter(it => it.status !== "rejected" && (chan === "all" || it.channel === chan) && (only === "all" || it.status === "draft")), [items, chan, only]);
  const byDay = useMemo(() => { const m = new Map(); for (const it of shown) { const d = dayOf(it.scheduled_at) || it.week_of; if (!m.has(d)) m.set(d, []); m.get(d).push(it); } return m; }, [shown]);
  const byWeek = useMemo(() => { const m = new Map(weeks.map(w => [w, []])); for (const it of items || []) if (m.has(it.week_of) && it.status !== "rejected") m.get(it.week_of).push(it); for (const l of m.values()) l.sort((a, b) => String(a.scheduled_at || "").localeCompare(String(b.scheduled_at || ""))); return m; }, [items, weeks]);
  const readyIn = (list) => list.filter(it => !readyIssue(it));

  // Approve a set of drafts: each graphic is drawn at full size and uploaded first (same as one-by-one).
  const approveMany = async (list, label) => {
    const ready = readyIn(list);
    if (!ready.length) return;
    if (!window.confirm(`Approve ${ready.length} ${label}? Each one goes out at its scheduled time.`)) return;
    setBusy("approve"); setMsg(null);
    const errs = [];
    for (let i = 0; i < ready.length; i++) {
      const it = ready[i];
      setProgress({ done: i, total: ready.length, label: `${CHANNEL_META[it.channel]?.[0] || it.channel} · ${lineLabel(it.line)} · ${fmtDate(dayOf(it.scheduled_at) || it.week_of, { weekday: "short", month: "short", day: "numeric" })}`, step: "" });
      try { await approveItem(it, (step) => setProgress(p => ({ ...p, step }))); replace({ id: it.id, status: "approved" }); }
      catch (e) { errs.push(`${lineLabel(it.line)} ${it.channel}: ${e.message}`); }
    }
    setProgress(null); setBusy(""); setSel(new Set());
    setMsg(errs.length ? { err: `Approved ${ready.length - errs.length} of ${ready.length}.\n` + errs.join("\n") } : { ok: `Approved ${ready.length}. They go out on schedule.` });
    await load(); onChanged?.();
  };
  const draftWeek = async (wk) => {
    setBusy("gen:" + wk); setMsg(null);
    try { const d = await mktApi("generate", { week_of: wk, replace_drafts: false }); setMsg({ ok: `${(d.items || []).length} drafts made for the week of ${fmtDate(wk)}.` }); await load(); onChanged?.(); }
    catch (e) { setMsg({ err: e.message }); }
    setBusy("");
  };
  const toggleSel = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const open = openId ? (items || []).find(x => x.id === openId) : null;
  const selItems = (items || []).filter(it => sel.has(it.id));
  const today = todayIso();
  const ahead = status?.settings?.plan_ahead;

  // ── pieces ──
  const chip = (it, big) => {
    const lm = lineMeta(it.line); const [sl, sc] = STATUS_META[it.status] || STATUS_META.draft;
    const picked = sel.has(it.id);
    return (
      <div key={it.id} onClick={() => selecting ? toggleSel(it.id) : setOpenId(it.id)} title={`${KIND_LABEL[kindOf(it)] || it.channel} · ${lm.label} · ${sl}\n${titleOf(it)}`}
        style={{ display: "flex", gap: 5, alignItems: "center", cursor: "pointer", background: picked ? DS.limeSoft : it.status === "draft" ? "transparent" : "rgba(255,255,255,0.04)", border: "1px solid " + (picked ? DS.lime : DS.line), borderLeft: "4px solid " + lm.color, borderRadius: 6, padding: big ? "6px 8px" : "3px 5px", marginTop: 4, fontSize: big ? 13 : 11, lineHeight: 1.25, minWidth: 0 }}>
        {selecting && <input type="checkbox" readOnly checked={picked} style={{ margin: 0, accentColor: DS.lime }} />}
        <span style={{ flex: "none" }}>{CHANNEL_META[it.channel]?.[1]}</span>
        <span style={{ color: DS.mut, flex: "none" }}>{timeOf(it.scheduled_at)}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{titleOf(it)}</span>
        <span style={{ color: sc, fontWeight: 800, flex: "none" }} title={sl}>{STATUS_ICON[it.status] || ""}</span>
      </div>
    );
  };
  const weekBar = (wk) => {
    const list = byWeek.get(wk) || [];
    const c = { draft: 0, approved: 0, published: 0, failed: 0 }; for (const it of list) c[it.status] = (c[it.status] || 0) + 1;
    const ready = readyIn(list);
    const future = addDays(wk, 6) >= today;
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
        <b style={{ fontSize: 13 }}>Week of {fmtDate(wk)}</b>
        {list.length ? <>
          {c.draft > 0 && <Tag color={DS.mut}>{c.draft} to approve</Tag>}
          {c.approved > 0 && <Tag color={DS.lime}>{c.approved} approved</Tag>}
          {c.published > 0 && <Tag color="#7FD1C3">{c.published} sent</Tag>}
          {c.failed > 0 && <Tag color={DS.orange} fill>{c.failed} failed</Tag>}
        </> : <span style={{ color: DS.dim }}>{future ? "nothing drafted yet" : "nothing"}</span>}
        <span style={{ flex: 1 }} />
        {ready.length > 0 && <Btn small kind="primary" disabled={!!busy} onClick={() => approveMany(list, `drafts for the week of ${fmtDate(wk)}`)}>✓ Approve week ({ready.length})</Btn>}
        {!list.length && future && <Btn small kind="ghost" disabled={!!busy} onClick={() => draftWeek(wk)}>{busy === "gen:" + wk ? "Writing…" : "Draft this week"}</Btn>}
        {list.length > 0 && <Btn small kind="quiet" onClick={() => onOpenWeek?.(wk)}>Review week →</Btn>}
      </div>
    );
  };

  return (
    <div>
      {/* Month nav + views */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <Btn kind="ghost" onClick={() => setMonth(addMonths(month, -1))} style={{ minHeight: 40 }} aria-label="Previous month">←</Btn>
        <div style={{ fontSize: 18, fontWeight: 800, minWidth: 150, textAlign: "center" }}>{monthLabel(month)}</div>
        <Btn kind="ghost" onClick={() => setMonth(addMonths(month, 1))} style={{ minHeight: 40 }} aria-label="Next month">→</Btn>
        {month !== firstOfMonth(today) && <Btn kind="link" small onClick={() => setMonth(firstOfMonth(today))}>Today</Btn>}
        <span style={{ flex: 1 }} />
        {!narrow && [["month", "Month"], ["list", "List"]].map(([k, l]) => <button key={k} onClick={() => setView(k)} style={chipStyle(view === k, DS.lime)}>{l}</button>)}
        <button onClick={() => { setSelecting(s => !s); setSel(new Set()); }} style={chipStyle(selecting, DS.orange, narrow)}>{selecting ? "Done selecting" : "Select"}</button>
      </div>

      {/* Filters + legend */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        {[["all", "Everything"], ["social", "📱 Posts"], ["email", "✉️ Emails"], ["sms", "💬 Texts"]].map(([k, l]) => <button key={k} onClick={() => setChan(k)} style={chipStyle(chan === k, DS.lime, narrow)}>{l}</button>)}
        <button onClick={() => setOnly(o => o === "todo" ? "all" : "todo")} style={chipStyle(only === "todo", DS.orange, narrow)}>To approve only</button>
        <span style={{ flex: 1 }} />
        {!narrow && LINES.map(l => <span key={l.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: DS.mut }}><span style={{ width: 10, height: 10, borderRadius: 2, background: lineMeta(l.key).color }} />{lineMeta(l.key).label}</span>)}
      </div>
      {!narrow && <div style={{ fontSize: 11, color: DS.dim, marginBottom: 10 }}>○ draft · ✓ approved · ✓✓ sent · ! failed — the colour bar is what it's promoting. {ahead ? `The machine keeps ${ahead} week${ahead === 1 ? "" : "s"} ahead drafted (Settings).` : ""}</div>}

      {(selecting && sel.size > 0) && (
        <Panel style={{ position: "sticky", top: 0, zIndex: 5, marginBottom: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <b>{sel.size} selected</b><span style={{ fontSize: 12, color: DS.mut }}>{readyIn(selItems).length} ready to approve</span>
          <span style={{ flex: 1 }} />
          <Btn small kind="primary" disabled={!!busy || !readyIn(selItems).length} onClick={() => approveMany(selItems, "selected items")}>✓ Approve selected ({readyIn(selItems).length})</Btn>
          <Btn small kind="quiet" onClick={() => setSel(new Set())}>Clear</Btn>
        </Panel>
      )}
      {progress && (
        <Panel style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Approving {progress.done + 1} of {progress.total} — {progress.label}{progress.step ? " · " + progress.step : ""}</div>
          <div style={{ height: 6, background: DS.panel2, borderRadius: 3, marginTop: 6, overflow: "hidden" }}><div style={{ width: `${(progress.done / progress.total) * 100}%`, height: "100%", background: DS.lime, transition: "width .3s" }} /></div>
        </Panel>
      )}
      <Msg msg={msg} style={{ marginBottom: 10 }} />

      {items == null ? <div style={{ color: DS.mut, padding: 20 }}>Loading…</div>
        : view === "month" ? (
          <div style={{ border: "1px solid " + DS.line, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", background: DS.panel2 }}>
              {DOW.map(d => <div key={d} style={{ padding: "6px 8px", fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: DS.mut }}>{d}</div>)}
            </div>
            {weeks.map(wk => (
              <div key={wk} style={{ borderTop: "1px solid " + DS.line }}>
                <div style={{ padding: "6px 8px", background: DS.panel }}>{weekBar(wk)}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
                  {Array.from({ length: 7 }, (_, i) => addDays(wk, i)).map(d => {
                    const inMonth = d.slice(0, 7) === month.slice(0, 7);
                    const list = byDay.get(d) || [];
                    return (
                      <div key={d} style={{ minHeight: 96, padding: 6, borderLeft: "1px solid " + DS.line, background: d === today ? "rgba(178,208,73,0.07)" : "transparent", opacity: inMonth ? 1 : 0.5, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: d === today ? DS.lime : DS.mut }}>{+d.slice(8)}</div>
                        {list.map(it => chip(it, false))}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          weeks.map(wk => {
            const list = (byWeek.get(wk) || []).filter(it => shown.includes(it));
            if (addDays(wk, 6) < firstOfMonth(month) || wk > addDays(addMonths(month, 1), -1)) return null;
            return (
              <Panel key={wk} style={{ marginBottom: 12 }}>
                {weekBar(wk)}
                {list.map(it => <ListRow key={it.id} it={it} narrow={narrow} selecting={selecting} picked={sel.has(it.id)} onToggle={() => toggleSel(it.id)} onOpen={() => setOpenId(it.id)} />)}
              </Panel>
            );
          })
        )}

      {/* Click-in: the full editor */}
      {open && (
        <div onClick={() => setOpenId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 70, display: "flex", justifyContent: "center", alignItems: narrow ? "stretch" : "flex-start", padding: narrow ? 0 : "4vh 16px", overflowY: "auto" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 980, background: DS.bg, borderRadius: narrow ? 0 : 14, border: narrow ? "none" : "1px solid " + DS.lineStrong, padding: narrow ? 10 : 16, boxSizing: "border-box" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 13, color: DS.mut, flex: 1 }}>{fmtDate(dayOf(open.scheduled_at) || open.week_of, { weekday: "long", month: "long", day: "numeric" })}</div>
              <Btn kind="ghost" small onClick={() => { const list = shown; const i = list.findIndex(x => x.id === open.id); if (i > 0) setOpenId(list[i - 1].id); }}>← Prev</Btn>
              <Btn kind="ghost" small onClick={() => { const list = shown; const i = list.findIndex(x => x.id === open.id); if (i >= 0 && i < list.length - 1) setOpenId(list[i + 1].id); }}>Next →</Btn>
              <Btn kind="ghost" small onClick={() => setOpenId(null)}>Close</Btn>
            </div>
            <ItemCard item={open} week={open.week_of} narrow={narrow} onPatch={patchItem} onReplace={replace} reload={load} onChanged={onChanged} onPickPhoto={() => setPicker(open)} />
          </div>
        </div>
      )}
      {picker && <PhotoPicker item={picker} narrow={narrow} onClose={() => setPicker(null)} onPick={(p) => { const it = picker; setPicker(null); patchItem(it, { graphic: { ...(it.graphic || {}), photo_url: p?.url || null, photo_key: p?.key || null } }); }} />}
    </div>
  );
}

// One item in the List view: the picture, what it is, the copy — readable at a glance.
function ListRow({ it, narrow, selecting, picked, onToggle, onOpen }) {
  const lm = lineMeta(it.line); const [sl, sc] = STATUS_META[it.status] || STATUS_META.draft;
  const thumb = thumbOf(it);
  const text = it.channel === "email" ? [it.email_preheader, it.body].filter(Boolean).join(" — ") : it.body;
  return (
    <div onClick={selecting ? onToggle : onOpen} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderTop: "1px solid " + DS.line, cursor: "pointer", background: picked ? DS.limeSoft : "transparent" }}>
      {selecting && <input type="checkbox" readOnly checked={picked} style={{ marginTop: 4, width: 18, height: 18, accentColor: DS.lime }} />}
      <div style={{ width: narrow ? 64 : 84, flex: "none", aspectRatio: it.channel === "email" ? "1.9 / 1" : "4 / 5", background: DS.panel2, borderRadius: 6, overflow: "hidden", borderLeft: "4px solid " + lm.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
        {it.asset_url ? <img src={it.asset_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : hasGraphic(it) ? <GraphicPreview spec={specOf(it)} style={{ width: "100%" }} />
          : thumb ? <img src={thumb} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : CHANNEL_META[it.channel]?.[1]}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
          <b>{fmtDate(dayOf(it.scheduled_at) || it.week_of, { weekday: "short", month: "short", day: "numeric" })} {timeOf(it.scheduled_at)}</b>
          <span>{CHANNEL_META[it.channel]?.[1]} {KIND_LABEL[kindOf(it)] || CHANNEL_META[it.channel]?.[0]}</span>
          {it.channel === "social" && (it.platforms || []).length > 0 && <span style={{ color: DS.mut }}>{(it.platforms || []).map(p => ({ facebook: "FB", instagram: "IG", instagram_story: "IG story", facebook_story: "FB story" }[p] || p)).join(" + ")}</span>}
          <LineChip line={it.line} />
          {it.angle && <span style={{ color: DS.dim }}>{ANGLES[it.angle] || it.angle}</span>}
          <span style={{ flex: 1 }} />
          <Tag color={sc} fill={it.status === "approved" || it.status === "failed"}>{sl}</Tag>
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4, lineHeight: 1.25 }}>{titleOf(it)}</div>
        {text && <div style={{ fontSize: 13, color: DS.mut, marginTop: 3, lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", whiteSpace: "pre-line" }}>{text}</div>}
        {it.status === "draft" && readyIssue(it) && <div style={{ fontSize: 11, color: DS.orange, marginTop: 3 }}>Needs: {readyIssue(it)}</div>}
      </div>
    </div>
  );
}
