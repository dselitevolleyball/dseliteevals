// DSSC Marketing → Videos. Drop in videos (Meta glasses, phones); each one
// uploads resumably straight to the private marketing-video bucket, then the
// server sorts it - contact sheets, and Claude picks the moments worth posting
// (api/marketing-video.js upload_done). Play any moment, tick the ones you
// like (across videos) and "Make a reel", or let the machine cut "the best of
// the last 3 weeks". Kids-visible videos wait for a release OK. The music
// library holds tracks the club has the rights to.
//
// Collections (Drew, Oct 29 2026): group the videos from one session (six
// from a Hitting Pod) and have Claude plan a couple of reels across all of
// them - each idea is a set of moments from any of the videos, made into a
// reel draft with one press (api/marketing-video.js collection_plan / _reel).

import { useState, useEffect, useRef, useCallback } from "react";
import * as tus from "tus-js-client";
import { supabase } from "../supabase";
import { DS, Btn, Tag, inputStyle } from "./DsscHub.jsx";
import { videoApi, mktApi, isMissingTable, LINES, lineMeta, LineChip, chipStyle, Msg, Panel, H, VideoBox } from "./DsscMarketingKit.jsx";

const RAW = "marketing-video";
const MOODS = ["upbeat", "hype", "chill", "warm", "epic", "fun"];
const fmtT = (s) => { const n = Math.max(0, +s || 0); return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`; };
const fmtMB = (b) => b ? (b / 1048576 >= 1024 ? (b / 1073741824).toFixed(1) + " GB" : Math.round(b / 1048576) + " MB") : "";
const isVideo = (f) => /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm)$/i.test(f.name);
const needsRelease = (v) => v.minors === true && v.release_ok == null;
const big = (narrow) => narrow ? { minHeight: 44 } : {};

function tusUpload(file, path, token, onPct) {
  const base = String(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
  return new Promise((resolve, reject) => {
    const up = new tus.Upload(file, {
      endpoint: `${base}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${token}`, "x-upsert": "false" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: { bucketName: RAW, objectName: path, contentType: file.type || (/\.mov$/i.test(file.name) ? "video/quicktime" : "video/mp4"), cacheControl: "3600" },
      chunkSize: 6 * 1024 * 1024,   // Supabase's resumable uploads take 6 MB chunks
      // A big video on gym wifi can outlast the 1-hour sign-in: each request gets the current one.
      onBeforeRequest: async (req) => { const { data: { session } } = await supabase.auth.getSession(); if (session?.access_token) req.setHeader("authorization", `Bearer ${session.access_token}`); },
      // Say what the storage server said (status + its message), not tus's long request dump.
      onError: (e) => {
        const status = e?.originalResponse?.getStatus?.(), body = String(e?.originalResponse?.getBody?.() || "").slice(0, 160);
        const raw = String(e?.message || e);
        reject(new Error(status === 413 || /maximum size|too large/i.test(body + raw) ? "This video is over the 10 GB upload limit - record at 1080p or 4K at 30 fps, or trim it"
          : status === 401 || /jwt|exp/i.test(body) ? "Your sign-in ran out - refresh HQ and upload again (it picks up where it stopped)"
          : status ? `Storage said ${status}${body ? `: ${body}` : ""}`
          : /network|failed to fetch|offline|timeout/i.test(raw) ? "The connection dropped - upload again and it picks up where it stopped" : raw.split("\n")[0].slice(0, 200)));
      },
      onProgress: (sent, total) => onPct(Math.round((sent / total) * 100)),
      onSuccess: () => resolve(),
    });
    up.findPreviousUploads().then((prev) => { if (prev.length) up.resumeFromPreviousUpload(prev[0]); up.start(); });
  });
}

export default function MarketingVideos({ narrow, onOpenWeek, onChanged }) {
  const [videos, setVideos] = useState(null);
  const [ups, setUps] = useState([]);              // [{ key, name, pct, state, error }]
  const [openId, setOpenId] = useState(null);
  const [picks, setPicks] = useState([]);          // [{ video_id, moment_id, label, thumb_url }]
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState("");
  const [drag, setDrag] = useState(false);
  const [glasses, setGlasses] = useState(true);
  const [colls, setColls] = useState(null);
  const [collId, setCollId] = useState(null);      // the open collection
  const [adding, setAdding] = useState(false);     // tapping a video adds it to the open collection
  const fileRef = useRef(null);
  const upInto = useRef(null);                     // collection the next upload goes into

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("mkt_videos").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) { setMsg({ err: isMissingTable(error) || /mkt_videos/.test(error.message) ? "The video tables aren't set up yet — run migrations/20261025_marketing_video.sql." : error.message }); setVideos([]); return; }
    setVideos(data || []);
  }, []);
  const loadColls = useCallback(async () => {
    const { data, error } = await supabase.from("mkt_video_collections").select("*").eq("active", true).order("created_at", { ascending: false });
    setColls(error ? [] : data || []);
  }, []);
  useEffect(() => { load(); loadColls(); }, [load, loadColls]);
  const coll = (colls || []).find(c => c.id === collId) || null;
  const mergeColl = (c) => setColls(cs => (cs || []).some(x => x.id === c.id) ? cs.map(x => x.id === c.id ? c : x) : [c, ...(cs || [])]);
  const patchColl = async (c, ch) => {
    mergeColl({ ...c, ...ch });
    const { data, error } = await supabase.from("mkt_video_collections").update(ch).eq("id", c.id).select("*").single();
    if (error) { setMsg({ err: error.message }); loadColls(); } else mergeColl(data);
  };
  // Add or take out videos; reads the row first so an upload finishing in the
  // background doesn't lose one.
  const setMembers = async (id, fn) => {
    const { data: c } = await supabase.from("mkt_video_collections").select("*").eq("id", id).single();
    if (!c) return;
    const ids = [...new Set(fn((c.video_ids || []).map(Number)))];
    const { data, error } = await supabase.from("mkt_video_collections").update({ video_ids: ids }).eq("id", id).select("*").single();
    if (error) setMsg({ err: error.message }); else mergeColl(data);
  };
  const newColl = async () => {
    const name = `Session ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    const { data, error } = await supabase.from("mkt_video_collections").insert({ name }).select("*").single();
    if (error) { setMsg({ err: /mkt_video_collections/.test(error.message) ? "Run migrations/20261113_video_collections.sql first." : error.message }); return; }
    mergeColl(data); setCollId(data.id); setAdding(false);
  };
  const merge = (v) => setVideos(vs => vs.some(x => x.id === v.id) ? vs.map(x => x.id === v.id ? v : x) : [v, ...(vs || [])]);
  const setUp = (key, ch) => setUps(us => us.map(u => u.key === key ? { ...u, ...ch } : u));

  const upload = async (files) => {
    const into = upInto.current; upInto.current = null;
    files = [...(files || [])].filter(isVideo);
    if (!files.length) { setMsg({ err: "Those aren't videos — drop MP4 or MOV files." }); return; }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { setMsg({ err: "Sign in again, then upload." }); return; }
    setMsg(null);
    const month = new Date().toISOString().slice(0, 7);
    const list = files.map(f => ({ f, key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` }));
    setUps(us => [...list.map(x => ({ key: x.key, name: x.f.name, size: x.f.size, pct: 0, state: "waiting" })), ...us]);
    // Keep a phone's screen on while it uploads: a locked iPhone pauses the
    // upload (it picks up where it left off, but only once the page is back).
    let lock = null;
    try { lock = await navigator.wakeLock?.request("screen"); } catch { /* not supported */ }
    try {
    for (const { f, key } of list) {   // one at a time: phones on gym wifi
      const ext = (f.name.match(/\.(mp4|mov|m4v|webm)$/i) || [, "mp4"])[1].toLowerCase();
      const path = `raw/${month}/${key}.${ext}`;
      setUp(key, { state: "uploading" });
      try {
        await tusUpload(f, path, session.access_token, (pct) => setUp(key, { pct }));
        setUp(key, { state: "sorting", pct: 100 });
        const d = await videoApi("upload_done", { path, filename: f.name, bytes: f.size, content_type: f.type, source: glasses ? "glasses" : undefined });
        if (d.video) { merge(d.video); if (into) await setMembers(into, ids => [...ids, d.video.id]); }
        setUp(key, { state: d.video?.status === "ready" ? "done" : "failed", error: d.error || d.video?.ai_error || null });
      } catch (e) { setUp(key, { state: "failed", error: e.message }); }
    }
    } finally { lock?.release?.().catch(() => {}); }
    load();
  };

  const patchVideo = async (v, ch) => {
    merge({ ...v, ...ch });
    const { error } = await supabase.from("mkt_videos").update(ch).eq("id", v.id);
    if (error) { setMsg({ err: error.message }); load(); }
  };
  const togglePick = (v, m) => setPicks(ps => ps.some(p => p.video_id === v.id && p.moment_id === m.id) ? ps.filter(p => !(p.video_id === v.id && p.moment_id === m.id)) : [...ps, { video_id: v.id, moment_id: m.id, label: m.label, thumb_url: m.thumb_url }]);
  const makeReel = async (payload, label) => {
    setBusy("reel"); setMsg({ ok: `${label}… Claude is picking the order and writing the words.` });
    try {
      const d = await videoApi("reel_create", payload);
      setMsg({ ok: `Reel drafted: "${d.item.headline}" — ${d.item.video.clips.length} clips. Open it to render and approve.`, week: d.item.week_of });
      setPicks([]); onChanged?.();
    } catch (e) { setMsg({ err: e.message }); }
    setBusy("");
  };
  const uploadInto = (id) => { upInto.current = id; fileRef.current?.click(); };

  const open = (videos || []).find(v => v.id === openId) || null;
  const live = (videos || []).filter(v => v.active !== false);
  const sorting = ups.some(u => ["uploading", "sorting", "waiting"].includes(u.state));
  return (
    <div onDragOver={e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); setDrag(true); } }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); }} onDrop={e => { e.preventDefault(); setDrag(false); if (collId) upInto.current = collId; upload(e.dataTransfer?.files); }} style={{ position: "relative" }}>
      {drag && <div style={{ position: "absolute", inset: -6, zIndex: 20, border: "3px dashed " + DS.lime, borderRadius: 14, background: "rgba(16,73,70,0.9)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, color: DS.lime, pointerEvents: "none" }}>{coll ? `Drop videos into "${coll.name}"` : "Drop videos — AI finds the best moments"}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 13, color: DS.mut, flex: 1, minWidth: 240, lineHeight: 1.5 }}>Upload videos from the Meta glasses or a phone. Each one is sorted by AI into its best moments — play them, tick the ones you like and make a reel. Nothing posts until you approve it.</div>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: DS.mut, cursor: "pointer" }}><input type="checkbox" checked={glasses} onChange={e => setGlasses(e.target.checked)} style={{ accentColor: DS.lime }} /> From the Meta glasses</label>
        <Btn kind="primary" onClick={() => fileRef.current?.click()} style={big(narrow)}>Upload videos</Btn>
        <input ref={fileRef} type="file" accept="video/*,.mov,.mp4" multiple style={{ display: "none" }} onChange={e => { upload(e.target.files); e.target.value = ""; }} />
      </div>
      <Msg msg={msg} style={{ marginBottom: 6 }} />
      {msg?.week && <Btn small kind="link" onClick={() => onOpenWeek?.(msg.week)} style={{ marginBottom: 10 }}>Open it in Approve →</Btn>}

      {ups.length > 0 && <Panel style={{ marginBottom: 12 }}>
        {ups.slice(0, 8).map(u => (
          <div key={u.key} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, padding: "4px 0" }}>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name} <span style={{ color: DS.dim }}>{fmtMB(u.size)}</span></span>
            <span style={{ color: u.state === "failed" ? DS.orange : u.state === "done" ? DS.lime : DS.mut, whiteSpace: "nowrap" }}>{u.state === "uploading" ? `Uploading ${u.pct}%` : u.state === "sorting" ? "AI is finding the moments…" : u.state === "done" ? "Ready ✓" : u.state === "failed" ? "Didn't work" : "Waiting"}</span>
            {u.state === "uploading" && <div style={{ width: 90, height: 6, background: DS.panel2, borderRadius: 3 }}><div style={{ width: u.pct + "%", height: 6, background: DS.lime, borderRadius: 3 }} /></div>}
          </div>
        ))}
        {ups.filter(u => u.error).slice(0, 3).map(u => <div key={u.key + "e"} style={{ fontSize: 12, color: DS.orange }}>{u.name}: {u.error}</div>)}
        {sorting && <div style={{ fontSize: 12, color: DS.dim, marginTop: 4 }}>Keep this page open (on a phone, keep HQ on screen) until the uploads finish. Sorting takes about a minute a video; if you leave, it finishes on its own within 15 minutes.</div>}
      </Panel>}

      <Collections colls={colls} coll={coll} videos={videos || []} narrow={narrow} adding={adding} setAdding={setAdding}
        onOpen={(id) => { setCollId(id === collId ? null : id); setAdding(false); }} onNew={newColl} onPatch={patchColl} onMembers={setMembers}
        onUpload={uploadInto} onOpenVideo={(id) => setOpenId(id)} onPicks={(ps) => { setPicks(ps); setMsg({ ok: `${ps.length} clips are in the tray below - reorder by removing and re-adding, then press Make a reel.` }); }}
        onOpenWeek={onOpenWeek} onChanged={onChanged} mergeColl={mergeColl} />

      {/* The clip tray */}
      <Panel style={{ marginBottom: 12, borderColor: picks.length ? DS.lime : DS.line }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <H style={{ margin: 0, flex: 1 }}>{picks.length ? `${picks.length} clip${picks.length === 1 ? "" : "s"} picked` : "Make a reel"}</H>
          {picks.length > 0 && <Btn kind="primary" disabled={!!busy} onClick={() => makeReel({ picks: picks.map(p => ({ video_id: p.video_id, moment_id: p.moment_id })) }, "Cutting your picks")} style={big(narrow)}>{busy === "reel" ? "Working…" : `Make a reel from ${picks.length}`}</Btn>}
          <Btn kind={picks.length ? "ghost" : "primary"} disabled={!!busy || !live.some(v => v.status === "ready")} onClick={() => makeReel({}, "Picking the best of the last 3 weeks")} style={big(narrow)}>Best of the last 3 weeks</Btn>
        </div>
        {picks.length > 0
          ? <div style={{ display: "flex", gap: 6, overflowX: "auto", marginTop: 8 }}>{picks.map((p, i) => (
              <button key={p.video_id + p.moment_id} onClick={() => setPicks(picks.filter((_, j) => j !== i))} title="Remove" style={{ flex: "none", width: 74, padding: 0, border: "1px solid " + DS.lime, borderRadius: 6, overflow: "hidden", background: DS.panel2, color: DS.text, cursor: "pointer", textAlign: "left" }}>
                {p.thumb_url && <img src={p.thumb_url} alt="" style={{ width: "100%", aspectRatio: "3 / 4", objectFit: "cover", display: "block" }} />}
                <div style={{ fontSize: 10, padding: "2px 4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i + 1}. {p.label}</div>
              </button>))}</div>
          : <div style={{ fontSize: 12, color: DS.mut, marginTop: 4 }}>Open a video and tick moments to build your own, or let the machine pick the best of the last three weeks.</div>}
      </Panel>

      {open && <VideoDetail v={open} narrow={narrow} picks={picks} onTogglePick={togglePick} onPatch={(ch) => patchVideo(open, ch)} onClose={() => setOpenId(null)}
        onResort={async () => { setBusy("sort"); try { const d = await videoApi("analyze", { id: open.id }); merge(d.video); } catch (e) { setMsg({ err: e.message }); } setBusy(""); }}
        onReel={() => makeReel({ video_ids: [open.id] }, "Cutting this video")} busy={busy} />}

      {videos == null ? <div style={{ color: DS.mut }}>Loading…</div>
        : !live.length ? <Panel style={{ color: DS.mut, borderStyle: "dashed", textAlign: "center", padding: 28 }}>No videos yet. Drag some here or press <b>Upload videos</b>.</Panel>
        : <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${narrow ? 150 : 190}px, 1fr))`, gap: 10 }}>
            {live.map(v => (
              <button key={v.id} onClick={() => adding && coll ? setMembers(coll.id, ids => ids.includes(v.id) ? ids.filter(x => x !== v.id) : [...ids, v.id]) : setOpenId(v.id === openId ? null : v.id)} style={{ padding: 0, textAlign: "left", border: "2px solid " + (adding && coll?.video_ids?.map(Number).includes(v.id) ? DS.lime : v.id === openId ? DS.lime : needsRelease(v) ? DS.orange : "transparent"), background: DS.panel2, borderRadius: 10, overflow: "hidden", cursor: "pointer", color: DS.text }}>
                <div style={{ position: "relative", aspectRatio: "3 / 4", background: "#000" }}>
                  {v.poster_url && <img src={v.poster_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                  <span style={{ position: "absolute", right: 6, bottom: 6, fontSize: 11, fontWeight: 700, background: "rgba(0,0,0,0.75)", color: "#fff", padding: "1px 6px", borderRadius: 4 }}>{fmtT(v.duration)}</span>
                  {adding && coll && <span style={{ position: "absolute", right: 6, top: 6, fontSize: 11, fontWeight: 800, background: coll.video_ids?.map(Number).includes(v.id) ? DS.lime : "rgba(0,0,0,0.75)", color: coll.video_ids?.map(Number).includes(v.id) ? DS.bg : "#fff", padding: "2px 7px", borderRadius: 4 }}>{coll.video_ids?.map(Number).includes(v.id) ? "✓ In" : "+ Add"}</span>}
                  {needsRelease(v) && <span style={{ position: "absolute", left: 6, top: 6, fontSize: 10, fontWeight: 700, background: "rgba(6,26,24,0.85)", color: DS.orange, padding: "1px 6px", borderRadius: 4 }}>kids — release?</span>}
                </div>
                <div style={{ padding: "7px 8px" }}>
                  <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                    {v.line && <LineChip line={v.line} />}
                    <span style={{ fontSize: 11, color: v.status === "ready" ? DS.lime : v.status === "failed" ? DS.orange : DS.mut }}>{v.status === "ready" ? `${(v.moments || []).length} moments` : v.status === "failed" ? "couldn't sort" : "sorting…"}</span>
                  </div>
                  <div style={{ fontSize: 11, color: DS.dim, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.description || v.filename}</div>
                </div>
              </button>
            ))}
          </div>}

      <MusicLibrary narrow={narrow} />
    </div>
  );
}

function Collections({ colls, coll, videos, narrow, adding, setAdding, onOpen, onNew, onPatch, onMembers, onUpload, onOpenVideo, onPicks, onOpenWeek, onChanged, mergeColl }) {
  const [count, setCount] = useState(2);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => { setName(coll?.name || ""); setNotes(coll?.notes || ""); setErr(""); }, [coll?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(videos.map(v => [v.id, v]));
  const members = coll ? (coll.video_ids || []).map(Number).map(id => byId.get(id)).filter(v => v && v.active !== false) : [];
  const sorting = members.filter(v => v.status !== "ready").length;
  const moments = members.reduce((n, v) => n + (v.moments || []).filter(m => !m.skip).length, 0);
  const plan = coll?.plan, ideas = plan?.ideas || [];
  const doPlan = async () => {
    setBusy("plan"); setErr("");
    try { const d = await videoApi("collection_plan", { id: coll.id, count, instruction }); mergeColl(d.collection); }
    catch (e) { setErr(e.message); }
    setBusy("");
  };
  const make = async (idea) => {
    setBusy(b => b || idea.id); setErr("");
    try { const d = await videoApi("collection_reel", { id: coll.id, idea_id: idea.id }); mergeColl({ ...coll, plan: d.plan }); onChanged?.(); return d; }
    catch (e) { setErr(`${idea.title}: ${e.message}`); }
    finally { setBusy(b => b === idea.id ? "" : b); }
  };
  const makeAll = async () => {
    setBusy("all"); setErr("");
    const todo = ideas.filter(i => !i.reel_id);
    const res = await Promise.all(todo.map(i => videoApi("collection_reel", { id: coll.id, idea_id: i.id }).then(d => d, e => ({ error: `${i.title}: ${e.message}` }))));
    const { data } = await supabase.from("mkt_video_collections").select("*").eq("id", coll.id).single();
    if (data) mergeColl(data);
    const bad = res.filter(r => r.error);
    if (bad.length) setErr(bad.map(r => r.error).join(" · "));
    onChanged?.(); setBusy("");
  };
  return (
    <Panel style={{ marginBottom: 12, borderColor: coll ? DS.lime : DS.line }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <H style={{ margin: 0, flex: 1 }}>Collections</H>
        <Btn small kind="ghost" onClick={onNew} style={big(narrow)}>+ New collection</Btn>
      </div>
      <div style={{ fontSize: 12, color: DS.mut, margin: "4px 0 8px" }}>Group the videos from one session (a Hitting Pod, a game, a camp day). AI looks across all of them and plans a couple of different reels.</div>
      {colls == null ? null : !colls.length ? <div style={{ fontSize: 13, color: DS.dim }}>No collections yet.</div>
        : <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{colls.map(c => <button key={c.id} onClick={() => onOpen(c.id)} style={chipStyle(coll?.id === c.id, DS.lime, narrow)}>{c.name} · {(c.video_ids || []).length}</button>)}</div>}
      {coll && <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid " + DS.line }}>
        <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 2fr", gap: 8 }}>
          <input value={name} onChange={e => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== coll.name && onPatch(coll, { name: name.trim().slice(0, 80) })} placeholder="Name, e.g. Hitting Pod Oct 28" style={{ ...inputStyle, fontWeight: 700, fontSize: narrow ? 16 : 14 }} />
          <input value={notes} onChange={e => setNotes(e.target.value)} onBlur={() => notes !== (coll.notes || "") && onPatch(coll, { notes: notes.trim().slice(0, 500) || null })} placeholder='What the reels should show (optional), e.g. "the arm swing and approach footwork"' style={{ ...inputStyle, fontSize: narrow ? 16 : 14 }} />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "10px 0 6px" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: DS.mut, flex: 1 }}>{members.length} video{members.length === 1 ? "" : "s"} · {moments} moments{sorting ? ` · ${sorting} still sorting…` : ""}</span>
          <Btn small kind="primary" onClick={() => onUpload(coll.id)} style={big(narrow)}>Upload into this collection</Btn>
          <Btn small kind={adding ? "primary" : "ghost"} onClick={() => setAdding(!adding)} style={big(narrow)}>{adding ? "Done adding" : "Add from your videos"}</Btn>
          <Btn small kind="quiet" onClick={() => { if (confirm(`Delete the collection "${coll.name}"? The videos stay.`)) { onPatch(coll, { active: false }); onOpen(coll.id); } }} style={big(narrow)}>Delete</Btn>
        </div>
        {adding && <div style={{ fontSize: 12, color: DS.lime, marginBottom: 6 }}>Tap videos below to add them to or take them out of "{coll.name}".</div>}
        {members.length > 0 && <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>{members.map(v => (
          <div key={v.id} style={{ flex: "none", width: 84, position: "relative" }}>
            <button onClick={() => onOpenVideo(v.id)} title="Open this video's moments" style={{ display: "block", width: "100%", padding: 0, border: "1px solid " + DS.line, borderRadius: 6, overflow: "hidden", background: "#000", cursor: "pointer" }}>
              {v.poster_url ? <img src={v.poster_url} alt="" style={{ width: "100%", aspectRatio: "3 / 4", objectFit: "cover", display: "block" }} /> : <div style={{ aspectRatio: "3 / 4" }} />}
            </button>
            <div style={{ fontSize: 10, color: v.status === "ready" ? DS.mut : DS.orange, marginTop: 2 }}>{v.status === "ready" ? `${fmtT(v.duration)} · ${(v.moments || []).length} moments` : v.status === "failed" ? "couldn't sort" : "sorting…"}</div>
            <button onClick={() => onMembers(coll.id, ids => ids.filter(x => x !== v.id))} title="Take out of this collection" style={{ position: "absolute", right: 3, top: 3, width: 22, height: 22, borderRadius: 11, border: 0, background: "rgba(0,0,0,0.75)", color: "#fff", cursor: "pointer", fontSize: 13, lineHeight: "22px", padding: 0 }}>×</button>
          </div>))}</div>}

        {members.length > 0 && <div style={{ marginTop: 10, background: DS.panel2, borderRadius: 10, padding: 12 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Plan</span>
            {[1, 2, 3, 4].map(n => <button key={n} onClick={() => setCount(n)} style={chipStyle(count === n, DS.lime, narrow)}>{n} reel{n === 1 ? "" : "s"}</button>)}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: narrow ? "wrap" : "nowrap" }}>
            <input value={instruction} onChange={e => setInstruction(e.target.value)} placeholder='Anything specific? e.g. "one of just the best swings, one about the coaching"' style={{ ...inputStyle, flex: 1, minWidth: 0, fontSize: narrow ? 16 : 14 }} />
            <Btn kind="primary" disabled={!!busy || !moments || sorting === members.length} onClick={doPlan} style={big(narrow)}>{busy === "plan" ? "AI is watching… (about a minute)" : ideas.length ? "Plan again" : `Plan ${count} reel${count === 1 ? "" : "s"} with AI`}</Btn>
          </div>
          {sorting > 0 && <div style={{ fontSize: 12, color: DS.mut, marginTop: 6 }}>Wait for the videos to finish sorting so every one is in the plan.</div>}
        </div>}
        {err && <div style={{ fontSize: 13, color: DS.orange, marginTop: 8 }}>{err}</div>}

        {plan && <div style={{ marginTop: 10 }}>
          {plan.summary && <div style={{ fontSize: 13, color: DS.text, lineHeight: 1.5, marginBottom: 8 }}>{plan.summary}</div>}
          <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "repeat(auto-fill, minmax(300px, 1fr))", gap: 8 }}>
            {ideas.map((idea, n) => (
              <div key={idea.id} style={{ border: "1px solid " + (idea.reel_id ? DS.lime : DS.line), borderRadius: 10, padding: 10, background: DS.panel2 }}>
                <div style={{ fontSize: 14, fontWeight: 800 }}>{n + 1}. {idea.title}</div>
                <div style={{ fontSize: 12, color: DS.mut, margin: "2px 0 8px" }}>{idea.angle}</div>
                <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>{idea.picks.map((p, i) => (
                  <div key={i} title={p.label} style={{ flex: "none", width: 52 }}>
                    {p.thumb_url ? <img src={p.thumb_url} alt="" style={{ width: "100%", aspectRatio: "3 / 4", objectFit: "cover", borderRadius: 4, display: "block" }} /> : <div style={{ aspectRatio: "3 / 4", background: "#000", borderRadius: 4 }} />}
                    <div style={{ fontSize: 9, color: DS.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.label}</div>
                  </div>))}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {idea.reel_id
                    ? <Btn small kind="link" onClick={() => onOpenWeek?.(idea.week_of)} style={big(narrow)}>✓ Reel drafted - open in Approve →</Btn>
                    : <Btn small kind="primary" disabled={!!busy} onClick={() => make(idea)} style={big(narrow)}>{busy === idea.id ? "Cutting… (about 30 s)" : "Make this reel"}</Btn>}
                  <Btn small kind="ghost" onClick={() => onPicks(idea.picks)} style={big(narrow)}>Change the clips</Btn>
                </div>
              </div>
            ))}
          </div>
          {ideas.filter(i => !i.reel_id).length > 1 && <Btn kind="primary" disabled={!!busy} onClick={makeAll} style={{ marginTop: 8, ...big(narrow) }}>{busy === "all" ? "Cutting them all…" : `Make all ${ideas.filter(i => !i.reel_id).length} reels`}</Btn>}
        </div>}
      </div>}
    </Panel>
  );
}

function VideoDetail({ v, narrow, picks, onTogglePick, onPatch, onClose, onResort, onReel, busy }) {
  const [src, setSrc] = useState(null);
  const ref = useRef(null);
  const stopAt = useRef(null);
  useEffect(() => {
    setSrc(null);
    supabase.storage.from(RAW).createSignedUrl(v.path, 3600).then(({ data }) => setSrc(data?.signedUrl || null));
  }, [v.id, v.path]);
  const play = (m) => { const el = ref.current; if (!el) return; stopAt.current = m.end; el.currentTime = m.start; el.play().catch(() => {}); };
  const onTime = () => { const el = ref.current; if (el && stopAt.current != null && el.currentTime >= stopAt.current) { el.pause(); stopAt.current = null; } };
  const moments = v.moments || [];
  const picked = (m) => picks.some(p => p.video_id === v.id && p.moment_id === m.id);
  return (
    <Panel style={{ marginBottom: 12, borderColor: needsRelease(v) ? DS.orange : DS.lime }}>
      <div style={{ display: narrow ? "block" : "grid", gridTemplateColumns: "300px 1fr", gap: 16 }}>
        <div>
          {src ? <VideoBox ref={ref} src={src} poster={v.poster_url || undefined} controls playsInline preload="metadata" onTimeUpdate={onTime} style={{ width: "100%", maxHeight: 520, background: "#000", borderRadius: 8, display: "block" }} />
            : <div style={{ aspectRatio: "3 / 4", background: "#000", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: DS.mut, fontSize: 12 }}>Loading the video…</div>}
          <div style={{ fontSize: 11, color: DS.dim, marginTop: 6 }}>{v.filename} · {fmtT(v.duration)} · {fmtMB(v.bytes)}{v.width ? ` · ${v.width}×${v.height}` : ""}{v.has_audio === false ? " · no sound" : ""}</div>
        </div>
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 14, flex: 1, minWidth: 200 }}>{v.description || (v.status === "ready" ? "" : "AI is still sorting this one…")}</div>
            <Btn small kind="quiet" onClick={onClose} style={big(narrow)}>Close</Btn>
          </div>
          {v.minors === true && (
            <div style={{ marginTop: 10, padding: "9px 12px", borderRadius: 10, border: "1px solid " + (v.release_ok === true ? DS.lime : DS.orange), background: v.release_ok === true ? DS.limeSoft : DS.orangeSoft }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: v.release_ok === true ? DS.lime : DS.orange }}>{v.release_ok === true ? "Kids in this video — release confirmed" : v.release_ok === false ? "Kids in this video — marked don't post" : "Kids can be recognized in this video"}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                <Btn small kind={v.release_ok === true ? "primary" : "ghost"} onClick={() => onPatch({ release_ok: true })} style={big(narrow)}>Release OK — can post</Btn>
                <Btn small kind={v.release_ok === false ? "warn" : "ghost"} onClick={() => onPatch({ release_ok: false })} style={big(narrow)}>Don't post publicly</Btn>
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0" }}>
            {LINES.map(l0 => lineMeta(l0.key)).map(l => <button key={l.key} onClick={() => onPatch({ line: v.line === l.key ? null : l.key })} style={chipStyle(v.line === l.key, l.color, narrow)}>{l.label}</button>)}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: DS.mut, margin: "8px 0 6px" }}>The best moments {moments.length ? `(${moments.length})` : ""} — tap to play, tick to use</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${narrow ? 130 : 150}px, 1fr))`, gap: 8 }}>
            {moments.map(m => (
              <div key={m.id} style={{ background: DS.panel2, borderRadius: 8, overflow: "hidden", border: "1px solid " + (picked(m) ? DS.lime : DS.line), opacity: m.skip ? 0.45 : 1 }}>
                <button onClick={() => play(m)} style={{ display: "block", width: "100%", padding: 0, border: 0, background: "#000", cursor: "pointer", position: "relative" }}>
                  {m.thumb_url && <img src={m.thumb_url} alt="" style={{ width: "100%", aspectRatio: "3 / 4", objectFit: "cover", display: "block" }} />}
                  <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#fff", fontSize: 26, textShadow: "0 1px 6px #000" }}>▶</span>
                  <span style={{ position: "absolute", left: 5, top: 5, fontSize: 10, fontWeight: 800, background: m.score >= 8 ? DS.lime : "rgba(0,0,0,0.75)", color: m.score >= 8 ? DS.bg : "#fff", padding: "1px 5px", borderRadius: 4 }}>{m.score}/10</span>
                </button>
                <div style={{ padding: "6px 7px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{m.label}</div>
                  <div style={{ fontSize: 11, color: DS.mut }}>{fmtT(m.start)}–{fmtT(m.end)}{m.minors ? " · kids" : ""}</div>
                  <div style={{ display: "flex", gap: 4, marginTop: 5 }}>
                    <button onClick={() => onTogglePick(v, m)} disabled={m.skip} style={{ ...chipStyle(picked(m), DS.lime), padding: "3px 8px", fontSize: 11 }}>{picked(m) ? "✓ Picked" : "Use"}</button>
                    <button onClick={() => onPatch({ moments: moments.map(x => x.id === m.id ? { ...x, skip: !x.skip } : x) })} style={{ ...chipStyle(!!m.skip, DS.orange), padding: "3px 8px", fontSize: 11 }}>{m.skip ? "Skipped" : "Skip"}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <Btn kind="primary" disabled={!!busy || v.status !== "ready" || v.release_ok === false} onClick={onReel} style={big(narrow)}>Make a reel from this video</Btn>
            <Btn kind="ghost" disabled={!!busy} onClick={onResort} style={big(narrow)}>{busy === "sort" ? "Sorting…" : "Sort again with AI"}</Btn>
            <Btn kind="warn" onClick={() => onPatch({ active: false })} style={big(narrow)}>Hide</Btn>
          </div>
          {v.ai_error && <div style={{ fontSize: 12, color: DS.orange, marginTop: 6 }}>{v.ai_error}</div>}
        </div>
      </div>
    </Panel>
  );
}

function MusicLibrary({ narrow }) {
  const [tracks, setTracks] = useState(null);
  const [form, setForm] = useState(null);         // { file, title, artist, mood: [], rights_ok, rights_note }
  const [finder, setFinder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);
  const load = useCallback(() => supabase.from("mkt_music").select("*").order("created_at", { ascending: false }).then(({ data }) => setTracks(data || [])), []);
  useEffect(() => { load(); }, [load]);
  const pick = (f) => { if (!f) return; setForm({ file: f, title: f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "), artist: "", mood: [], rights_ok: false, rights_note: "" }); };
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const f = form.file;
      const ext = (f.name.match(/\.(mp3|m4a|aac|wav)$/i) || [, "mp3"])[1].toLowerCase();
      const path = `music/${Date.now()}-${form.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "track"}.${ext}`;
      const type = f.type || { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav" }[ext];
      const up = await supabase.storage.from("marketing").upload(path, f, { contentType: type, cacheControl: "31536000" });
      if (up.error) throw new Error(up.error.message);
      const url = supabase.storage.from("marketing").getPublicUrl(path).data.publicUrl;
      const duration = await new Promise(res => { const a = new Audio(); a.preload = "metadata"; a.onloadedmetadata = () => res(Math.round(a.duration) || null); a.onerror = () => res(null); a.src = URL.createObjectURL(f); });
      const { error } = await supabase.from("mkt_music").insert({ title: form.title.trim(), artist: form.artist.trim() || null, url, path, duration, mood: form.mood, rights_ok: true, rights_note: form.rights_note.trim() || null });
      if (error) throw new Error(error.message);
      setForm(null); setMsg({ ok: "Added to the music library." }); load();
    } catch (e) { setMsg({ err: e.message }); }
    setBusy(false);
  };
  return (
    <Panel style={{ marginTop: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <H style={{ margin: 0, flex: 1 }}>Music library</H>
        <Btn small kind="primary" onClick={() => setFinder(f => !f)} style={big(narrow)}>{finder ? "Close free music" : "♫ Find free music"}</Btn>
        <Btn small kind="ghost" onClick={() => fileRef.current?.click()} style={big(narrow)}>+ Add a track</Btn>
        <input ref={fileRef} type="file" accept="audio/*,.mp3,.m4a,.wav" style={{ display: "none" }} onChange={e => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      <div style={{ fontSize: 12, color: DS.mut, margin: "4px 0 8px" }}>Only tracks the club has the rights to use (royalty-free or licensed). Instagram's own music can't be added to posts made this way. The machine picks a track by mood; you can change it on each reel.</div>
      <Msg msg={msg} style={{ marginBottom: 6 }} />
      {finder && <FreeMusicFinder narrow={narrow} have={new Set((tracks || []).map(t => t.external_id).filter(Boolean))} onAdded={(t) => { setMsg({ ok: `Added "${t.title}"${t.attribution ? " — its credit goes on the end card of any reel that uses it" : ""}.` }); load(); }} />}
      {form && <div style={{ background: DS.panel2, borderRadius: 10, padding: 12, marginBottom: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr", gap: 8 }}>
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Title" style={{ ...inputStyle, fontSize: narrow ? 16 : 14 }} />
          <input value={form.artist} onChange={e => setForm({ ...form, artist: e.target.value })} placeholder="Artist (optional)" style={{ ...inputStyle, fontSize: narrow ? 16 : 14 }} />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>{MOODS.map(m => { const on = form.mood.includes(m); return <button key={m} onClick={() => setForm({ ...form, mood: on ? form.mood.filter(x => x !== m) : [...form.mood, m] })} style={chipStyle(on, DS.lime, narrow)}>{m}</button>; })}</div>
        <input value={form.rights_note} onChange={e => setForm({ ...form, rights_note: e.target.value })} placeholder='Where the licence comes from, e.g. "Epidemic Sound subscription"' style={{ ...inputStyle, marginTop: 8, fontSize: narrow ? 16 : 14 }} />
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginTop: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={form.rights_ok} onChange={e => setForm({ ...form, rights_ok: e.target.checked })} style={{ width: 20, height: 20, accentColor: DS.lime, flex: "none" }} />
          The club has the rights to use this track on social media.
        </label>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <Btn kind="primary" disabled={busy || !form.rights_ok || !form.title.trim()} onClick={save} style={big(narrow)}>{busy ? "Uploading…" : "Add track"}</Btn>
          <Btn kind="quiet" onClick={() => setForm(null)} style={big(narrow)}>Cancel</Btn>
        </div>
      </div>}
      {tracks == null ? <div style={{ color: DS.mut, fontSize: 13 }}>Loading…</div>
        : !tracks.length ? <div style={{ color: DS.mut, fontSize: 13 }}>No tracks yet — reels use their original sound.</div>
        : tracks.map(t => (
          <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid " + DS.line, opacity: t.active === false ? 0.5 : 1 }}>
            <div style={{ flex: "1 1 180px", minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{t.title}{t.artist ? <span style={{ fontWeight: 400, color: DS.mut }}> — {t.artist}</span> : null}</div>
              <div style={{ fontSize: 11, color: DS.dim }}>{(t.mood || []).join(", ")}{t.duration ? ` · ${fmtT(t.duration)}` : ""}{t.used_count ? ` · used ${t.used_count}×` : ""}{t.rights_note ? ` · ${t.rights_note}` : ""}{t.source_url ? <> · <a href={t.source_url} target="_blank" rel="noreferrer" style={{ color: DS.mut }}>source</a></> : null}</div>
              {t.attribution && <div style={{ fontSize: 11, color: DS.mut }}>End-card credit: {t.attribution}</div>}
            </div>
            <audio src={t.url} controls preload="none" style={{ height: 32, maxWidth: 240 }} />
            <Btn small kind="quiet" onClick={async () => { await supabase.from("mkt_music").update({ active: t.active === false }).eq("id", t.id); load(); }}>{t.active === false ? "Use again" : "Retire"}</Btn>
            {t.rights_ok ? <Tag color={DS.lime}>rights ✓</Tag> : <Tag color={DS.orange}>no rights</Tag>}
          </div>
        ))}
    </Panel>
  );
}

// Free music from Openverse - Creative Commons tracks the club can use
// commercially (CC0, or CC BY with the artist credited in the caption).
// Search by mood or words, listen, add the ones you like to the library.
function FreeMusicFinder({ narrow, have, onAdded }) {
  const [mood, setMood] = useState("upbeat");
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const search = async (m = mood, text = q) => {
    setBusy("search"); setErr("");
    try { const d = await mktApi("music_search", { mood: m, q: text.trim() }); setRes(d.results || []); if (d.error) setErr(d.error); }
    catch (e) { setErr(e.message); setRes([]); }
    setBusy("");
  };
  useEffect(() => { search("upbeat", ""); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (r) => {
    setBusy(r.id); setErr("");
    try { const d = await mktApi("music_add", { id: r.id, mood: [mood] }); onAdded?.(d.track); }
    catch (e) { setErr(e.message); }
    setBusy("");
  };
  return (
    <div style={{ background: DS.panel2, borderRadius: 10, padding: 12, marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: DS.mut, marginBottom: 8, lineHeight: 1.5 }}>Free tracks from Openverse (Jamendo, Freesound, ccMixter) that allow use in club posts: <b>CC0</b> needs nothing; <b>CC BY</b> needs the artist credited, so HQ puts the credit in small type on the end card of any reel that uses it (never in the caption).</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {MOODS.map(m => <button key={m} onClick={() => { setMood(m); setQ(""); search(m, ""); }} style={chipStyle(mood === m && !q, DS.lime, narrow)}>{m}</button>)}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && search(mood, q)} placeholder='Or search: "drumline", "summer pop", "piano"' style={{ ...inputStyle, flex: 1, fontSize: narrow ? 16 : 14 }} />
        <Btn small kind="ghost" disabled={busy === "search"} onClick={() => search(mood, q)} style={big(narrow)}>{busy === "search" ? "Searching…" : "Search"}</Btn>
      </div>
      {err && <div style={{ fontSize: 12, color: DS.orange, marginTop: 6 }}>{err}</div>}
      {busy === "search" ? <div style={{ fontSize: 13, color: DS.mut, marginTop: 8 }}>Searching… a new search can take up to a minute; ones you've run before are instant.</div>
        : res == null ? null
        : !res.length ? <div style={{ fontSize: 13, color: DS.mut, marginTop: 8 }}>Nothing found — try another word.</div>
        : res.map(r => (
          <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid " + DS.line }}>
            <div style={{ flex: "1 1 200px", minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{r.title}{r.artist ? <span style={{ fontWeight: 400, color: DS.mut }}> — {r.artist}</span> : null}</div>
              <div style={{ fontSize: 11, color: DS.dim }}>{r.duration ? fmtT(r.duration) + " · " : ""}{r.source}{r.landing ? <> · <a href={r.landing} target="_blank" rel="noreferrer" style={{ color: DS.mut }}>source</a></> : null}</div>
            </div>
            <audio src={r.preview} controls preload="none" style={{ height: 32, maxWidth: 220 }} />
            <Tag color={r.license === "cc0" ? DS.lime : "#7FD1C3"}>{r.license === "cc0" ? "CC0" : r.license_label}</Tag>
            {have.has(r.id) ? <Tag color={DS.mut}>in library</Tag> : <Btn small kind="primary" disabled={!!busy} onClick={() => add(r)} style={big(narrow)}>{busy === r.id ? "Adding…" : "Add"}</Btn>}
          </div>
        ))}
    </div>
  );
}
