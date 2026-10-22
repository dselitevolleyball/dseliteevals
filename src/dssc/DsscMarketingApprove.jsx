// DSSC Marketing → Approve. One week of drafts, by day: the graphic as it
// will post, the copy (editable in place), why the planner picked it, and
// the buttons Drew needs from his phone — Approve, Ask for a change, Reject.
// "Approve all ready" walks every ready draft in the week. Nothing goes out
// until it's approved; the cron publishes approved items at their time.

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Tag, inputStyle, Grow, Field, fetchAll } from "./DsscHub.jsx";
import { segmentsOf } from "../../shared/campaign-audience.js";
import EmailAudiencePicker, { emailAudienceLabel, useSegments } from "./DsscEmailAudience.jsx";
import { TEMPLATES, FORMATS } from "../../shared/marketing-graphics.js";
import { photoHaystack } from "../../shared/marketing-photos.js";
import {
  mktApi, isMissingTable, MIGRATION_MSG, lineMeta, lineLabel, LineChip, ANGLES, STATUS_META, CHANNEL_META, KIND_LABEL, kindOf,
  mondayOf, addDays, fmtDate, fmtWhen, timeOf, dayOf, weekLabel, specOf, hasGraphic, GraphicPreview,
  approveItem, readyIssue, chipStyle, Msg, Panel, H, uploadImage, isImageFile,
} from "./DsscMarketingKit.jsx";

const bigBtn = (narrow) => narrow ? { fontSize: 15, padding: "12px 16px", minHeight: 46, borderRadius: 10 } : {};
const fieldLbl = { fontSize: 11, fontWeight: 700, color: DS.mut, margin: "10px 0 4px", letterSpacing: "0.03em" };
const PLATFORMS = [["facebook", "Facebook", "#60A5FA"], ["instagram", "Instagram", "#F06BB4"], ["instagram_story", "IG story", "#F5A3CF"], ["facebook_story", "FB story", "#93C5FD"]];
const PLAT_TAG = { facebook: ["FB", "#60A5FA"], instagram: ["IG", "#F06BB4"], instagram_story: ["IG story", "#F5A3CF"], facebook_story: ["FB story", "#93C5FD"] };
const tagsToArr = (s) => String(s || "").split(/[\s,]+/).map(t => t.trim()).filter(Boolean).map(t => t.startsWith("#") ? t : "#" + t);
const aiNote = (d) => d?.ai && d.ai.used === false ? ` (Plain template copy — the AI writer wasn't available${d.ai.error ? ": " + d.ai.error : ""}.)` : "";
const daysOfWeek = (wk) => Array.from({ length: 7 }, (_, i) => addDays(wk, i));

