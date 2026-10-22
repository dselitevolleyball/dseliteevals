// DSSC Marketing → Photos and Settings.
//
// Photos: the library the graphics draw from — synced from the website's
// photos.json, plus uploads (phone photos are scaled to 2000px JPEG before
// they go up). Tag them and set their line so the machine picks well; hide
// the ones it shouldn't use.
// Settings: what's connected (and what's missing to connect the rest), the
// cadence, line weights, brand voice notes, auto-generate, who gets the
// "drafts ready" email, and the default text audience.

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Tag, inputStyle, Grow, fetchAll } from "./DsscHub.jsx";
import { CATEGORIES, EMPTY_FILTERS } from "../../shared/campaign-audience.js";
import { mktApi, isMissingTable, MIGRATION_MSG, LINES, lineMeta, LineChip, DEFAULT_WEIGHTS, DEFAULT_CADENCE, DAYS, DAY_LABEL, chipStyle, Msg, Panel, H } from "./DsscMarketingKit.jsx";

const PHOTO_TAGS = ["volleyball", "basketball", "reach", "kids", "camp", "parties", "facility", "people", "flagship", "community"];

// ── Photos ──────────────────────────────────────────────────────────────────
async function downscale(file, max = 2000) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Couldn't read " + file.name)); i.src = url; });
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
    if (s === 1 && /jpe?g|webp/i.test(file.type) && file.size < 3.5e6) return { blob: file, w, h, type: file.type };
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.86));
    if (!blob) throw new Error("Couldn't convert " + file.name);
    return { blob, w, h, type: "image/jpeg" };
  } finally { URL.revokeObjectURL(url); }
}

