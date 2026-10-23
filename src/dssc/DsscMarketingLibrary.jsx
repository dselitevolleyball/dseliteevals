// DSSC Marketing → Photos and Settings.
//
// Photos: the club's photo library - synced from the website's photos.json,
// plus uploads (drag them in; phone photos are scaled to 2000px JPEG before
// they go up). Claude sorts each new photo (api/_lib/marketing-photos-ai.js):
// line, tags, a description to search on, what it's good for, quality, and
// whether kids can be recognized - those wait for a director's "release OK".
// Search and filters find a photo; Copy link / Download / Copy for website
// take it to an email, the website or a Playbook program page.
// Settings: what's connected (and what's missing to connect the rest), the
// cadence, line weights, brand voice notes, auto-generate, who gets the
// "drafts ready" email, and the default text audience.

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Tag, inputStyle, Grow, fetchAll } from "./DsscHub.jsx";
import { CATEGORIES, EMPTY_FILTERS } from "../../shared/campaign-audience.js";
import EmailAudiencePicker from "./DsscEmailAudience.jsx";
import MarketingTiming from "./DsscMarketingTiming.jsx";

const BIO_LINK = "https://www.drippingsportsclub.com/hq/api/links";
import { mktApi, isMissingTable, MIGRATION_MSG, LINES, lineMeta, LineChip, DEFAULT_WEIGHTS, DEFAULT_CADENCE, DAYS, DAY_LABEL, chipStyle, Msg, Panel, H, downscale, isImageFile } from "./DsscMarketingKit.jsx";
import { DEFAULT_RHYTHM, DEFAULT_THEMES, normRhythm } from "../../shared/marketing-plan.js";
import { PHOTO_TAGS_CORE, PHOTO_TAGS_ALL, PHOTO_USES, USE_LABEL, PEOPLE_LABEL, SETTING_LABEL, tagLabel, orientationOf, photoHaystack } from "../../shared/marketing-photos.js";

