// DSSC Marketing → Calendar. Everything the machine has planned, drafted,
// approved and sent, on a calendar: what goes out each day, what kind (post,
// story, email, text), what it's for (the line: volleyball, Camp Elevate…),
// and where it stands. Click anything to open it — the full graphic, caption
// or email, editable — and approve it there; or approve a whole week, or a
// selection, in one go. The cron keeps the coming weeks drafted (Settings →
// Automation), so Monday is "look, tweak, approve all".
//
// Three views: Month (the grid), Week (one week, big cards, each with its
// time to change in place) and List (every item with its picture and copy,
// for reading the week top to bottom). Phones get List. In Month and Week,
// drag an item to another day to move it (it keeps its time), and the + on a
// day turns an idea into a draft for that day (Claude writes it; it lands on
// the calendar like everything else).

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Tag, Grow, inputStyle } from "./DsscHub.jsx";
import {
  mktApi, isMissingTable, MIGRATION_MSG, lineMeta, lineLabel, LineChip, ANGLES, STATUS_META, CHANNEL_META, KIND_LABEL, kindOf,
  mondayOf, addDays, fmtDate, timeOf, dayOf, approveItem, readyIssue, chipStyle, Msg, Panel, LINES, GraphicPreview, specOf, hasGraphic, URGENT, URGENT_SOFT, isUrgent, urgentLabel, useNow,
} from "./DsscMarketingKit.jsx";
import { ItemCard, PhotoPicker } from "./DsscMarketingApprove.jsx";

const firstOfMonth = (iso) => iso.slice(0, 8) + "01";
const monthLabel = (iso) => new Date(iso + "T12:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" });
const addMonths = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(1); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 8) + "01"; };
const todayIso = () => new Date().toLocaleDateString("en-CA");
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const titleOf = (it) => (it.channel === "email" ? it.email_subject : it.graphic?.headline) || it.headline || it.program?.name || lineLabel(it.line);
const thumbOf = (it) => it.asset_url || it.graphic?.custom_url || it.graphic?.photo_url || null;
const canMove = (it) => !["publishing", "published"].includes(it.status);
const KINDS_ADD = [["post", "📱 Post", "social"], ["story", "📱 Story", "social"], ["email", "✉️ Email", "email"], ["text", "💬 Text", "sms"]];
const DEFAULT_TIME = { post: "18:30", story: "18:30", email: "07:30", text: "17:30" };
const STATUS_ICON = { draft: "○", approved: "✓", publishing: "…", published: "✓✓", failed: "!", rejected: "✕" };