export function MarketingPhotos({ narrow }) {
  const [rows, setRows] = useState(null);
  const [line, setLine] = useState("");
  const [tag, setTag] = useState("");
  const [hidden, setHidden] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try { setRows(await fetchAll(() => supabase.from("mkt_photos").select("*"))); }
    catch (e) { setMsg({ err: isMissingTable(e) ? MIGRATION_MSG : e.message }); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const list = useMemo(() => (rows || []).filter(p => (hidden ? !p.active : p.active !== false) && (!line || (line === "_none" ? !p.line : p.line === line)) && (!tag || (p.tags || []).includes(tag)))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))), [rows, line, tag, hidden]);
  const open = (rows || []).find(p => p.id === openId) || null;
  const hiddenCount = (rows || []).filter(p => p.active === false).length;

  const patch = async (p, ch) => {
    setRows(rs => rs.map(r => r.id === p.id ? { ...r, ...ch } : r));
    const { error } = await supabase.from("mkt_photos").update(ch).eq("id", p.id);
    if (error) { setMsg({ err: error.message }); load(); }
  };
  const sync = async () => {
    setBusy("sync"); setMsg(null);
    try {
      const r = await mktApi("photos_sync");
      const d = r.sync || r;
      if (d.ok === false) setMsg({ err: d.error || "The sync didn't work." });
      else { const n = d.added ?? d.inserted ?? d.count; setMsg({ ok: n != null ? `Synced — ${n} new photo${n === 1 ? "" : "s"} from the website${d.total != null ? ` (${d.total} on the site)` : ""}.` : "Synced from the website." }); }
      await load();
    } catch (e) { setMsg({ err: e.message }); }
    setBusy("");
  };
  const upload = async (files) => {
    files = [...(files || [])].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
    if (!files.length) return;
    setBusy("upload"); setMsg(null);
    let ok = 0; const errs = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setMsg({ ok: `Uploading ${i + 1} of ${files.length}…` });
      try {
        const { blob, w, h, type } = await downscale(f);
        const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
        const slug = f.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "photo";
        const path = `uploads/${Date.now()}-${slug}.${ext}`;
        const up = await supabase.storage.from("marketing").upload(path, blob, { contentType: type, cacheControl: "31536000" });
        if (up.error) throw new Error(up.error.message);
        const url = supabase.storage.from("marketing").getPublicUrl(path).data.publicUrl;
        const ins = await supabase.from("mkt_photos").insert({ url, source: "upload", key: path, tags: tag ? [tag] : [], line: line && line !== "_none" ? line : null, alt: f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "), width: w, height: h, active: true });
        if (ins.error) throw new Error(ins.error.message);
        ok++;
      } catch (e) { errs.push(`${f.name}: ${e.message}`); }
    }
    setMsg(errs.length ? { err: `Uploaded ${ok} of ${files.length}.\n${errs.join("\n")}` } : { ok: `Uploaded ${ok} photo${ok === 1 ? "" : "s"}${line && line !== "_none" ? " to " + lineMeta(line).label : ""}. Tag them so the machine knows when to use them.` });
    if (fileRef.current) fileRef.current.value = "";
    setBusy(""); load();
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 13, color: DS.mut, flex: 1, minWidth: 220 }}>{rows ? `${(rows || []).filter(p => p.active !== false).length} photos in use` : ""}{hiddenCount ? ` · ${hiddenCount} hidden` : ""}. The machine picks by line and tags, least-used first.</div>
        <Btn kind="ghost" disabled={!!busy} onClick={sync} style={narrow ? { minHeight: 44 } : {}}>{busy === "sync" ? "Syncing…" : "Sync from website"}</Btn>
        <Btn kind="primary" disabled={!!busy} onClick={() => fileRef.current?.click()} style={narrow ? { minHeight: 44 } : {}}>{busy === "upload" ? "Uploading…" : "Upload photos"}</Btn>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => upload(e.target.files)} />
      </div>
      <Msg msg={msg} style={{ marginBottom: 10 }} />
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6 }}>
        <button onClick={() => setLine("")} style={chipStyle(!line, DS.lime, narrow)}>All lines</button>
        {LINES.map(l0 => lineMeta(l0.key)).map(l => <button key={l.key} onClick={() => setLine(line === l.key ? "" : l.key)} style={chipStyle(line === l.key, l.color, narrow)}>{l.label}</button>)}
        <button onClick={() => setLine(line === "_none" ? "" : "_none")} style={chipStyle(line === "_none", DS.mut, narrow)}>No line</button>
      </div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, marginBottom: 8 }}>
        {PHOTO_TAGS.map(t => <button key={t} onClick={() => setTag(tag === t ? "" : t)} style={chipStyle(tag === t, "#7FD1C3", narrow)}>{t}</button>)}
        <button onClick={() => setHidden(h => !h)} style={chipStyle(hidden, DS.orange, narrow)}>{hidden ? "Showing hidden" : "Hidden"}</button>
      </div>
      {open && <PhotoEditor p={open} narrow={narrow} onPatch={(ch) => patch(open, ch)} onClose={() => setOpenId(null)} />}
      {rows == null ? <div style={{ color: DS.mut }}>Loading…</div>
        : !list.length ? <Panel style={{ color: DS.mut, borderStyle: "dashed" }}>{rows.length ? "No photos match." : "No photos yet — Sync from website pulls the club's photo library, or upload your own."}</Panel>
        : <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${narrow ? 104 : 160}px, 1fr))`, gap: 8 }}>
            {list.map(p => (
              <button key={p.id} onClick={() => setOpenId(p.id === openId ? null : p.id)} style={{ position: "relative", padding: 0, border: "2px solid " + (p.id === openId ? DS.lime : "transparent"), background: DS.panel2, borderRadius: 8, overflow: "hidden", cursor: "pointer", aspectRatio: "1 / 1", opacity: p.active === false ? 0.5 : 1 }}>
                <img src={p.url} alt={p.alt || ""} crossOrigin="anonymous" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                <div style={{ position: "absolute", left: 4, bottom: 4, right: 4, display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                  {p.line && <span style={{ background: "rgba(6,26,24,0.8)", borderRadius: 4, padding: "0 2px" }}><LineChip line={p.line} /></span>}
                  {p.used_count > 0 && <span style={{ fontSize: 10, color: "#fff", background: "rgba(6,26,24,0.8)", borderRadius: 4, padding: "1px 5px" }}>used {p.used_count}×</span>}
                  {p.source === "upload" && <span style={{ fontSize: 10, color: DS.lime, background: "rgba(6,26,24,0.8)", borderRadius: 4, padding: "1px 5px" }}>upload</span>}
                </div>
              </button>
            ))}
          </div>}
    </div>
  );
}

function PhotoEditor({ p, narrow, onPatch, onClose }) {
  const [alt, setAlt] = useState(p.alt || "");
  useEffect(() => setAlt(p.alt || ""), [p.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const tags = p.tags || [];
  return (
    <Panel style={{ marginBottom: 12, borderColor: DS.lime }}>
      <div style={{ display: narrow ? "block" : "grid", gridTemplateColumns: "260px 1fr", gap: 14 }}>
        <img src={p.url} alt={p.alt || ""} crossOrigin="anonymous" style={{ width: "100%", borderRadius: 8, display: "block", marginBottom: narrow ? 10 : 0 }} />
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Tag color={DS.mut}>{p.source || "site"}</Tag>
            {p.width && <span style={{ fontSize: 12, color: DS.dim }}>{p.width}×{p.height}</span>}
            {p.last_used_at && <span style={{ fontSize: 12, color: DS.dim }}>last used {new Date(p.last_used_at).toLocaleDateString()}</span>}
            <span style={{ flex: 1 }} />
            <Btn small kind="quiet" onClick={onClose} style={narrow ? { minHeight: 38 } : {}}>Close</Btn>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: DS.mut, margin: "12px 0 5px" }}>Line</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {LINES.map(l0 => lineMeta(l0.key)).map(l => <button key={l.key} onClick={() => onPatch({ line: p.line === l.key ? null : l.key })} style={chipStyle(p.line === l.key, l.color, narrow)}>{l.label}</button>)}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: DS.mut, margin: "12px 0 5px" }}>Tags</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PHOTO_TAGS.map(t => <button key={t} onClick={() => onPatch({ tags: tags.includes(t) ? tags.filter(x => x !== t) : [...tags, t] })} style={chipStyle(tags.includes(t), "#7FD1C3", narrow)}>{t}</button>)}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: DS.mut, margin: "12px 0 5px" }}>Description (alt text)</div>
          <input value={alt} onChange={e => setAlt(e.target.value)} onBlur={() => alt !== (p.alt || "") && onPatch({ alt })} placeholder="Kids at a volleyball clinic, Warehouse II" style={{ ...inputStyle, fontSize: narrow ? 16 : 14 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Btn kind={p.active === false ? "primary" : "warn"} onClick={() => onPatch({ active: p.active === false })} style={narrow ? { minHeight: 44 } : {}}>{p.active === false ? "Use this photo again" : "Hide — don't use"}</Btn>
            <a href={p.url} target="_blank" rel="noreferrer" style={{ color: DS.mut, fontSize: 12, alignSelf: "center" }}>Open full size ↗</a>
          </div>
        </div>
      </div>
    </Panel>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────
const CONNECTIONS = [
  ["ai", "AI copywriter", "Claude writes the drafts. Without it the machine uses plain templates."],
  ["facebook", "Facebook Page", "A long-lived Page access token with pages_manage_posts, plus the Page ID."],
  ["instagram", "Instagram", "The Instagram business account linked to the Page (same token, instagram_content_publish)."],
  ["email", "Email (Resend)", "Sends the weekly email from the club's domain with a one-click unsubscribe."],
  ["sms", "Texts", "Uses DSSC Texts campaigns — consent, STOP and do-not-text are handled there."],
];
const TARGETS = [["parents", "Parents"], ["players", "Players (own phones)"], ["both", "Parents + players"]];

export function MarketingSettings({ status, narrow, reloadStatus, onChanged }) {
  const [s, setS] = useState(null);
  const [orig, setOrig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    (async () => {
      let row = status?.settings || null;
      if (!row) {
        const { data, error } = await supabase.from("mkt_settings").select("*").eq("id", 1).maybeSingle();
        if (error) { setMsg({ err: isMissingTable(error) ? MIGRATION_MSG : error.message }); }
        row = data || {};
      }
      const cad = row.cadence || {};
      const v = {
        voice: row.voice || "",
        weights: { ...DEFAULT_WEIGHTS, ...(row.weights || {}) },
        cadence: { social: { ...DEFAULT_CADENCE.social, ...(cad.social || {}) }, email: { ...DEFAULT_CADENCE.email, ...(cad.email || {}) }, sms: { ...DEFAULT_CADENCE.sms, ...(cad.sms || {}) } },
        auto_generate: row.auto_generate !== false,
        generate_day: row.generate_day || "sun",
        notify_emails: (row.notify_emails || ["drew@drippingsportsclub.com"]).join(", "),
        sms_filters: { ...EMPTY_FILTERS, ...(row.sms_filters || {}) },
        email_audience: row.email_audience || { source: "dssc_contacts" },
      };
      setS(v); setOrig(JSON.stringify(v));
    })();
  }, [status]);

  const dirty = s && JSON.stringify(s) !== orig;
  const set = (k, v) => setS(x => ({ ...x, [k]: v }));
  const setCad = (ch, k, v) => setS(x => ({ ...x, cadence: { ...x.cadence, [ch]: { ...x.cadence[ch], [k]: v } } }));
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const emails = s.notify_emails.split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(e => /@/.test(e));
      const patch = { voice: s.voice, weights: s.weights, cadence: s.cadence, auto_generate: s.auto_generate, generate_day: s.generate_day, notify_emails: emails, sms_filters: s.sms_filters, email_audience: s.email_audience };
      await mktApi("settings_save", { patch });
      setOrig(JSON.stringify(s)); setMsg({ ok: "Saved." }); reloadStatus?.(); onChanged?.();
    } catch (e) { setMsg({ err: e.message }); }
    setBusy(false);
  };

  const conn = status?.connections || {};
  const missing = status?.missing || {};
  const lbl = { fontSize: 11, fontWeight: 700, color: DS.mut, margin: "12px 0 5px" };
  const num = { ...inputStyle, width: 80, fontSize: narrow ? 16 : 14 };
  const sel = { ...inputStyle, width: "auto", fontSize: narrow ? 16 : 14, colorScheme: "dark" };

  return (
    <div>
      <Panel style={{ marginBottom: 14 }}>
        <H>Connections</H>
        {!status ? <div style={{ color: DS.mut, fontSize: 13 }}>Checking…</div> : CONNECTIONS.map(([k, label, hint]) => {
          const ok = !!conn[k], need = missing[k] || [];
          return (
            <div key={k} style={{ display: "flex", gap: 10, padding: "9px 0", borderTop: "1px solid " + DS.line, alignItems: "flex-start" }}>
              <span style={{ width: 22, height: 22, borderRadius: 11, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900, background: ok ? DS.lime : "transparent", border: "1px solid " + (ok ? DS.lime : DS.orange), color: ok ? DS.bg : DS.orange }}>{ok ? "✓" : "!"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{label} <span style={{ fontWeight: 400, fontSize: 12, color: ok ? DS.lime : DS.orange }}>{ok ? "connected" : "not connected"}</span></div>
                {!ok && <div style={{ fontSize: 12, color: DS.mut, marginTop: 2, lineHeight: 1.5 }}>{hint}{need.length ? <> Add {need.map((n, i) => <span key={n}>{i ? ", " : ""}<code style={{ color: DS.text, background: DS.panel2, padding: "1px 5px", borderRadius: 4, wordBreak: "break-all" }}>{n}</code></span>)} in Vercel → Settings → Environment Variables, then redeploy.</> : null}</div>}
              </div>
            </div>
          );
        })}
        {status && <div style={{ fontSize: 12, color: DS.dim, marginTop: 8 }}>Step-by-step setup is in MARKETING_SETUP.md in the HQ repo.</div>}
      </Panel>

      {!s ? <div style={{ color: DS.mut }}>Loading…</div> : <>
        <Panel style={{ marginBottom: 14 }}>
          <H>Cadence</H>
          <div style={lbl}>Social posts per week</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="number" min={0} max={14} value={s.cadence.social.per_week} onChange={e => setCad("social", "per_week", Math.max(0, Math.min(14, Number(e.target.value) || 0)))} style={num} />
            <span style={{ fontSize: 12, color: DS.mut }}>at</span>
            <input type="time" value={s.cadence.social.time || "18:30"} onChange={e => setCad("social", "time", e.target.value)} style={sel} />
          </div>
          <div style={lbl}>On these days</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {DAYS.map(d => { const on = (s.cadence.social.days || []).includes(d); return <button key={d} onClick={() => setCad("social", "days", on ? s.cadence.social.days.filter(x => x !== d) : DAYS.filter(x => x === d || (s.cadence.social.days || []).includes(x)))} style={chipStyle(on, DS.lime, narrow)}>{DAY_LABEL[d]}</button>; })}
          </div>
          <div style={lbl}>Weekly email</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select value={s.cadence.email.day || "thu"} onChange={e => setCad("email", "day", e.target.value)} style={sel}>{DAYS.map(d => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}</select>
            <input type="time" value={s.cadence.email.time || "07:30"} onChange={e => setCad("email", "time", e.target.value)} style={sel} />
          </div>
          <div style={lbl}>Texts — at most per month (only for a priority or a last call)</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="number" min={0} max={8} value={s.cadence.sms.per_month} onChange={e => setCad("sms", "per_month", Math.max(0, Math.min(8, Number(e.target.value) || 0)))} style={num} />
            <span style={{ fontSize: 12, color: DS.mut }}>at</span>
            <input type="time" value={s.cadence.sms.time || "17:30"} onChange={e => setCad("sms", "time", e.target.value)} style={sel} />
          </div>
        </Panel>

        <Panel style={{ marginBottom: 14 }}>
          <H>Line weights</H>
          <div style={{ fontSize: 12, color: DS.mut, marginBottom: 8 }}>How much of the feed each line gets over time. 0 = only when a priority or a program signal asks for it.</div>
          {LINES.map(l0 => lineMeta(l0.key)).map(l => (
            <div key={l.key} style={{ display: "grid", gridTemplateColumns: narrow ? "96px 1fr 22px" : "140px minmax(0, 360px) 30px", gap: 10, alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: l.color }}>{l.label}</span>
              <input type="range" min={0} max={5} step={1} value={s.weights[l.key] ?? 0} onChange={e => set("weights", { ...s.weights, [l.key]: Number(e.target.value) })} style={{ width: "100%", accentColor: l.color, height: 30 }} />
              <b style={{ fontSize: 14, textAlign: "right" }}>{s.weights[l.key] ?? 0}</b>
            </div>
          ))}
        </Panel>

        <Panel style={{ marginBottom: 14 }}>
          <H>Brand voice notes</H>
          <div style={{ fontSize: 12, color: DS.mut, marginBottom: 8 }}>Extra guidance the machine reads every time it writes — on top of the club's style guide (local, warm, confident, short; no invented prices or spots-left).</div>
          <Grow value={s.voice} onChange={e => set("voice", e.target.value)} minRows={4} placeholder={'e.g. "Say the Warehouse, not the gym. Mention Coach Chang by name on volleyball pods. Never say cheap."'} style={{ fontSize: narrow ? 16 : 14 }} />
        </Panel>

        <Panel style={{ marginBottom: 14 }}>
          <H>Automation</H>
          <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, cursor: "pointer" }}>
            <input type="checkbox" checked={s.auto_generate} onChange={e => set("auto_generate", e.target.checked)} style={{ width: 22, height: 22, accentColor: DS.lime }} />
            Draft next week automatically
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8, opacity: s.auto_generate ? 1 : 0.5 }}>
            <span style={{ fontSize: 13, color: DS.mut }}>every</span>
            <select disabled={!s.auto_generate} value={s.generate_day} onChange={e => set("generate_day", e.target.value)} style={sel}>{DAYS.map(d => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}</select>
            <span style={{ fontSize: 13, color: DS.mut }}>after 5 pm — nothing is posted until a director approves it.</span>
          </div>
          <div style={lbl}>Email "drafts ready" to</div>
          <input value={s.notify_emails} onChange={e => set("notify_emails", e.target.value)} placeholder="drew@drippingsportsclub.com" style={{ ...inputStyle, fontSize: narrow ? 16 : 14 }} />
          <div style={lbl}>Weekly email goes to</div>
          <div style={{ fontSize: 13 }}>{s.email_audience?.source === "dssc_contacts" ? "Everyone in DSSC People with an email (minus unsubscribes)" : JSON.stringify(s.email_audience)}</div>
        </Panel>

        <Panel style={{ marginBottom: 14 }}>
          <H>Default text audience</H>
          <div style={{ fontSize: 12, color: DS.mut, marginBottom: 8 }}>Who marketing texts go to unless an item says otherwise. Only families who opted in to texts; STOP and do-not-text are respected.</div>
          <div style={lbl}>Who</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{TARGETS.map(([k, l]) => <button key={k} onClick={() => set("sms_filters", { ...s.sms_filters, target: k })} style={chipStyle(s.sms_filters.target === k, DS.lime, narrow)}>{l}</button>)}</div>
          <div style={lbl}>Families in (none = everyone)</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{CATEGORIES.map(c => { const on = (s.sms_filters.categories || []).includes(c); return <button key={c} onClick={() => set("sms_filters", { ...s.sms_filters, categories: on ? s.sms_filters.categories.filter(x => x !== c) : [...(s.sms_filters.categories || []), c] })} style={chipStyle(on, "#7FD1C3", narrow)}>{c}</button>; })}</div>
          <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, cursor: "pointer", marginTop: 10 }}>
            <input type="checkbox" checked={!!s.sms_filters.current} onChange={e => set("sms_filters", { ...s.sms_filters, current: e.target.checked })} style={{ width: 20, height: 20, accentColor: DS.lime }} />
            Only families in a current class
          </label>
        </Panel>

        <div style={{ position: "sticky", bottom: narrow ? 70 : 10, zIndex: 5, display: "flex", gap: 10, alignItems: "center", background: DS.bg, padding: "10px 0", borderTop: dirty ? "1px solid " + DS.line : "none" }}>
          <Btn kind="primary" disabled={!dirty || busy} onClick={save} style={narrow ? { minHeight: 46, fontSize: 15, flex: 1, justifyContent: "center" } : {}}>{busy ? "Saving…" : dirty ? "Save settings" : "Saved"}</Btn>
          <Msg msg={msg} />
        </div>
      </>}
    </div>
  );
}