export default function MarketingApprove({ week, setWeek, status, narrow, onChanged }) {
  const [items, setItems] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState(null);
  const [brief, setBrief] = useState("");
  const [plan, setPlan] = useState(null);
  const [picker, setPicker] = useState(null);       // item whose photo is being swapped
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("mkt_items").select("*").eq("week_of", week).order("scheduled_at", { ascending: true, nullsFirst: false }).order("id");
    if (error) { setMsg({ err: isMissingTable(error) ? MIGRATION_MSG : error.message }); setItems([]); return; }
    setItems(data || []);
  }, [week]);
  useEffect(() => { setItems(null); setPlan(null); setMsg(null); load(); }, [load]);
  // Nothing drafted yet: show what the planner would make.
  useEffect(() => {
    if (!items || items.length || plan) return;
    mktApi("plan", { week_of: week }).then(d => setPlan(d)).catch(e => setPlan({ error: e.message }));
  }, [items, week]); // eslint-disable-line react-hooks/exhaustive-deps

  const replace = (it) => setItems(xs => (xs || []).map(x => x.id === it.id ? { ...x, ...it } : x));
  const patchItem = async (it, patch) => {
    replace({ id: it.id, ...patch });
    try {
      const d = await mktApi("update", { id: it.id, patch });
      if (d?.item) replace(d.item);
    } catch (e) {
      if (e.status === 404 && !e.data?.error) { // API not deployed yet: RLS lets directors write directly
        const { error } = await supabase.from("mkt_items").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", it.id);
        if (!error) return;
        setMsg({ err: error.message });
      } else setMsg({ err: "Couldn't save: " + e.message });
      load();
    }
  };

  const counts = useMemo(() => {
    const c = { draft: 0, approved: 0, published: 0, failed: 0, ready: 0 };
    for (const it of items || []) { c[it.status] = (c[it.status] || 0) + 1; if (!readyIssue(it)) c.ready++; }
    return c;
  }, [items]);
  const shown = useMemo(() => (items || []).filter(it => filter === "all" || (filter === "todo" ? it.status === "draft" : filter === "failed" ? it.status === "failed" : it.channel === filter)), [items, filter]);
  const byDay = useMemo(() => {
    const m = new Map();
    for (const it of shown) { const d = dayOf(it.scheduled_at) || "unscheduled"; if (!m.has(d)) m.set(d, []); m.get(d).push(it); }
    return [...m.entries()].sort((a, b) => a[0] === "unscheduled" ? 1 : b[0] === "unscheduled" ? -1 : a[0].localeCompare(b[0]));
  }, [shown]);

  const generate = async (replaceDrafts) => {
    if (replaceDrafts && !window.confirm("Regenerate this week's drafts? Drafts you haven't edited are replaced; approved and edited items stay.")) return;
    setBusy("generate"); setMsg(null);
    try {
      const d = await mktApi("generate", { week_of: week, replace_drafts: !!replaceDrafts });
      setMsg({ ok: `${(d.items || []).length} drafts ready for the week of ${fmtDate(week)}.${aiNote(d)}` });
      setPlan(null); await load(); onChanged?.();
    } catch (e) { setMsg({ err: e.message }); }
    setBusy("");
  };
  const sendBrief = async () => {
    const t = brief.trim(); if (t.length < 3) return;
    setBusy("brief"); setMsg(null);
    try {
      const d = await mktApi("brief", { week_of: week, instruction: t });
      setBrief(""); setMsg({ ok: `Got it — saved as a priority for this week and ${(d.items || []).length} drafts were rewritten.${aiNote(d)}` });
      await load(); onChanged?.();
    } catch (e) { setMsg({ err: e.message }); }
    setBusy("");
  };
  const approveAll = async () => {
    const ready = (items || []).filter(it => !readyIssue(it));
    if (!ready.length) return;
    if (!window.confirm(`Approve ${ready.length} ready ${ready.length === 1 ? "item" : "items"}? Each one publishes at its scheduled time.`)) return;
    setBusy("all"); setMsg(null);
    const errs = [];
    for (let i = 0; i < ready.length; i++) {
      const it = ready[i];
      setProgress({ done: i, total: ready.length, label: `${CHANNEL_META[it.channel]?.[0] || it.channel} · ${lineLabel(it.line)}`, step: "" });
      try {
        await approveItem(it, (step) => setProgress(p => ({ ...p, step })));
        replace({ id: it.id, status: "approved" });
      } catch (e) { errs.push(`${lineLabel(it.line)} ${it.channel}: ${e.message}`); }
    }
    setProgress(null); setBusy("");
    setMsg(errs.length ? { err: `Approved ${ready.length - errs.length} of ${ready.length}.\n` + errs.join("\n") } : { ok: `Approved ${ready.length}. They'll publish on schedule.` });
    await load(); onChanged?.();
  };

  const { rel, range } = weekLabel(week);
  const conn = status?.connections || null;
  const activePri = (status?.priorities || []).filter(p => p.active !== false && (!p.starts_on || p.starts_on <= addDays(week, 6)) && (!p.ends_on || p.ends_on >= week));

  return (
    <div>
      {/* Week picker */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Btn kind="ghost" onClick={() => setWeek(addDays(week, -7))} style={{ padding: "10px 14px", minHeight: 44, fontSize: 16 }} aria-label="Previous week">←</Btn>
        <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{rel || "Week of " + fmtDate(week)}</div>
          <div style={{ fontSize: 12, color: DS.mut }}>{range}</div>
        </div>
        <Btn kind="ghost" onClick={() => setWeek(addDays(week, 7))} style={{ padding: "10px 14px", minHeight: 44, fontSize: 16 }} aria-label="Next week">→</Btn>
      </div>
      {week !== mondayOf() && <div style={{ textAlign: "center", marginTop: -6, marginBottom: 10 }}><Btn kind="link" small onClick={() => setWeek(mondayOf())}>Back to this week</Btn></div>}

      {conn && (!conn.facebook || !conn.instagram || !conn.email) && (
        <div style={{ fontSize: 12, color: DS.mut, background: DS.orangeSoft, border: "1px solid rgba(255,115,0,0.3)", borderRadius: 10, padding: "8px 12px", marginBottom: 12 }}>
          Not connected yet: {[!conn.facebook && "Facebook", !conn.instagram && "Instagram", !conn.email && "email", !conn.sms && "texts", !conn.ai && "AI copy"].filter(Boolean).join(", ")} — approved items for those channels wait until it is (Settings tab has the steps).
        </div>
      )}

      {/* Week actions */}
      <Panel style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {items && items.length > 0 && <>
            <Tag color={DS.mut}>{counts.draft} draft{counts.draft === 1 ? "" : "s"}</Tag>
            {counts.approved > 0 && <Tag color={DS.lime}>{counts.approved} approved</Tag>}
            {counts.published > 0 && <Tag color="#7FD1C3">{counts.published} published</Tag>}
            {counts.failed > 0 && <Tag color={DS.orange} fill>{counts.failed} failed</Tag>}
          </>}
          <span style={{ flex: 1 }} />
          {items && (items.length
            ? <Btn kind="ghost" disabled={!!busy} onClick={() => generate(true)} style={bigBtn(narrow)}>{busy === "generate" ? "Writing…" : "Regenerate drafts"}</Btn>
            : <Btn kind="primary" disabled={!!busy} onClick={() => generate(false)} style={bigBtn(narrow)}>{busy === "generate" ? "Writing this week's posts…" : "Generate this week"}</Btn>)}
          {counts.ready > 0 && <Btn kind="primary" disabled={!!busy} onClick={approveAll} style={{ ...bigBtn(narrow), ...(narrow ? { width: "100%", justifyContent: "center" } : {}) }}>✓ Approve all ready ({counts.ready})</Btn>}
        </div>
        {busy === "generate" && <div style={{ fontSize: 12, color: DS.mut, marginTop: 8 }}>Planning the week and writing every post — this can take up to a minute.</div>}
        {progress && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Approving {progress.done + 1} of {progress.total} — {progress.label}{progress.step ? " · " + progress.step : ""}</div>
            <div style={{ height: 6, background: DS.panel2, borderRadius: 3, marginTop: 6, overflow: "hidden" }}><div style={{ width: `${(progress.done / progress.total) * 100}%`, height: "100%", background: DS.lime, transition: "width .3s" }} /></div>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <Grow value={brief} onChange={e => setBrief(e.target.value)} minRows={2} placeholder={'Tell the machine what matters this week… e.g. "Thanksgiving: push Camp Elevate hard + the volleyball and basketball camps"'} style={{ fontSize: narrow ? 16 : 14 }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
            <Btn kind="primary" disabled={!!busy || brief.trim().length < 3} onClick={sendBrief} style={bigBtn(narrow)}>{busy === "brief" ? "Rewriting the week…" : "Send to the machine"}</Btn>
            <span style={{ fontSize: 12, color: DS.dim, flex: 1, minWidth: 180 }}>Saved as a one-week priority, then this week's drafts are rewritten around it.</span>
          </div>
          {activePri.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: DS.mut }}>Priorities this week:</span>
            {activePri.map(p => <Tag key={p.id} color={DS.orange}>{p.title} · {p.weight}</Tag>)}
          </div>}
        </div>
        <Msg msg={msg} style={{ marginTop: 10 }} />
      </Panel>

      {/* Filters */}
      {items && items.length > 0 && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 12, paddingBottom: 2 }}>
          {[["all", "All"], ["todo", "To approve"], ["social", "Social"], ["email", "Email"], ["sms", "Texts"], ...(counts.failed ? [["failed", "Failed"]] : [])].map(([k, l]) => <button key={k} onClick={() => setFilter(k)} style={chipStyle(filter === k, DS.lime, narrow)}>{l}</button>)}
        </div>
      )}

      {items == null ? <div style={{ color: DS.mut, padding: 20 }}>Loading…</div>
        : !items.length ? <EmptyWeek plan={plan} week={week} />
        : byDay.map(([day, its]) => (
          <div key={day} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: DS.lime, margin: "4px 0 8px" }}>{day === "unscheduled" ? "Not scheduled" : fmtDate(day, { weekday: "long", month: "short", day: "numeric" })}</div>
            {its.map(it => <ItemCard key={it.id} item={it} week={week} narrow={narrow} onPatch={patchItem} onReplace={replace} reload={load} onChanged={onChanged} onPickPhoto={() => setPicker(it)} />)}
          </div>
        ))}

      {picker && <PhotoPicker item={picker} narrow={narrow} onClose={() => setPicker(null)} onPick={(p) => { const it = picker; setPicker(null); patchItem(it, { graphic: { ...(it.graphic || {}), photo_url: p?.url || null, photo_key: p?.key || null } }); }} />}
    </div>
  );
}