export default function MarketingCalendar({ narrow, status, focus, onOpenWeek, onChanged }) {
  const [month, setMonth] = useState(() => firstOfMonth(todayIso()));
  const [view, setView] = useState(() => (narrow ? "list" : "month"));
  const [items, setItems] = useState(null);
  const now = useNow();
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [picker, setPicker] = useState(null);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [chan, setChan] = useState("all");
  const [only, setOnly] = useState("all");      // all | todo
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayIso()));
  const [addFor, setAddFor] = useState(null);   // the day the "+" was pressed on
  const [dropDay, setDropDay] = useState(null);
  const dragId = useRef(null);
  useEffect(() => { if (narrow) setView("list"); }, [narrow]);
  // Opened from somewhere else on one item ("Show on calendar"): go to its week and open it.
  useEffect(() => {
    if (!focus?.day) return;
    setMonth(firstOfMonth(focus.day)); setWeekStart(mondayOf(focus.day));
    if (!narrow) setView("week");
    setOpenId(focus.id || null);
  }, [focus?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // The weeks on screen: Monday on/before the 1st through the Sunday on/after
  // month end — or the one week in Week view.
  const weeks = useMemo(() => {
    if (view === "week") return [weekStart];
    const start = mondayOf(month), end = addDays(addMonths(month, 1), -1);
    const out = []; for (let w = start; w <= end; w = addDays(w, 7)) out.push(w);
    return out;
  }, [month, view, weekStart]);

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
  // Move to another day (keeps its time) or change the time; an approved item stays approved.
  const moveTo = (it, day, hhmm) => {
    const t = hhmm || timeOf(it.scheduled_at) || DEFAULT_TIME[kindOf(it) === "text" ? "text" : it.channel === "email" ? "email" : "post"];
    const at = new Date(`${day}T${t}:00`).toISOString();
    if (at === it.scheduled_at) return;
    patchItem(it, { scheduled_at: at });
  };
  const onDrop = (day) => (e) => {
    e.preventDefault(); setDropDay(null);
    const id = Number(e.dataTransfer.getData("text/plain") || dragId.current); dragId.current = null;
    const it = (items || []).find(x => x.id === id);
    if (it && canMove(it) && (dayOf(it.scheduled_at) || it.week_of) !== day) moveTo(it, day);
  };
  const dropProps = (day) => ({
    onDragOver: (e) => { if (dragId.current != null) { e.preventDefault(); if (dropDay !== day) setDropDay(day); } },
    onDragLeave: () => setDropDay(d => d === day ? null : d),
    onDrop: onDrop(day),
  });
  const plusBtn = (day) => day >= today && (
    <button onClick={(e) => { e.stopPropagation(); setAddFor(day); }} title="Add an idea for this day" aria-label={"Add something on " + day}
      style={{ marginLeft: "auto", width: 22, height: 22, lineHeight: "18px", borderRadius: 999, border: "1px solid " + DS.lineStrong, background: "transparent", color: DS.lime, fontWeight: 900, fontSize: 15, cursor: "pointer", padding: 0 }}>+</button>
  );
  const toggleSel = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const open = openId ? (items || []).find(x => x.id === openId) : null;
  const selItems = (items || []).filter(it => sel.has(it.id));
  const today = todayIso();
  const ahead = status?.settings?.plan_ahead;

  // ── pieces ──
  const chip = (it, big) => {
    const lm = lineMeta(it.line); const [sl, sc] = STATUS_META[it.status] || STATUS_META.draft;
    const picked = sel.has(it.id);
    const urgent = isUrgent(it, now);
    // Readable in the grid: what it is and when on top, the whole title (wrapping), then the start of the copy.
    const isEmail = it.channel === "email";
    const copy = String((isEmail ? it.email_preheader || it.body : it.body) || "").replace(/\s+/g, " ").trim();
    const clamp = (n) => ({ display: "-webkit-box", WebkitLineClamp: n, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" });
    return (
      <div key={it.id} onClick={() => selecting ? toggleSel(it.id) : setOpenId(it.id)} title={`${KIND_LABEL[kindOf(it)] || it.channel} · ${lm.label} · ${sl}${urgent ? " · needs approval — " + urgentLabel(it, now) : ""}\n${titleOf(it)}${canMove(it) ? "\nDrag to another day to move it" : ""}`}
        draggable={!selecting && canMove(it)} onDragStart={(e) => { dragId.current = it.id; e.dataTransfer.setData("text/plain", String(it.id)); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { dragId.current = null; setDropDay(null); }}
        style={{ cursor: "pointer", background: picked ? DS.limeSoft : urgent ? URGENT_SOFT : isEmail ? "rgba(96,165,250,0.12)" : it.status === "draft" ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.05)", border: "1px solid " + (picked ? DS.lime : urgent ? URGENT : isEmail ? "rgba(96,165,250,0.45)" : DS.line), borderLeft: "4px solid " + lm.color, borderRadius: 6, padding: big ? "7px 9px" : "5px 6px", marginTop: 5, fontSize: big ? 13 : 12, lineHeight: 1.3, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11, color: DS.mut, minWidth: 0 }}>
          {selecting && <input type="checkbox" readOnly checked={picked} style={{ margin: 0, accentColor: DS.lime }} />}
          <span style={{ flex: "none" }}>{CHANNEL_META[it.channel]?.[1]}</span>
          <span style={{ fontWeight: 800, color: isEmail ? "#93C5FD" : DS.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{KIND_LABEL[kindOf(it)] || CHANNEL_META[it.channel]?.[0]}</span>
          {!(big && canMove(it)) && <span style={{ flex: "none" }}>{timeOf(it.scheduled_at)}</span>}
          <span style={{ flex: 1 }} />
          <span style={{ color: urgent ? URGENT : sc, fontWeight: 800, flex: "none" }} title={sl}>{urgent ? "!" : STATUS_ICON[it.status] || ""}</span>
        </div>
        {urgent && <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: URGENT, marginTop: 3 }}>Approve · {urgentLabel(it, now)}</div>}
        {big && canMove(it) && <input type="time" value={timeOf(it.scheduled_at)} onClick={e => e.stopPropagation()} onChange={e => e.target.value && moveTo(it, dayOf(it.scheduled_at) || it.week_of, e.target.value)} title="Change the time"
          style={{ ...inputStyle, width: "100%", maxWidth: 130, marginTop: 4, padding: "2px 6px", fontSize: 12, colorScheme: "dark" }} />}
        <div style={{ fontWeight: 700, marginTop: 3, color: DS.text, ...clamp(3) }}>{titleOf(it)}</div>
        {copy && <div style={{ fontSize: 11, color: DS.mut, marginTop: 2, ...clamp(2) }}>{copy}</div>}
      </div>
    );
  };
  const weekBar = (wk) => {
    const list = byWeek.get(wk) || [];
    const c = { draft: 0, approved: 0, published: 0, failed: 0 }; for (const it of list) c[it.status] = (c[it.status] || 0) + 1;
    const ready = readyIn(list);
    const urgentN = list.filter(it => isUrgent(it, now)).length;
    const future = addDays(wk, 6) >= today;
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
        <b style={{ fontSize: 13 }}>Week of {fmtDate(wk)}</b>
        {list.length ? <>
          {urgentN > 0 && <Tag color={URGENT} fill>{urgentN} due within 24h</Tag>}
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
        <Btn kind="ghost" onClick={() => view === "week" ? setWeekStart(addDays(weekStart, -7)) : setMonth(addMonths(month, -1))} style={{ minHeight: 40 }} aria-label={view === "week" ? "Previous week" : "Previous month"}>←</Btn>
        <div style={{ fontSize: 18, fontWeight: 800, minWidth: 150, textAlign: "center" }}>{view === "week" ? `Week of ${fmtDate(weekStart)}` : monthLabel(month)}</div>
        <Btn kind="ghost" onClick={() => view === "week" ? setWeekStart(addDays(weekStart, 7)) : setMonth(addMonths(month, 1))} style={{ minHeight: 40 }} aria-label={view === "week" ? "Next week" : "Next month"}>→</Btn>
        {(view === "week" ? weekStart !== mondayOf(today) : month !== firstOfMonth(today)) && <Btn kind="link" small onClick={() => { setMonth(firstOfMonth(today)); setWeekStart(mondayOf(today)); }}>Today</Btn>}
        <span style={{ flex: 1 }} />
        {!narrow && [["month", "Month"], ["week", "Week"], ["list", "List"]].map(([k, l]) => <button key={k} onClick={() => setView(k)} style={chipStyle(view === k, DS.lime)}>{l}</button>)}
        <button onClick={() => { setSelecting(s => !s); setSel(new Set()); }} style={chipStyle(selecting, DS.orange, narrow)}>{selecting ? "Done selecting" : "Select"}</button>
      </div>

      {/* Filters + legend */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        {[["all", "Everything"], ["social", "📱 Posts"], ["email", "✉️ Emails"], ["sms", "💬 Texts"]].map(([k, l]) => <button key={k} onClick={() => setChan(k)} style={chipStyle(chan === k, DS.lime, narrow)}>{l}</button>)}
        <button onClick={() => setOnly(o => o === "todo" ? "all" : "todo")} style={chipStyle(only === "todo", DS.orange, narrow)}>To approve only</button>
        <span style={{ flex: 1 }} />
        {!narrow && LINES.map(l => <span key={l.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: DS.mut }}><span style={{ width: 10, height: 10, borderRadius: 2, background: lineMeta(l.key).color }} />{lineMeta(l.key).label}</span>)}
      </div>
      {!narrow && <div style={{ fontSize: 11, color: DS.dim, marginBottom: 10 }}>○ draft · <span style={{ color: URGENT, fontWeight: 800 }}>red: still needs approval and goes out within 24 hours</span> · ✓ approved · ✓✓ sent · ! failed — the colour bar is what it's promoting. {ahead ? `The machine keeps ${ahead} week${ahead === 1 ? "" : "s"} ahead drafted (Settings).` : ""}</div>}

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
                      <div key={d} {...dropProps(d)} style={{ minHeight: 96, padding: 6, borderLeft: "1px solid " + DS.line, background: dropDay === d ? "rgba(178,208,73,0.18)" : d === today ? "rgba(178,208,73,0.07)" : "transparent", outline: dropDay === d ? "2px dashed " + DS.lime : "none", outlineOffset: -3, opacity: inMonth ? 1 : 0.5, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", fontSize: 12, fontWeight: 800, color: d === today ? DS.lime : DS.mut }}>{+d.slice(8)}{plusBtn(d)}</div>
                        {list.map(it => chip(it, false))}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : view === "week" ? (
          <div style={{ border: "1px solid " + DS.line, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "8px 10px", background: DS.panel }}>{weekBar(weekStart)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
              {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d, i) => (
                <div key={d} {...dropProps(d)} style={{ minHeight: 420, padding: 8, borderLeft: i ? "1px solid " + DS.line : "none", background: dropDay === d ? "rgba(178,208,73,0.18)" : d === today ? "rgba(178,208,73,0.07)" : "transparent", outline: dropDay === d ? "2px dashed " + DS.lime : "none", outlineOffset: -3, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color: d === today ? DS.lime : DS.mut, textTransform: "uppercase", letterSpacing: "0.04em" }}>{DOW[i]} {+d.slice(8)}{plusBtn(d)}</div>
                  {(byDay.get(d) || []).map(it => chip(it, true))}
                </div>
              ))}
            </div>
          </div>
        ) : (
          weeks.map(wk => {
            const list = (byWeek.get(wk) || []).filter(it => shown.includes(it));
            if (addDays(wk, 6) < firstOfMonth(month) || wk > addDays(addMonths(month, 1), -1)) return null;
            return (
              <Panel key={wk} style={{ marginBottom: 12 }}>
                {weekBar(wk)}
                {list.map(it => <ListRow key={it.id} it={it} now={now} narrow={narrow} selecting={selecting} picked={sel.has(it.id)} onToggle={() => toggleSel(it.id)} onOpen={() => setOpenId(it.id)} />)}
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
      {addFor && <AddIdea day={addFor} narrow={narrow} onClose={() => setAddFor(null)} onMade={async (item) => { setAddFor(null); setMsg({ ok: `Added to ${fmtDate(addFor, { weekday: "long", month: "short", day: "numeric" })} — have a look.` }); await load(); onChanged?.(); if (item?.id) setOpenId(item.id); }} />}
      {picker && <PhotoPicker item={picker} narrow={narrow} onClose={() => setPicker(null)} onPick={(p) => { const it = picker; setPicker(null); patchItem(it, { graphic: { ...(it.graphic || {}), photo_url: p?.url || null, photo_key: p?.key || null } }); }} />}
    </div>
  );
}

// One item in the List view: the picture, what it is, the copy — readable at a glance.
function ListRow({ it, now, narrow, selecting, picked, onToggle, onOpen }) {
  const lm = lineMeta(it.line); const [sl, sc] = STATUS_META[it.status] || STATUS_META.draft;
  const urgent = isUrgent(it, now);
  const thumb = thumbOf(it);
  const text = it.channel === "email" ? [it.email_preheader, it.body].filter(Boolean).join(" — ") : it.body;
  return (
    <div onClick={selecting ? onToggle : onOpen} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderTop: "1px solid " + DS.line, cursor: "pointer", background: picked ? DS.limeSoft : urgent ? URGENT_SOFT : "transparent", boxShadow: urgent && !picked ? "inset 3px 0 0 " + URGENT : "none" }}>
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
          {urgent ? <Tag color={URGENT} fill>Needs approval · {urgentLabel(it, now)}</Tag> : <Tag color={sc} fill={it.status === "approved" || it.status === "failed"}>{sl}</Tag>}
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4, lineHeight: 1.25 }}>{titleOf(it)}</div>
        {text && <div style={{ fontSize: 13, color: DS.mut, marginTop: 3, lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", whiteSpace: "pre-line" }}>{text}</div>}
        {it.status === "draft" && readyIssue(it) && <div style={{ fontSize: 11, color: DS.orange, marginTop: 3 }}>Needs: {readyIssue(it)}</div>}
      </div>
    </div>
  );
}

// The "+" on a day: say the idea, pick what it is (post, story, email, text)
// and when; Claude writes it as a draft for that day using the club's
// programs and voice, with a graphic, ready to edit and approve.
function AddIdea({ day, narrow, onClose, onMade }) {
  const [idea, setIdea] = useState("");
  const [kind, setKind] = useState("post");
  const [line, setLine] = useState("");
  const [time, setTime] = useState(DEFAULT_TIME.post);
  const [d, setD] = useState(day);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pickKind = (k) => { setKind(k); setTime(DEFAULT_TIME[k]); };
  const make = async () => {
    const text = idea.trim(); if (text.length < 3) return;
    setBusy(true); setErr("");
    try {
      const [, , channel] = KINDS_ADD.find(x => x[0] === kind);
      const r = await mktApi("generate", { week_of: mondayOf(d), day: d, time, channel, format: kind === "story" ? "story" : undefined, line: line || undefined, instruction: text, theme: text, reason: "Added on the calendar" });
      onMade((r.items || [])[0]);
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <div onClick={busy ? undefined : onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 75, display: "flex", justifyContent: "center", alignItems: narrow ? "stretch" : "flex-start", padding: narrow ? 0 : "10vh 16px" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 560, background: DS.bg, border: narrow ? "none" : "1px solid " + DS.lineStrong, borderRadius: narrow ? 0 : 14, padding: 16, boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 18, fontWeight: 800, flex: 1 }}>Add to {fmtDate(d, { weekday: "long", month: "short", day: "numeric" })}</div>
          <Btn kind="ghost" small onClick={onClose} disabled={busy}>Close</Btn>
        </div>
        <div style={{ fontSize: 12, color: DS.mut, margin: "10px 0 6px" }}>What's the idea?</div>
        <Grow autoFocus value={idea} onChange={e => setIdea(e.target.value)} minRows={3} style={{ fontSize: narrow ? 16 : 14 }}
          placeholder={'e.g. "Hype the Coach Chang hitting pod — 3 spots left, show the girls blocking" or "Thanksgiving: Camp Elevate is almost full"'}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") make(); }} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          {KINDS_ADD.map(([k, l]) => <button key={k} onClick={() => pickKind(k)} style={chipStyle(kind === k, DS.lime, narrow)}>{l}</button>)}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <button onClick={() => setLine("")} style={chipStyle(!line, DS.mut, narrow)}>Focus: figure it out</button>
          {LINES.map(l => <button key={l.key} onClick={() => setLine(l.key)} style={chipStyle(line === l.key, lineMeta(l.key).color, narrow)}>{lineMeta(l.key).label}</button>)}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
          <input type="date" value={d} min={todayIso()} onChange={e => e.target.value && setD(e.target.value)} style={{ ...inputStyle, width: "auto", padding: "6px 8px", colorScheme: "dark" }} />
          <input type="time" value={time} onChange={e => e.target.value && setTime(e.target.value)} style={{ ...inputStyle, width: "auto", padding: "6px 8px", colorScheme: "dark" }} />
          <span style={{ flex: 1 }} />
          <Btn kind="primary" disabled={busy || idea.trim().length < 3} onClick={make}>{busy ? "Writing it…" : "Add to the plan"}</Btn>
        </div>
        {busy && <div style={{ fontSize: 12, color: DS.mut, marginTop: 8 }}>Writing the copy and the graphic — about 20 seconds.</div>}
        {err && <div style={{ fontSize: 13, color: DS.orange, marginTop: 8 }}>{err}</div>}
      </div>
    </div>
  );
}