// ── Photos ──────────────────────────────────────────────────────────────────
// Kids are recognizable and nobody has said it's OK to post them yet.
const needsRelease = (p) => p.minors === true && p.release_ok == null;
const SHAPES = [["portrait", "Tall"], ["landscape", "Wide"], ["square", "Square"]];
const fileNameOf = (p) => (p.filename || String(p.url).split("/").pop().split("?")[0] || "photo.jpg").replace(/[^\w.-]+/g, "-");

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { window.prompt("Copy this:", text); return false; }
}
async function downloadPhoto(p) {
  try {
    const r = await fetch(p.url, { mode: "cors" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const href = URL.createObjectURL(await r.blob());
    const a = Object.assign(document.createElement("a"), { href, download: fileNameOf(p) });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 4000);
  } catch { window.open(p.url, "_blank", "noopener"); }
}
const imgTag = (p) => `<img src="${p.url}" alt="${String(p.alt || p.description || "").replace(/"/g, "&quot;")}"${p.width ? ` width="${p.width}" height="${p.height}"` : ""} loading="lazy">`;

export function MarketingPhotos({ narrow }) {
  const [rows, setRows] = useState(null);
  const [line, setLine] = useState("");
  const [tag, setTag] = useState("");
  const [q, setQ] = useState("");
  const [use, setUse] = useState("");
  const [shape, setShape] = useState("");
  const [minQ, setMinQ] = useState(0);
  const [view, setView] = useState("");          // "" | hidden | release | untagged
  const [sort, setSort] = useState("new");
  const [more, setMore] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  const stop = useRef(false);

  const load = useCallback(async () => {
    try { setRows(await fetchAll(() => supabase.from("mkt_photos").select("*"))); }
    catch (e) { setMsg({ err: isMissingTable(e) ? MIGRATION_MSG : e.message }); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const merge = (list) => setRows(rs => (rs || []).map(r => list.find(x => x.id === r.id) || r));

  const all = rows || [];
  const live = all.filter(p => p.active !== false);
  const counts = { hidden: all.length - live.length, release: live.filter(needsRelease).length, untagged: live.filter(p => !p.ai_at).length };
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = useMemo(() => all.filter(p =>
      (view === "hidden" ? p.active === false : p.active !== false)
      && (view !== "release" || needsRelease(p))
      && (view !== "untagged" || !p.ai_at)
      && (!line || (line === "_none" ? !p.line : p.line === line))
      && (!tag || (p.tags || []).includes(tag))
      && (!use || (p.uses || []).includes(use))
      && (!shape || orientationOf(p) === shape)
      && (!minQ || (p.quality || 0) >= minQ)
      && (!words.length || (h => words.every(w => h.includes(w)))(photoHaystack(p, k => lineMeta(k).label))))
    .sort((a, b) => sort === "best" ? (b.quality || 0) - (a.quality || 0) || String(b.created_at).localeCompare(String(a.created_at))
      : sort === "least" ? (a.used_count || 0) - (b.used_count || 0) : String(b.created_at || "").localeCompare(String(a.created_at || ""))),
  [rows, view, line, tag, use, shape, minQ, q, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = all.find(p => p.id === openId) || null;
  const filtered = !!(line || tag || use || shape || minQ || words.length || view);

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
  // Claude catalogues photos four at a time (ids), or the next untagged ones.
  const catalogue = async (ids, { mode = "fill", label = "" } = {}) => {
    stop.current = false;
    setBusy("ai");
    let done = 0, failed = 0, remaining = null;
    const queue = ids ? ids.slice() : null;
    try {
      for (let round = 0; round < 60 && !stop.current; round++) {
        const chunk = queue ? queue.splice(0, 4) : null;
        if (queue && !chunk.length) break;
        const total = queue ? ids.length : (remaining ?? counts.untagged);
        setMsg({ ok: `${label}AI is sorting your photos… ${done} done${total ? ` of ${queue ? total : done + total}` : ""}. You can keep working.` });
        const d = await mktApi("photos_tag", chunk ? { ids: chunk, mode } : {});
        merge(d.photos || []);
        done += (d.photos || []).length; failed += (d.errors || []).length;
        remaining = d.remaining;
        if (!queue && (!d.remaining || !(d.photos || []).length)) break;
      }
      setMsg(failed ? { err: `${label}AI sorted ${done} photo${done === 1 ? "" : "s"}; ${failed} couldn't be read — open one and press Re-run AI.` } : { ok: `${label}AI sorted ${done} photo${done === 1 ? "" : "s"}${remaining ? ` — ${remaining} still to go` : ""}. Check the ones marked "kids — release?" before they're posted.` });
    } catch (e) {
      setMsg({ err: (label ? label + " " : "") + (e.status === 503 ? "The AI isn't connected yet (ANTHROPIC_API_KEY) — tag these by hand for now." : e.message) });
    }
    setBusy(""); load();
  };
  const upload = async (files) => {
    files = [...(files || [])].filter(isImageFile);
    if (!files.length) { setMsg({ err: "Those aren't photos — drop JPG, PNG or WebP files." }); return; }
    setBusy("upload"); setMsg(null);
    const made = []; const errs = [];
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
        const ins = await supabase.from("mkt_photos").insert({ url, source: "upload", key: path, filename: f.name, tags: tag ? [tag] : [], line: line && line !== "_none" ? line : null, alt: f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "), width: w, height: h, active: true }).select("*").single();
        if (ins.error) throw new Error(ins.error.message);
        made.push(ins.data);
      } catch (e) { errs.push(`${f.name}: ${e.message}`); }
    }
    if (fileRef.current) fileRef.current.value = "";
    setRows(rs => [...made, ...(rs || [])]);
    setBusy("");
    if (errs.length) setMsg({ err: `Uploaded ${made.length} of ${files.length}.\n${errs.join("\n")}` });
    if (made.length) await catalogue(made.map(p => p.id), { label: `Uploaded ${made.length}. ` });
  };
  const onDrop = (e) => { e.preventDefault(); setDrag(false); if (!busy) upload(e.dataTransfer?.files); };

  const lbl = { fontSize: 11, fontWeight: 700, color: DS.mut };
  const sel = { ...inputStyle, width: "auto", fontSize: narrow ? 16 : 13, padding: "7px 9px", colorScheme: "dark" };
  return (
    <div onDragOver={e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); setDrag(true); } }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); }} onDrop={onDrop} style={{ position: "relative" }}>
      {drag && <div style={{ position: "absolute", inset: -6, zIndex: 20, border: "3px dashed " + DS.lime, borderRadius: 14, background: "rgba(16,73,70,0.88)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, color: DS.lime, pointerEvents: "none" }}>Drop photos to upload — AI sorts them</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 13, color: DS.mut, flex: 1, minWidth: 220, lineHeight: 1.5 }}>
          {rows ? <>{live.length} photos{counts.untagged ? <> · <b style={{ color: DS.text }}>{counts.untagged}</b> not sorted by AI yet</> : " · all sorted by AI"}{counts.hidden ? ` · ${counts.hidden} hidden` : ""}.</> : ""}
          <span style={{ color: DS.dim }}> {narrow ? "Upload" : "Drag photos here or upload"} — AI files each one by program, what's in it and what it's good for.</span>
        </div>
        {busy === "ai" ? <Btn kind="quiet" onClick={() => { stop.current = true; }} style={narrow ? { minHeight: 44 } : {}}>Stop AI</Btn>
          : counts.untagged > 0 && <Btn kind="ghost" disabled={!!busy} onClick={() => catalogue(null)} style={narrow ? { minHeight: 44 } : {}}>Sort {counts.untagged} with AI</Btn>}
        <Btn kind="ghost" disabled={!!busy} onClick={sync} style={narrow ? { minHeight: 44 } : {}}>{busy === "sync" ? "Syncing…" : "Sync from website"}</Btn>
        <Btn kind="primary" disabled={!!busy} onClick={() => fileRef.current?.click()} style={narrow ? { minHeight: 44 } : {}}>{busy === "upload" ? "Uploading…" : "Upload photos"}</Btn>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => upload(e.target.files)} />
      </div>
      <Msg msg={msg} style={{ marginBottom: 10 }} />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder='Search — "girls volleyball action", "party", "camp kids"' style={{ ...inputStyle, flex: "1 1 240px", fontSize: narrow ? 16 : 14 }} />
        <select value={sort} onChange={e => setSort(e.target.value)} style={sel} aria-label="Sort">
          <option value="new">Newest first</option><option value="best">Best quality first</option><option value="least">Least used first</option>
        </select>
        <Btn kind={more ? "primary" : "quiet"} small onClick={() => setMore(m => !m)} style={narrow ? { minHeight: 40 } : {}}>{more ? "Fewer filters" : "More filters"}</Btn>
      </div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6 }}>
        <button onClick={() => setLine("")} style={chipStyle(!line, DS.lime, narrow)}>All lines</button>
        {LINES.map(l0 => lineMeta(l0.key)).map(l => <button key={l.key} onClick={() => setLine(line === l.key ? "" : l.key)} style={chipStyle(line === l.key, l.color, narrow)}>{l.label}</button>)}
        <button onClick={() => setLine(line === "_none" ? "" : "_none")} style={chipStyle(line === "_none", DS.mut, narrow)}>No line</button>
      </div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, marginBottom: 4 }}>
        {counts.release > 0 && <button onClick={() => setView(view === "release" ? "" : "release")} style={chipStyle(view === "release", DS.orange, narrow)}>Kids — release? ({counts.release})</button>}
        {counts.untagged > 0 && <button onClick={() => setView(view === "untagged" ? "" : "untagged")} style={chipStyle(view === "untagged", "#60A5FA", narrow)}>Not sorted ({counts.untagged})</button>}
        <button onClick={() => setView(view === "hidden" ? "" : "hidden")} style={chipStyle(view === "hidden", DS.orange, narrow)}>{view === "hidden" ? "Showing hidden" : "Hidden"}</button>
        {(more ? PHOTO_TAGS_ALL : PHOTO_TAGS_CORE).map(t => <button key={t} onClick={() => setTag(tag === t ? "" : t)} style={chipStyle(tag === t, "#7FD1C3", narrow)}>{tagLabel(t)}</button>)}
      </div>
      {more && <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "4px 0 8px" }}>
        <span style={lbl}>Good for</span>
        <select value={use} onChange={e => setUse(e.target.value)} style={sel}><option value="">Anything</option>{PHOTO_USES.map(u => <option key={u} value={u}>{USE_LABEL[u]}</option>)}</select>
        <span style={lbl}>Shape</span>
        <select value={shape} onChange={e => setShape(e.target.value)} style={sel}><option value="">Any</option>{SHAPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <span style={lbl}>Quality</span>
        <select value={minQ} onChange={e => setMinQ(Number(e.target.value))} style={sel}><option value={0}>Any</option><option value={3}>3+ usable</option><option value={4}>4+ strong</option><option value={5}>5 best</option></select>
        {filtered && <Btn small kind="link" onClick={() => { setLine(""); setTag(""); setUse(""); setShape(""); setMinQ(0); setQ(""); setView(""); }}>Clear all</Btn>}
      </div>}

      {open && <PhotoEditor p={open} narrow={narrow} busy={busy} onPatch={(ch) => patch(open, ch)} onRerun={() => catalogue([open.id], { mode: "replace" })} onClose={() => setOpenId(null)} />}
      {rows == null ? <div style={{ color: DS.mut }}>Loading…</div>
        : !list.length ? <Panel style={{ color: DS.mut, borderStyle: "dashed", textAlign: "center", padding: 28 }}>{all.length ? "No photos match." : <>No photos yet. Drag photos here, press <b>Upload photos</b>, or <b>Sync from website</b> to pull in the club's photo library.</>}</Panel>
        : <>
          {filtered && <div style={{ fontSize: 12, color: DS.dim, marginBottom: 6 }}>{list.length} match{list.length === 1 ? "" : "es"}</div>}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${narrow ? 104 : 160}px, 1fr))`, gap: 8 }}>
            {list.map(p => (
              <button key={p.id} onClick={() => setOpenId(p.id === openId ? null : p.id)} title={p.description || p.alt || ""} style={{ position: "relative", padding: 0, border: "2px solid " + (p.id === openId ? DS.lime : needsRelease(p) ? DS.orange : "transparent"), background: DS.panel2, borderRadius: 8, overflow: "hidden", cursor: "pointer", aspectRatio: "1 / 1", opacity: p.active === false || p.release_ok === false ? 0.5 : 1 }}>
                <img src={p.url} alt={p.alt || ""} crossOrigin="anonymous" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                <div style={{ position: "absolute", left: 4, top: 4, right: 4, display: "flex", gap: 4, justifyContent: "space-between" }}>
                  {p.quality ? <span style={pill(p.quality >= 4 ? DS.lime : "#fff")}>{"★".repeat(p.quality)}</span> : !p.ai_at ? <span style={pill("#60A5FA")}>not sorted</span> : <span />}
                  {needsRelease(p) ? <span style={pill(DS.orange)}>kids — release?</span> : p.release_ok === false ? <span style={pill(DS.orange)}>don't post</span> : null}
                </div>
                <div style={{ position: "absolute", left: 4, bottom: 4, right: 4, display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                  {p.line && <span style={{ background: "rgba(6,26,24,0.8)", borderRadius: 4, padding: "0 2px" }}><LineChip line={p.line} /></span>}
                  {p.used_count > 0 && <span style={pill("#fff")}>used {p.used_count}×</span>}
                  {p.source === "upload" && <span style={pill(DS.lime)}>upload</span>}
                </div>
              </button>
            ))}
          </div>
        </>}
    </div>
  );
}
const pill = (color) => ({ fontSize: 10, fontWeight: 700, color, background: "rgba(6,26,24,0.82)", borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap" });

function PhotoEditor({ p, narrow, busy, onPatch, onRerun, onClose }) {
  const [alt, setAlt] = useState(p.alt || "");
  const [desc, setDesc] = useState(p.description || "");
  const [copied, setCopied] = useState("");
  useEffect(() => { setAlt(p.alt || ""); setDesc(p.description || ""); setCopied(""); }, [p.id, p.alt, p.description]);
  const tags = p.tags || [], uses = p.uses || [];
  const extraTags = tags.filter(t => !PHOTO_TAGS_ALL.includes(t));
  const sub = { fontSize: 11, fontWeight: 700, color: DS.mut, margin: "12px 0 5px" };
  const big = narrow ? { minHeight: 44 } : {};
  const copy = async (what, text) => { await copyText(text); setCopied(what); setTimeout(() => setCopied(c => c === what ? "" : c), 2000); };
  return (
    <Panel style={{ marginBottom: 12, borderColor: needsRelease(p) ? DS.orange : DS.lime }}>
      <div style={{ display: narrow ? "block" : "grid", gridTemplateColumns: "300px 1fr", gap: 16 }}>
        <div style={{ marginBottom: narrow ? 10 : 0 }}>
          <img src={p.url} alt={p.alt || ""} crossOrigin="anonymous" style={{ width: "100%", borderRadius: 8, display: "block" }} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <Btn small kind="ghost" onClick={() => copy("link", p.url)} style={big}>{copied === "link" ? "Copied ✓" : "Copy link"}</Btn>
            <Btn small kind="ghost" onClick={() => downloadPhoto(p)} style={big}>Download</Btn>
            <Btn small kind="ghost" onClick={() => copy("html", imgTag(p))} style={big} title="An <img> tag with the alt text, for the website or an email">{copied === "html" ? "Copied ✓" : "Copy for website"}</Btn>
          </div>
          <div style={{ fontSize: 11, color: DS.dim, marginTop: 6, lineHeight: 1.5 }}>The link is permanent and public — paste it into an email, the website or a Playbook program page.</div>
        </div>
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Tag color={DS.mut}>{p.source || "site"}</Tag>
            {p.width && <span style={{ fontSize: 12, color: DS.dim }}>{p.width}×{p.height} · {SHAPES.find(([k]) => k === orientationOf(p))?.[1] || ""}</span>}
            {p.quality ? <span style={{ fontSize: 12, color: DS.lime }}>{"★".repeat(p.quality)}<span style={{ color: DS.dim }}>{"★".repeat(5 - p.quality)}</span></span> : null}
            {p.last_used_at && <span style={{ fontSize: 12, color: DS.dim }}>last used {new Date(p.last_used_at).toLocaleDateString()}</span>}
            <span style={{ flex: 1 }} />
            <Btn small kind="quiet" onClick={onClose} style={big}>Close</Btn>
          </div>

          {p.minors === true && (
            <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, border: "1px solid " + (p.release_ok === true ? DS.lime : DS.orange), background: p.release_ok === true ? DS.limeSoft : DS.orangeSoft }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: p.release_ok === true ? DS.lime : DS.orange }}>{p.release_ok === true ? "Kids in this photo — release confirmed" : p.release_ok === false ? "Kids in this photo — marked don't post" : "Kids can be recognized in this photo"}</div>
              <div style={{ fontSize: 12, color: DS.mut, margin: "3px 0 8px" }}>Only post it if the families have agreed (registration photo release). The machine never uses a "don't post" photo.</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Btn small kind={p.release_ok === true ? "primary" : "ghost"} onClick={() => onPatch({ release_ok: true })} style={big}>Release OK — can post</Btn>
                <Btn small kind={p.release_ok === false ? "warn" : "ghost"} onClick={() => onPatch({ release_ok: false })} style={big}>Don't post publicly</Btn>
              </div>
            </div>
          )}
          {p.minors !== true && p.release_ok === false && <div style={{ marginTop: 10 }}><Btn small kind="ghost" onClick={() => onPatch({ release_ok: null })} style={big}>Allow posting again</Btn></div>}

          <div style={sub}>What's in it {p.ai_at ? <span style={{ fontWeight: 400, color: DS.dim }}>· {p.ai_error ? "AI couldn't read it: " + p.ai_error : "sorted by AI " + new Date(p.ai_at).toLocaleDateString()}</span> : <span style={{ fontWeight: 400, color: DS.dim }}>· not sorted by AI yet</span>}</div>
          <Grow value={desc} onChange={e => setDesc(e.target.value)} onBlur={() => desc !== (p.description || "") && onPatch({ description: desc || null })} minRows={2} placeholder="Two girls bump-passing at a youth volleyball clinic" style={{ fontSize: narrow ? 16 : 14 }} />
          {(p.people || p.setting) && <div style={{ fontSize: 12, color: DS.mut, marginTop: 4 }}>{[PEOPLE_LABEL[p.people], SETTING_LABEL[p.setting]].filter(Boolean).join(" · ")}</div>}

          <div style={sub}>Line</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {LINES.map(l0 => lineMeta(l0.key)).map(l => <button key={l.key} onClick={() => onPatch({ line: p.line === l.key ? null : l.key })} style={chipStyle(p.line === l.key, l.color, narrow)}>{l.label}</button>)}
          </div>
          <div style={sub}>Good for</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PHOTO_USES.map(u => <button key={u} onClick={() => onPatch({ uses: uses.includes(u) ? uses.filter(x => x !== u) : [...uses, u] })} style={chipStyle(uses.includes(u), DS.lime, narrow)}>{USE_LABEL[u]}</button>)}
          </div>
          <div style={sub}>Tags</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[...PHOTO_TAGS_ALL, ...extraTags].map(t => <button key={t} onClick={() => onPatch({ tags: tags.includes(t) ? tags.filter(x => x !== t) : [...tags, t] })} style={chipStyle(tags.includes(t), "#7FD1C3", narrow)}>{tagLabel(t)}</button>)}
          </div>
          <div style={sub}>Alt text (for screen readers and the website)</div>
          <input value={alt} onChange={e => setAlt(e.target.value)} onBlur={() => alt !== (p.alt || "") && onPatch({ alt })} placeholder="Kids at a volleyball clinic at the Warehouse" style={{ ...inputStyle, fontSize: narrow ? 16 : 14 }} />
          <div style={sub}>Quality</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[1, 2, 3, 4, 5].map(n => <button key={n} onClick={() => onPatch({ quality: p.quality === n ? null : n })} style={chipStyle(p.quality === n, DS.lime, narrow)}>{n}★</button>)}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
            <Btn kind="ghost" disabled={!!busy} onClick={onRerun} style={big} title="Claude looks again and replaces the line, tags and alt text">{busy === "ai" ? "AI is working…" : p.ai_at ? "Re-run AI" : "Sort with AI"}</Btn>
            <Btn kind={p.active === false ? "primary" : "warn"} onClick={() => onPatch({ active: p.active === false })} style={big}>{p.active === false ? "Use this photo again" : "Hide — don't use"}</Btn>
            <a href={p.url} target="_blank" rel="noreferrer" style={{ color: DS.mut, fontSize: 12 }}>Open full size ↗</a>
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
        plan_ahead: Number.isFinite(+row.plan_ahead) ? +row.plan_ahead : 2,
        notify_emails: (row.notify_emails || ["drew@drippingsportsclub.com"]).join(", "),
        sms_filters: { ...EMPTY_FILTERS, ...(row.sms_filters || {}) },
        email_audience: row.email_audience || { source: "dssc_contacts" },
        themes: Object.fromEntries(Object.entries(row.themes || {}).map(([k, v]) => [k, Array.isArray(v) ? v.join("\n") : String(v || "")])),
        flair: Number.isFinite(+row.flair) ? +row.flair : 1,
        scout: { enabled: true, day: "sat", web: true, spotlight_every_weeks: 2, via: ["email", "sms"], ...(row.scout || {}) },
      };
      v.cadence.social.rhythm = normRhythm(v.cadence.social.rhythm);
      setS(v); setOrig(JSON.stringify(v));
    })();
  }, [status]);

  const dirty = s && JSON.stringify(s) !== orig;
  const set = (k, v) => setS(x => ({ ...x, [k]: v }));
  const setCad = (ch, k, v) => setS(x => ({ ...x, cadence: { ...x.cadence, [ch]: { ...x.cadence[ch], [k]: v } } }));
  const rhythm = s?.cadence.social.rhythm || [];
  const setRhythm = (r) => setCad("social", "rhythm", r);
  const setEntry = (i, ch) => setRhythm(rhythm.map((e, j) => { if (j !== i) return e; const n = { ...e, ...ch }; for (const k of Object.keys(n)) if (n[k] === undefined) delete n[k]; return n; }));
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const emails = s.notify_emails.split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(e => /@/.test(e));
      const themes = Object.fromEntries(Object.entries(s.themes || {}).map(([k, v]) => [k, String(v || "").split("\n").map(x => x.trim()).filter(Boolean)]));
      const patch = { voice: s.voice, weights: s.weights, cadence: s.cadence, themes, flair: s.flair, scout: s.scout, auto_generate: s.auto_generate, generate_day: s.generate_day, plan_ahead: s.plan_ahead, notify_emails: emails, sms_filters: s.sms_filters, email_audience: s.email_audience };
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
        <div style={{ fontSize: 13, color: DS.mut, marginTop: 10, lineHeight: 1.5 }}>Instagram bio link — set it once (Instagram → Edit profile → Links): <b style={{ color: DS.text, userSelect: "all" }}>{BIO_LINK}</b>. Instagram captions can't hold a tappable link, so posts say "link in bio"; that page shows each post with its own sign-up button.</div>
        {status && <div style={{ fontSize: 12, color: DS.dim, marginTop: 8 }}>Step-by-step setup is in MARKETING_SETUP.md in the HQ repo.</div>}
      </Panel>

      {!s ? <div style={{ color: DS.mut }}>Loading…</div> : <>
        <MarketingTiming cadence={s.cadence} narrow={narrow} onApplied={(cad) => { const v = { ...s, cadence: { social: { ...s.cadence.social, ...cad.social, rhythm: normRhythm(cad.social?.rhythm || s.cadence.social.rhythm) }, email: { ...s.cadence.email, ...cad.email }, sms: { ...s.cadence.sms, ...cad.sms } } }; setS(v); setOrig(JSON.stringify(v)); reloadStatus?.(); onChanged?.(); }} />
        <Panel style={{ marginBottom: 14 }}>
          <H>Weekly rhythm</H>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            <button onClick={() => setCad("social", "mode", "rhythm")} style={chipStyle(s.cadence.social.mode !== "balance", DS.lime, narrow)}>Follow our calendar</button>
            <button onClick={() => setCad("social", "mode", "balance")} style={chipStyle(s.cadence.social.mode === "balance", DS.lime, narrow)}>Balance automatically</button>
          </div>
          <div style={{ fontSize: 12, color: DS.mut, lineHeight: 1.5 }}>{s.cadence.social.mode === "balance"
            ? "The machine spreads the week's posts across the lines by weight, priorities and what's starting soon."
            : "Each day belongs to a line (or a few — the machine picks the best of them that week). A follow-up story breaks the day before's post out program by program. A priority still gets its line onto a day that lists it."}</div>
          {s.cadence.social.mode !== "balance" ? <>
            {rhythm.map((e, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap", padding: "10px 0", borderTop: "1px solid " + DS.line, marginTop: i ? 0 : 10 }}>
                <select value={e.day} onChange={ev => setEntry(i, { day: ev.target.value })} style={sel} aria-label="Day">{DAYS.map(d => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}</select>
                <select value={e.follow ? "follow" : e.format} onChange={ev => setEntry(i, ev.target.value === "follow" ? { follow: rhythm.find((m, j) => j < i && !m.follow)?.day || "mon", format: "story", lines: undefined } : { follow: undefined, format: ev.target.value, lines: e.lines || [] })} style={sel} aria-label="Kind">
                  <option value="post">Post</option><option value="story">Story</option><option value="follow">Follow-up story</option>
                </select>
                {e.follow ? <>
                  <span style={{ fontSize: 13, color: DS.mut, alignSelf: "center" }}>follows the post on</span>
                  <select value={e.follow} onChange={ev => setEntry(i, { follow: ev.target.value })} style={sel}>{DAYS.filter(d => rhythm.some(m => !m.follow && m.day === d)).map(d => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}</select>
                </> : (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", flex: "1 1 260px" }}>
                    {LINES.map(l0 => lineMeta(l0.key)).map(l => { const on = (e.lines || []).includes(l.key); return <button key={l.key} onClick={() => setEntry(i, { lines: on ? e.lines.filter(x => x !== l.key) : [...(e.lines || []), l.key] })} style={chipStyle(on, l.color)}>{l.label}</button>; })}
                    {!(e.lines || []).length && <span style={{ fontSize: 12, color: DS.dim, alignSelf: "center" }}>any line</span>}
                  </div>
                )}
                <input type="time" value={e.time || s.cadence.social.time || "18:30"} onChange={ev => setEntry(i, { time: ev.target.value || undefined })} style={sel} aria-label="Time" title="When this day's item goes out" />
                <Btn small kind="quiet" onClick={() => setRhythm(rhythm.filter((_, j) => j !== i))} style={narrow ? { minHeight: 38 } : {}} aria-label="Remove">✕</Btn>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <Btn small kind="ghost" onClick={() => setRhythm([...rhythm, { day: DAYS.find(d => !rhythm.some(e => e.day === d)) || "sat", lines: [], format: "post" }])} style={narrow ? { minHeight: 40 } : {}}>+ Add a day</Btn>
              <Btn small kind="quiet" onClick={() => setRhythm(DEFAULT_RHYTHM.map(e => ({ ...e, ...(e.lines ? { lines: e.lines.slice() } : {}) })))} style={narrow ? { minHeight: 40 } : {}}>Reset to the club calendar</Btn>
            </div>
            <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, cursor: "pointer", marginTop: 12, flexWrap: "wrap" }}>
              <input type="checkbox" checked={s.cadence.social.month_preview !== false} onChange={ev => setCad("social", "month_preview", ev.target.checked)} style={{ width: 20, height: 20, accentColor: DS.lime }} />
              "What's coming next month" post on the last
              <select disabled={s.cadence.social.month_preview === false} value={s.cadence.social.preview_day || "sat"} onChange={ev => setCad("social", "preview_day", ev.target.value)} style={sel}>{DAYS.map(d => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}</select>
              of the month
            </label>
          </> : <>
            <div style={lbl}>Social posts per week</div>
            <input type="number" min={0} max={14} value={s.cadence.social.per_week} onChange={e => setCad("social", "per_week", Math.max(0, Math.min(14, Number(e.target.value) || 0)))} style={num} />
            <div style={lbl}>On these days</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {DAYS.map(d => { const on = (s.cadence.social.days || []).includes(d); return <button key={d} onClick={() => setCad("social", "days", on ? s.cadence.social.days.filter(x => x !== d) : DAYS.filter(x => x === d || (s.cadence.social.days || []).includes(x)))} style={chipStyle(on, DS.lime, narrow)}>{DAY_LABEL[d]}</button>; })}
            </div>
          </>}
          <div style={lbl}>Other posts go out at (a day above with its own time keeps it)</div>
          <input type="time" value={s.cadence.social.time || "18:30"} onChange={e => setCad("social", "time", e.target.value)} style={sel} />
        </Panel>

        <Panel style={{ marginBottom: 14 }}>
          <H>Email and texts</H>
          <div style={lbl}>Weekly email — what's happening now and what's coming</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select value={s.cadence.email.day || "tue"} onChange={e => setCad("email", "day", e.target.value)} style={sel}>{DAYS.map(d => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}</select>
            <input type="time" value={s.cadence.email.time || "07:30"} onChange={e => setCad("email", "time", e.target.value)} style={sel} />
          </div>
          <div style={lbl}>Dedicated emails — one line each (a priority's line, or the next one due below)</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: DS.mut }}>up to</span>
            <input type="number" min={0} max={8} value={s.cadence.email.dedicated_per_month ?? 2} onChange={e => setCad("email", "dedicated_per_month", Math.max(0, Math.min(8, Number(e.target.value) || 0)))} style={num} />
            <span style={{ fontSize: 12, color: DS.mut }}>a month, on</span>
            <select value={s.cadence.email.dedicated_day || "fri"} onChange={e => setCad("email", "dedicated_day", e.target.value)} style={sel}>{DAYS.map(d => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}</select>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {LINES.map(l0 => lineMeta(l0.key)).map(l => { const on = (s.cadence.email.dedicated_lines || []).includes(l.key); return <button key={l.key} onClick={() => setCad("email", "dedicated_lines", on ? s.cadence.email.dedicated_lines.filter(x => x !== l.key) : [...(s.cadence.email.dedicated_lines || []), l.key])} style={chipStyle(on, l.color, narrow)}>{l.label}</button>; })}
          </div>
          <div style={{ fontSize: 12, color: DS.dim, marginTop: 4 }}>Each line picked here gets its own email about once a month.</div>
          <div style={lbl}>Texts — at most per month (only for a priority or a last call)</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="number" min={0} max={8} value={s.cadence.sms.per_month} onChange={e => setCad("sms", "per_month", Math.max(0, Math.min(8, Number(e.target.value) || 0)))} style={num} />
            <span style={{ fontSize: 12, color: DS.mut }}>at</span>
            <input type="time" value={s.cadence.sms.time || "17:30"} onChange={e => setCad("sms", "time", e.target.value)} style={sel} />
          </div>
        </Panel>

        <Panel style={{ marginBottom: 14 }}>
          <H>Flair and the idea scout</H>
          <div style={lbl}>How much personality the copy gets</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[[0, "Plain"], [1, "Some personality"], [2, "Bold & fun"]].map(([n, l]) => <button key={n} onClick={() => set("flair", n)} style={chipStyle(s.flair === n, DS.lime, narrow)}>{l}</button>)}
          </div>
          <div style={{ fontSize: 12, color: DS.dim, marginTop: 4 }}>{["Clear and warm, no gimmicks.", "A scroll-stopping first line and a fun format (POV, this-or-that, countdowns) when it fits.", "Hooks every time, playful formats, wordplay and energy. Facts never bend."][s.flair] || ""}</div>
          <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, cursor: "pointer", marginTop: 14, flexWrap: "wrap" }}>
            <input type="checkbox" checked={s.scout.enabled !== false} onChange={e => set("scout", { ...s.scout, enabled: e.target.checked })} style={{ width: 20, height: 20, accentColor: DS.lime }} />
            Suggest ideas every
            <select disabled={s.scout.enabled === false} value={s.scout.day || "sat"} onChange={e => set("scout", { ...s.scout, day: e.target.value })} style={sel}>{DAYS.map(d => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}</select>
            morning and email them
          </label>
          <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, cursor: "pointer", marginTop: 8 }}>
            <input type="checkbox" checked={s.scout.web !== false} onChange={e => set("scout", { ...s.scout, web: e.target.checked })} style={{ width: 20, height: 20, accentColor: DS.lime }} />
            Look up what's happening around Dripping Springs (web search)
          </label>
          <div style={lbl}>"Meet the Coaches" — line up the next coach every</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="number" min={0} max={12} value={s.scout.spotlight_every_weeks ?? 2} onChange={e => set("scout", { ...s.scout, spotlight_every_weeks: Math.max(0, Math.min(12, Number(e.target.value) || 0)) })} style={num} />
            <span style={{ fontSize: 12, color: DS.mut }}>weeks (0 = only when you start one) · send interviews by</span>
            {[["email", "Email"], ["sms", "Text"]].map(([k, l]) => { const on = (s.scout.via || []).includes(k); return <button key={k} onClick={() => set("scout", { ...s.scout, via: on ? s.scout.via.filter(x => x !== k) : [...(s.scout.via || []), k] })} style={chipStyle(on, DS.lime, narrow)}>{l}</button>; })}
          </div>
          <div style={{ fontSize: 12, color: DS.dim, marginTop: 4 }}>Interviews only go out when a director presses Send (in HQ or the one-tap button in the ideas email).</div>
        </Panel>

        <Panel style={{ marginBottom: 14 }}>
          <H>Content ideas</H>
          <div style={{ fontSize: 12, color: DS.mut, marginBottom: 8, lineHeight: 1.5 }}>The angles the machine rotates through for each line, one per line of text — from the notes in the club's marketing calendar. Leave a box empty to use the calendar's ideas (shown in grey). Facts still come only from the programs feed.</div>
          {LINES.map(l0 => lineMeta(l0.key)).map(l => (
            <div key={l.key} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: l.color, marginBottom: 4 }}>{l.label}</div>
              <Grow value={s.themes[l.key] || ""} onChange={e => set("themes", { ...s.themes, [l.key]: e.target.value })} minRows={2} placeholder={(DEFAULT_THEMES[l.key] || []).join("\n")} style={{ fontSize: narrow ? 16 : 13 }} />
            </div>
          ))}
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
            Keep the coming weeks drafted automatically
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8, opacity: s.auto_generate ? 1 : 0.5 }}>
            <span style={{ fontSize: 13, color: DS.mut }}>always have</span>
            <select disabled={!s.auto_generate} value={s.plan_ahead} onChange={e => set("plan_ahead", +e.target.value)} style={sel}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} week{n === 1 ? "" : "s"}</option>)}</select>
            <span style={{ fontSize: 13, color: DS.mut }}>ahead drafted and waiting on the Calendar — posts, the weekly email and texts.</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8, opacity: s.auto_generate ? 1 : 0.5 }}>
            <span style={{ fontSize: 13, color: DS.mut }}>Remind me every</span>
            <select disabled={!s.auto_generate} value={s.generate_day} onChange={e => set("generate_day", e.target.value)} style={sel}>{DAYS.map(d => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}</select>
            <span style={{ fontSize: 13, color: DS.mut }}>after 5 pm if next week still has drafts waiting. Nothing is posted until a director approves it.</span>
          </div>
          <div style={lbl}>Email "drafts ready" to</div>
          <input value={s.notify_emails} onChange={e => set("notify_emails", e.target.value)} placeholder="drew@drippingsportsclub.com" style={{ ...inputStyle, fontSize: narrow ? 16 : 14 }} />
          <div style={lbl}>Weekly email goes to</div>
          <EmailAudiencePicker value={s.email_audience} onChange={v => set("email_audience", v || { source: "dssc_contacts" })} narrow={narrow} />
          <div style={{ fontSize: 12, color: DS.dim, marginTop: 4 }}>{s.email_audience?.source === "directors" ? "Marketing emails go only to the directors until you switch this." : "New emails start with this audience; each email can be changed before you approve it. Unsubscribed and bounced addresses are always left out."}</div>
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