function EmptyWeek({ plan, week }) {
  const slots = plan?.slots || [];
  return (
    <Panel style={{ borderStyle: "dashed" }}>
      <div style={{ fontSize: 14, color: DS.mut, marginBottom: slots.length ? 12 : 0 }}>Nothing drafted for the week of {fmtDate(week)} yet. Generate it above{slots.length ? " — here's what the planner would make:" : "."}</div>
      {plan?.error && <div style={{ fontSize: 12, color: DS.dim }}>({plan.error})</div>}
      {slots.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid " + DS.line, fontSize: 13 }}>
          <b style={{ width: 92 }}>{fmtDate(s.day, { weekday: "short", month: "short", day: "numeric" })}</b>
          <span>{CHANNEL_META[s.channel]?.[1]} {KIND_LABEL[kindOf(s)] || CHANNEL_META[s.channel]?.[0]}</span>
          <LineChip line={s.line} />
          {s.angle && <span style={{ color: DS.mut, fontSize: 12 }}>{ANGLES[s.angle] || s.angle}</span>}
          <span style={{ color: DS.dim, fontSize: 12, flexBasis: "100%" }}>{s.program?.name ? s.program.name + " — " : ""}{s.reason}{s.theme ? <><br /><span style={{ color: DS.mut }}>Idea: </span>{s.theme}</> : null}</span>
        </div>
      ))}
      {(plan?.notes || []).length > 0 && <div style={{ fontSize: 12, color: DS.mut, marginTop: 8 }}>{plan.notes.join(" · ")}</div>}
    </Panel>
  );
}

// ── One item ────────────────────────────────────────────────────────────────
export function ItemCard({ item: it, week, narrow, onPatch, onReplace, reload, onChanged, onPickPhoto }) {
  const segs = useSegments();
  const [busy, setBusy] = useState("");
  const [step, setStep] = useState("");
  const [msg, setMsg] = useState(null);
  const [ask, setAsk] = useState(null);        // "change" | "reject" | null
  const [askText, setAskText] = useState("");
  const [showGraphic, setShowGraphic] = useState(false);
  const [preview, setPreview] = useState(null); // story preview toggle
  const [showRev, setShowRev] = useState(false);
  const fileRef = useRef(null);
  const [upMode, setUpMode] = useState(null);   // "photo" | "custom" while the file picker is open
  const editable = it.status === "draft" || it.status === "rejected" || it.status === "failed";
  const g = it.graphic && typeof it.graphic === "object" ? it.graphic : {};
  const spec = specOf(it, preview ? { format: preview } : {});
  const [sLabel, sColor] = STATUS_META[it.status] || STATUS_META.draft;
  const issue = readyIssue(it);
  const setG = (patch) => onPatch(it, { graphic: { ...g, ...patch } });
  // Your own image: as the photo behind the club's text (and into the photo
  // library for next time), or a finished graphic posted exactly as is.
  const pickFile = (mode) => { setUpMode(mode); fileRef.current?.click(); };
  const onFile = async (file) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (!isImageFile(file)) { setMsg({ err: "That isn't an image — pick a JPG, PNG or WebP." }); return; }
    setBusy("upload"); setMsg(null);
    try {
      const up = await uploadImage(file);
      if (upMode === "custom") setG({ template: "custom", custom_url: up.url, photo_url: up.url, photo_key: up.path });
      else {
        setG({ photo_url: up.url, photo_key: up.path, template: g.template === "custom" ? "photo" : (g.template || "photo") });
        await supabase.from("mkt_photos").insert({ url: up.url, source: "upload", key: up.path, filename: file.name, tags: [], line: it.line || null, alt: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "), width: up.w, height: up.h, active: true }).then(() => {}, () => {});
      }
      setMsg({ ok: upMode === "custom" ? "Your graphic is in — it posts exactly as shown." : "Your photo is in — the club's text sits on top. It's in the photo library now too." });
    } catch (e) { setMsg({ err: e.message }); }
    setBusy(""); setUpMode(null);
  };

  const run = async (key, fn, okText) => {
    setBusy(key); setMsg(null); setStep("");
    try { const d = await fn(); if (d?.item) onReplace(d.item); setMsg(okText ? { ok: typeof okText === "function" ? okText(d) : okText } : null); await reload(); onChanged?.(); }
    catch (e) { setMsg({ err: e.message }); }
    setBusy(""); setStep("");
  };
  const approve = () => run("approve", () => approveItem(it, setStep), "Approved — it publishes " + (it.scheduled_at ? fmtWhen(it.scheduled_at) : "on schedule") + ".");
  const revise = () => { const t = askText.trim(); if (t.length < 2) return; run("revise", async () => { const d = await mktApi("revise", { id: it.id, instruction: t }); setAsk(null); setAskText(""); return d; }, "Rewritten — have a look."); };
  const reject = () => run("reject", async () => { const d = await mktApi("reject", { id: it.id, reason: askText.trim() }); setAsk(null); setAskText(""); return d; }, "Rejected.");
  const test = () => run("test", () => mktApi("test", { id: it.id }), (d) => d?.message || (d?.preview ? "Social posts can't be test-posted — the preview above is exactly what goes up." : it.channel === "email" ? `Test email sent${d?.to ? " to " + d.to : ""}.` : it.channel === "sms" ? `Test text sent${d?.to ? " to " + d.to : ""}.` : "Preview only — social posts can't be test-posted."));
  const publishNow = () => { if (!window.confirm(it.channel === "social" ? "Post this to " + (it.platforms || []).join(" + ") + " right now?" : it.channel === "email" ? "Send this email to the whole list right now?" : "Queue this text to send now?")) return; run("publish", () => mktApi("publish_now", { id: it.id }), (d) => d?.message || "Publishing now."); };
  const unapprove = () => run("unapprove", () => mktApi("unapprove", { id: it.id }), "Back to draft — edit away.");
  const del = () => { if (!window.confirm("Delete this item?")) return; run("delete", () => mktApi("delete", { id: it.id }), null); };
  const setTime = (day, hhmm) => onPatch(it, { scheduled_at: new Date(`${day}T${hhmm || "18:30"}:00`).toISOString() });

  const title = (it.channel === "email" ? it.email_subject : g.headline) || it.headline || it.program?.name || lineLabel(it.line);
  const day = dayOf(it.scheduled_at) || week;
  const ext = it.external_ids || {};

  const head = (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 16 }} title={CHANNEL_META[it.channel]?.[0]}>{CHANNEL_META[it.channel]?.[1]}</span>
      {it.channel === "social" ? (it.platforms || []).map(p => <Tag key={p} color={(PLAT_TAG[p] || [p, DS.mut])[1]}>{(PLAT_TAG[p] || [p])[0]}</Tag>) : null}
      <Tag color={DS.mut}>{KIND_LABEL[kindOf(it)] || CHANNEL_META[it.channel]?.[0]}</Tag>
      <LineChip line={it.line} />
      {it.angle && <span style={{ fontSize: 11, color: DS.mut }}>{ANGLES[it.angle] || it.angle}</span>}
      <span style={{ flex: 1 }} />
      <Tag color={sColor} fill={it.status === "approved" || it.status === "failed"}>{sLabel}</Tag>
    </div>
  );

  const timeRow = (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
      <select disabled={!editable} value={day} onChange={e => setTime(e.target.value, timeOf(it.scheduled_at))} style={{ ...inputStyle, width: "auto", padding: "7px 8px", fontSize: narrow ? 15 : 13, colorScheme: "dark" }}>
        {daysOfWeek(week).map(d => <option key={d} value={d}>{fmtDate(d, { weekday: "short", month: "short", day: "numeric" })}</option>)}
        {!daysOfWeek(week).includes(day) && <option value={day}>{fmtDate(day, { weekday: "short", month: "short", day: "numeric" })}</option>}
      </select>
      <input type="time" disabled={!editable} value={timeOf(it.scheduled_at)} onChange={e => e.target.value && setTime(day, e.target.value)} style={{ ...inputStyle, width: "auto", padding: "7px 8px", fontSize: narrow ? 15 : 13, colorScheme: "dark" }} />
      {it.channel === "social" && PLATFORMS.map(([k, l, c]) => {
        const on = (it.platforms || []).includes(k);
        return <button key={k} disabled={!editable} onClick={() => onPatch(it, { platforms: on ? (it.platforms || []).filter(x => x !== k) : [...(it.platforms || []), k] })} style={chipStyle(on, c, narrow)}>{on ? "✓ " : ""}{l}</button>;
      })}
    </div>
  );

  const isStoryItem = ["story", "follow_up"].includes(kindOf(it));
  const graphicBox = hasGraphic(it) && (
    <div>
      <GraphicPreview spec={spec} onClick={editable ? () => setShowGraphic(s => !s) : undefined} />
      {editable && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        {[...TEMPLATES, ...(g.custom_url ? [["custom", "As uploaded"]] : [])].map(([k, l]) => <button key={k} onClick={() => setG(k === "custom" ? { template: "custom", photo_url: g.custom_url } : { template: k, ...(g.template === "custom" && g.photo_url === g.custom_url ? { photo_url: null } : {}) })} style={chipStyle((g.template || "photo") === k, DS.lime, narrow)}>{l}</button>)}
      </div>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        {it.channel === "social" && (isStoryItem ? ["story"] : ["post", "square"]).map(f => <button key={f} disabled={!editable} onClick={() => { setPreview(null); setG({ format: f }); }} style={chipStyle(!preview && spec.format === f, "#7FD1C3")}>{FORMATS[f].label}</button>)}
        {it.channel === "social" && !isStoryItem && <button onClick={() => setPreview(p => p ? null : "story")} style={chipStyle(preview === "story", "#7FD1C3")}>Story preview</button>}
        {editable && <button onClick={onPickPhoto} style={chipStyle(false, DS.lime, narrow)}>Swap photo</button>}
        {editable && <button disabled={busy === "upload"} onClick={() => pickFile("photo")} style={chipStyle(false, DS.lime, narrow)} title="Your photo, with the club's headline and logo on top">{busy === "upload" && upMode === "photo" ? "Uploading…" : "⬆ Upload photo"}</button>}
        {editable && <button disabled={busy === "upload"} onClick={() => pickFile("custom")} style={chipStyle(g.template === "custom", "#F5C542", narrow)} title="A finished graphic (Canva, a flyer) — posted exactly as is">{busy === "upload" && upMode === "custom" ? "Uploading…" : "⬆ Use my own graphic"}</button>}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => onFile(e.target.files?.[0])} />
        {editable && g.template !== "custom" && <button onClick={() => setShowGraphic(s => !s)} style={chipStyle(showGraphic, DS.lime, narrow)}>{showGraphic ? "Done with text" : "Edit graphic text"}</button>}
      </div>
      {it.asset_url && <div style={{ fontSize: 11, color: DS.dim, marginTop: 6 }}><a href={it.asset_url} target="_blank" rel="noreferrer" style={{ color: DS.mut }}>Uploaded image</a>{it.asset_story_url && <> · <a href={it.asset_story_url} target="_blank" rel="noreferrer" style={{ color: DS.mut }}>story</a></>}</div>}
      {showGraphic && editable && (
        <div style={{ marginTop: 8, padding: 10, background: DS.panel2, borderRadius: 10 }}>
          <div style={fieldLbl}>Headline on the graphic</div>
          <Field value={g.headline || ""} onSave={v => setG({ headline: v })} placeholder="Big, short, uppercase" />
          <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr", gap: "0 10px" }}>
            <div><div style={fieldLbl}>Accent word (lime/orange)</div><Field value={g.accent || ""} onSave={v => setG({ accent: v })} placeholder="one word from the headline" /></div>
            <div><div style={fieldLbl}>Tag (top-left label)</div><Field value={g.tag || ""} onSave={v => setG({ tag: v })} placeholder="Volleyball · Starts Nov 3" /></div>
          </div>
          <div style={fieldLbl}>Sub line</div>
          <Field value={g.sub || ""} onSave={v => setG({ sub: v })} placeholder="Ages, days, where" />
          {(g.template === "starts" || g.template === "countdown") && <><div style={fieldLbl}>{g.template === "starts" ? "Date (e.g. NOV 23)" : "Burst (e.g. 3 DAYS, LAST CALL)"}</div><Field value={g.date_label || ""} onSave={v => setG({ date_label: v })} /></>}
          {g.template === "list" && <><div style={fieldLbl}>Rows (one per line, up to 4: "MON · Skill Lab 3–5th")</div><Field multiline minRows={3} value={(g.items || []).join("\n")} onSave={v => setG({ items: v.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 4) })} /></>}
          <div style={fieldLbl}>Button on the graphic</div>
          <Field value={g.cta || ""} onSave={v => setG({ cta: v })} placeholder={it.cta_text || "Sign up"} />
        </div>
      )}
    </div>
  );

  const copyBox = (
    <div>
      {it.channel === "social" && <>
        <div style={fieldLbl}>Caption</div>
        <Field multiline minRows={4} readOnly={!editable} value={it.body || ""} onSave={v => onPatch(it, { body: v })} style={{ fontSize: narrow ? 16 : 14 }} />
        <div style={fieldLbl}>Hashtags</div>
        <Field readOnly={!editable} value={(it.hashtags || []).map(h => String(h).startsWith("#") ? h : "#" + h).join(" ")} onSave={v => onPatch(it, { hashtags: tagsToArr(v) })} placeholder="#DrippingSprings" />
      </>}
      {it.channel === "email" && <>
        <div style={fieldLbl}>Subject</div>
        <Field readOnly={!editable} value={it.email_subject || ""} onSave={v => onPatch(it, { email_subject: v })} style={{ fontSize: narrow ? 16 : 14, fontWeight: 700 }} />
        <div style={fieldLbl}>Preheader (the grey line after the subject)</div>
        <Field readOnly={!editable} value={it.email_preheader || ""} onSave={v => onPatch(it, { email_preheader: v })} />
        {(it.programs || []).length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>{it.programs.map((p, i) => <Tag key={p.id || i} color={DS.mut}>{p.name}</Tag>)}</div>}
        <div style={fieldLbl}>To</div>
        {editable ? <EmailAudiencePicker value={it.audience} onChange={v => onPatch(it, { audience: v || { source: "dssc_contacts" } })} narrow={narrow} /> : <div style={{ fontSize: 13, color: DS.mut }}>{emailAudienceLabel(it.audience, segs)}</div>}
      </>}
      {it.channel === "sms" && <>
        <div style={fieldLbl}>Text</div>
        <Field multiline minRows={3} readOnly={!editable} value={it.body || ""} onSave={v => onPatch(it, { body: v })} style={{ fontSize: narrow ? 16 : 14 }} />
        <div style={{ fontSize: 12, color: DS.mut, marginTop: 4 }}>{String(it.body || "").length} characters · {segmentsOf(it.body || "")} segment{segmentsOf(it.body || "") === 1 ? "" : "s"} per family · STOP handled automatically</div>
        <div style={{ fontSize: 12, color: DS.mut, marginTop: 4 }}>To: {audienceSummary(it.audience)}</div>
      </>}
      {it.channel !== "sms" && <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1.4fr", gap: "0 10px" }}>
        <div><div style={fieldLbl}>Call to action</div><Field readOnly={!editable} value={it.cta_text || ""} onSave={v => onPatch(it, { cta_text: v })} placeholder="Register now" /></div>
        <div style={{ minWidth: 0 }}><div style={fieldLbl}>Link</div><Field readOnly={!editable} value={it.cta_url || ""} onSave={v => onPatch(it, { cta_url: v.trim() })} placeholder="https://…" style={{ wordBreak: "break-all" }} /></div>
      </div>}
      {it.cta_url && <div style={{ fontSize: 12, marginTop: 4 }}><a href={it.cta_url} target="_blank" rel="noreferrer" style={{ color: DS.lime, wordBreak: "break-all" }}>Open link ↗</a></div>}
    </div>
  );

  const emailPreview = it.channel === "email" && (it.email_html ? (
    <div style={{ marginTop: 12 }}>
      <H>Email preview</H>
      <iframe title={"Email " + it.id} srcDoc={it.email_html} sandbox="allow-popups allow-popups-to-escape-sandbox" style={{ width: "100%", height: narrow ? 520 : 640, border: "1px solid " + DS.line, borderRadius: 10, background: "#fff" }} />
    </div>
  ) : <div style={{ fontSize: 12, color: DS.dim, marginTop: 10 }}>No HTML yet — the plain-text version below is what would send.<pre style={{ whiteSpace: "pre-wrap", fontFamily: DS.font, color: DS.mut }}>{it.body}</pre></div>);

  const pubInfo = (it.status === "published" || it.status === "failed" || it.status === "approved" || it.status === "publishing" || (it.status === "rejected" && it.error)) && (
    <div style={{ fontSize: 12, color: it.status === "failed" ? DS.orange : DS.mut, marginTop: 10, lineHeight: 1.5 }}>
      {it.status === "approved" && <>Approved{it.approved_by ? " by " + it.approved_by : ""} · publishes {it.scheduled_at ? fmtWhen(it.scheduled_at) : "on schedule"}</>}
      {it.status === "publishing" && <>Publishing now…</>}
      {it.status === "published" && <>Published {fmtWhen(it.published_at)}
        {ext.facebook && <> · <a href={`https://www.facebook.com/${ext.facebook}`} target="_blank" rel="noreferrer" style={{ color: DS.lime }}>Facebook ↗</a></>}
        {ext.instagram && <> · Instagram ✓</>}{ext.instagram_story && <> · IG story ✓</>}
        {ext.email && <> · {ext.email.sent ?? 0} emails sent{ext.email.failed ? `, ${ext.email.failed} failed` : ""}</>}
        {it.sms_campaign_id && <> · text campaign #{it.sms_campaign_id}</>}
      </>}
      {it.status === "failed" && <>Failed: {it.error || "unknown error"}</>}
      {it.status === "rejected" && <>{it.error}</>}
    </div>
  );

  const actions = (
    <div style={{ marginTop: 12 }}>
      {ask && (
        <div style={{ marginBottom: 10 }}>
          <Grow autoFocus value={askText} onChange={e => setAskText(e.target.value)} minRows={2} style={{ fontSize: narrow ? 16 : 14 }}
            placeholder={ask === "change" ? 'What should change? e.g. "shorter, more about the coaches\' small groups, use a basketball photo"' : "Why? (optional — helps the machine next time)"}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") (ask === "change" ? revise() : reject()); }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            {ask === "change"
              ? <Btn kind="primary" disabled={!!busy || askText.trim().length < 2} onClick={revise} style={bigBtn(narrow)}>{busy === "revise" ? "Rewriting…" : "Rewrite it"}</Btn>
              : <Btn kind="warn" disabled={!!busy} onClick={reject} style={bigBtn(narrow)}>{busy === "reject" ? "…" : "Reject"}</Btn>}
            <Btn kind="quiet" onClick={() => { setAsk(null); setAskText(""); }} style={bigBtn(narrow)}>Cancel</Btn>
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {it.status === "draft" && <Btn kind="primary" disabled={!!busy || !!issue} title={issue || ""} onClick={approve} style={{ ...bigBtn(narrow), ...(narrow ? { flex: "1 1 100%", justifyContent: "center", fontSize: 17, minHeight: 52 } : { fontSize: 14, padding: "10px 18px" }) }}>{busy === "approve" ? (step || "Approving…") : "✓ Approve"}</Btn>}
        {editable && !ask && <Btn kind="ghost" disabled={!!busy} onClick={() => { setAsk("change"); setAskText(""); }} style={{ ...bigBtn(narrow), ...(narrow ? { flex: 1, justifyContent: "center" } : {}) }}>Ask for a change</Btn>}
        {it.status === "draft" && !ask && <Btn kind="quiet" disabled={!!busy} onClick={() => { setAsk("reject"); setAskText(""); }} style={{ ...bigBtn(narrow), ...(narrow ? { flex: 1, justifyContent: "center" } : {}) }}>Reject</Btn>}
        {(it.channel === "email" || it.channel === "sms") && it.status !== "published" && it.status !== "publishing" && <Btn kind="ghost" small={!narrow} disabled={!!busy} onClick={test} style={bigBtn(narrow)}>{busy === "test" ? "Sending…" : "Send me a test"}</Btn>}
        {it.status === "approved" && <Btn kind="warn" small={!narrow} disabled={!!busy} onClick={publishNow} style={bigBtn(narrow)}>{busy === "publish" ? "Publishing…" : "Publish now"}</Btn>}
        {it.status === "failed" && <Btn kind="warn" small={!narrow} disabled={!!busy} onClick={publishNow} style={bigBtn(narrow)}>{busy === "publish" ? "Retrying…" : "Retry now"}</Btn>}
        {(it.status === "approved" || it.status === "failed") && <Btn kind="quiet" small={!narrow} disabled={!!busy} onClick={unapprove} style={bigBtn(narrow)}>Unapprove</Btn>}
        {(it.status === "draft" || it.status === "rejected") && <Btn kind="link" small disabled={!!busy} onClick={del} style={{ color: DS.dim, marginLeft: "auto" }}>Delete</Btn>}
      </div>
      {issue && it.status === "draft" && <div style={{ fontSize: 12, color: DS.orange, marginTop: 6 }}>Can't approve yet: {issue}.</div>}
      <Msg msg={msg} style={{ marginTop: 8 }} />
    </div>
  );

  const revs = Array.isArray(it.revisions) ? it.revisions : [];
  return (
    <div style={{ background: DS.panel, border: "1px solid " + (it.status === "failed" ? "rgba(255,115,0,0.5)" : it.status === "approved" ? "rgba(178,208,73,0.35)" : DS.line), borderRadius: 14, padding: narrow ? 12 : 14, marginBottom: 12, opacity: it.status === "rejected" ? 0.7 : 1 }}>
      {head}
      <div style={{ fontSize: 17, fontWeight: 800, marginTop: 8, lineHeight: 1.25 }}>{title}</div>
      {it.reason && <div style={{ fontSize: 12, color: DS.mut, marginTop: 4, lineHeight: 1.45 }}><span style={{ color: DS.dim }}>Why: </span>{it.reason}</div>}
      {it.theme && <div style={{ fontSize: 12, color: DS.mut, marginTop: 2, lineHeight: 1.45 }}><span style={{ color: DS.dim }}>Idea: </span>{it.theme}</div>}
      {it.program?.name && <div style={{ fontSize: 12, color: DS.dim, marginTop: 2 }}>{it.program.url ? <a href={it.program.url} target="_blank" rel="noreferrer" style={{ color: DS.mut }}>{it.program.name} ↗</a> : it.program.name}{it.program.first_date ? " · starts " + fmtDate(it.program.first_date) : ""}</div>}
      {timeRow}
      {hasGraphic(it)
        ? <div style={narrow ? { marginTop: 12 } : { display: "grid", gridTemplateColumns: "minmax(240px, 360px) minmax(0, 1fr)", gap: 16, marginTop: 12, alignItems: "start" }}>
            {graphicBox}
            <div style={narrow ? { marginTop: 4 } : {}}>{copyBox}</div>
          </div>
        : <div style={{ marginTop: 6 }}>{copyBox}</div>}
      {emailPreview}
      {revs.length > 0 && <div style={{ marginTop: 8 }}>
        <Btn kind="link" small onClick={() => setShowRev(s => !s)} style={{ color: DS.mut }}>{revs.length} change{revs.length === 1 ? "" : "s"} asked {showRev ? "▴" : "▾"}</Btn>
        {showRev && revs.map((r, i) => <div key={i} style={{ fontSize: 12, color: DS.mut, marginTop: 4 }}>“{r.instruction}” <span style={{ color: DS.dim }}>— {r.by || ""} {r.at ? fmtWhen(r.at) : ""}</span></div>)}
      </div>}
      {pubInfo}
      {actions}
    </div>
  );
}

function audienceSummary(a) {
  if (!a || typeof a !== "object" || !Object.keys(a).length) return "the default text audience (Settings)";
  const who = { parents: "Parents", players: "Players", both: "Parents + players", coaches: "Coaches" }[a.target] || "Parents";
  const cats = Array.isArray(a.categories) && a.categories.length ? " of " + a.categories.join(", ") + " families" : "";
  const prog = a.program ? ` in "${a.program}"` : "";
  return who + cats + prog + (a.current ? " (current classes)" : "") + " who opted in to texts";
}

// ── Swap photo ─────────────────────────────────────────────────────────────
export function PhotoPicker({ item, narrow, onPick, onClose }) {
  const [photos, setPhotos] = useState(null);
  const [err, setErr] = useState("");
  const [scope, setScope] = useState(item.line ? "line" : "all");
  const [tag, setTag] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    fetchAll(() => supabase.from("mkt_photos").select("*").eq("active", true)).then(setPhotos).catch(e => { setErr(isMissingTable(e) ? MIGRATION_MSG : e.message); setPhotos([]); });
  }, []);
  const lm = lineMeta(item.line);
  const sportTag = { volleyball: "volleyball", basketball: "basketball", reach: "reach", camp_elevate: "camp", parties: "parties", rentals: "facility", open_gym: "facility", club: "flagship" }[item.line];
  const tags = useMemo(() => [...new Set((photos || []).flatMap(p => p.tags || []))].sort(), [photos]);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = (photos || []).filter(p => p.release_ok !== false && (scope === "all" || p.line === item.line || (sportTag && (p.tags || []).includes(sportTag))) && (!tag || (p.tags || []).includes(tag))
      && (!words.length || (h => words.every(w => h.includes(w)))(photoHaystack(p, k => lineMeta(k).label))))
    .sort((a, b) => (b.quality || 3) - (a.quality || 3) || (a.used_count || 0) - (b.used_count || 0));
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 80, display: "flex", alignItems: narrow ? "stretch" : "flex-start", justifyContent: "center", padding: narrow ? 0 : "5vh 16px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: DS.bg, border: narrow ? "none" : "1px solid " + DS.lineStrong, borderRadius: narrow ? 0 : 14, width: "100%", maxWidth: 900, padding: 14, boxSizing: "border-box", minHeight: narrow ? "100%" : undefined }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 800, flex: 1 }}>Pick a photo</div>
          <Btn kind="ghost" onClick={onClose} style={{ minHeight: 40 }}>Close</Btn>
        </div>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6 }}>
          {item.line && <button onClick={() => setScope("line")} style={chipStyle(scope === "line", lm.color, narrow)}>{lm.label}</button>}
          <button onClick={() => setScope("all")} style={chipStyle(scope === "all", DS.lime, narrow)}>All photos</button>
          {tags.map(t => <button key={t} onClick={() => setTag(tag === t ? "" : t)} style={chipStyle(tag === t, "#7FD1C3", narrow)}>{t}</button>)}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder='Search photos — "girls serving", "party cake"' style={{ ...inputStyle, margin: "4px 0 6px", fontSize: narrow ? 16 : 14 }} />
        {err && <div style={{ color: DS.orange, fontSize: 13, margin: "8px 0" }}>{err}</div>}
        {photos == null ? <div style={{ color: DS.mut, padding: 16 }}>Loading…</div>
          : !list.length ? <div style={{ color: DS.mut, padding: 16 }}>No photos here{photos.length ? " — try All photos" : " yet — sync them from the website on the Photos tab"}.</div>
          : <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${narrow ? 104 : 150}px, 1fr))`, gap: 8, marginTop: 6 }}>
              {list.map(p => (
                <button key={p.id} onClick={() => onPick(p)} style={{ padding: 0, border: "2px solid " + (item.graphic?.photo_url === p.url ? DS.lime : "transparent"), background: DS.panel2, borderRadius: 8, overflow: "hidden", cursor: "pointer", aspectRatio: "1 / 1" }}>
                  <img src={p.url} alt={p.alt || ""} crossOrigin="anonymous" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </button>
              ))}
            </div>}
        <div style={{ marginTop: 12 }}><Btn kind="quiet" onClick={() => onPick(null)}>No photo (brand background)</Btn></div>
      </div>
    </div>
  );
}

