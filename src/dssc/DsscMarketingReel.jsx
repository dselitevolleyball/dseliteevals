// DSSC Marketing → Approve, a reel's card: the rendered video (or its cover
// until it's rendered), "Render the reel", and the cut - the clips in order
// with their in/out points, add/remove/reorder, the music and the volumes.
// Edits save with reel_update (a new render is then needed); rendering draws
// the cards here and has the server cut the MP4 (renderReelItem in the Kit).
// "Hear it" plays the cut in the browser - the clips in order with their own
// sound and the music at the chosen volumes - so the mix can be tried before
// a render (SoundPreview below).

import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../supabase";
import { DS, Btn, inputStyle } from "./DsscHub.jsx";
import { videoApi, renderReelItem, specOf, GraphicPreview, VideoBox, chipStyle, Msg } from "./DsscMarketingKit.jsx";

const INTRO = 1.2, OUTRO = 2.0;   // the cards' seconds in a render (api/_lib/marketing-video.js)
const fmtT = (s) => { const n = Math.max(0, +s || 0); return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}${n % 1 >= 0.05 ? "." + Math.round((n % 1) * 10) : ""}`; };

export default function ReelBox({ item: it, editable, narrow, onReplace, onPatch }) {
  const v = it.video || {};
  const [clips, setClips] = useState(v.clips || []);
  const [musicId, setMusicId] = useState(v.music_id || "");
  const [musicVol, setMusicVol] = useState(v.music_volume ?? 0.3);
  const [origVol, setOrigVol] = useState(v.original_volume ?? 1);
  const [videos, setVideos] = useState({});
  const [music, setMusic] = useState([]);
  const [busy, setBusy] = useState("");
  const [step, setStep] = useState("");
  const [msg, setMsg] = useState(null);
  const [adding, setAdding] = useState(false);
  const g = it.graphic || {};
  const [words, setWords] = useState({ headline: g.headline || "", sub: g.sub || "", tag: g.tag || "" });
  useEffect(() => setWords({ headline: it.graphic?.headline || "", sub: it.graphic?.sub || "", tag: it.graphic?.tag || "" }), [it.id, it.graphic?.headline, it.graphic?.sub, it.graphic?.tag]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveWords = (k) => { if (words[k] === (g[k] || "")) return; const graphic = { ...g, [k]: words[k], ...(k === "headline" ? { accent: words.headline.trim().split(/\s+/).pop() || "" } : {}) }; onPatch?.(it, k === "headline" ? { graphic, headline: words.headline } : { graphic }); };
  useEffect(() => { setClips(it.video?.clips || []); setMusicId(it.video?.music_id || ""); setMusicVol(it.video?.music_volume ?? 0.3); setOrigVol(it.video?.original_volume ?? 1); }, [it.id, it.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const ids = useMemo(() => [...new Set((it.video?.clips || []).map(c => Number(c.video_id)))].join(","), [it.video]);
  useEffect(() => {
    if (!ids) return;
    supabase.from("mkt_videos").select("id, filename, duration, poster_url, moments, description, path, has_audio").in("id", ids.split(",").map(Number)).then(({ data }) => setVideos(Object.fromEntries((data || []).map(x => [x.id, x]))));
    supabase.from("mkt_music").select("id, title, artist, mood, url").eq("active", true).eq("rights_ok", true).order("title").then(({ data }) => setMusic(data || []));
  }, [ids]);

  const dirty = JSON.stringify(clips) !== JSON.stringify(v.clips || []) || String(musicId || "") !== String(v.music_id || "") || +musicVol !== +(v.music_volume ?? 0.3) || +origVol !== +(v.original_volume ?? 1);
  const total = clips.reduce((s, c) => s + (c.end - c.start), 0);
  const fresh = it.render_status === "rendered" && it.asset_video_url && !dirty;
  const thumb = (c) => (videos[c.video_id]?.moments || []).find(m => m.id === c.moment_id)?.thumb_url || videos[c.video_id]?.poster_url;
  const setClip = (i, ch) => setClips(cs => cs.map((c, j) => j === i ? { ...c, ...ch } : c));
  const nudge = (i, k, d) => setClip(i, (() => { const c = clips[i]; const dur = videos[c.video_id]?.duration || 9999; const next = +Math.max(0, Math.min(dur, c[k] + d)).toFixed(2); return k === "start" ? { start: Math.min(next, c.end - 0.5) } : { end: Math.max(next, c.start + 0.5) }; })());
  const move = (i, d) => setClips(cs => { const a = cs.slice(); const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; });
  const spare = Object.values(videos).flatMap(x => (x.moments || []).filter(m => !m.skip && !clips.some(c => c.video_id === x.id && c.moment_id === m.id)).map(m => ({ ...m, video_id: x.id })));

  const save = async () => {
    setBusy("save"); setMsg(null);
    try { const d = await videoApi("reel_update", { id: it.id, video: { clips, music_id: musicId ? Number(musicId) : null, music_volume: +musicVol, original_volume: +origVol } }); onReplace(d.item); setMsg({ ok: "Saved — render it to see the new cut." }); }
    catch (e) { setMsg({ err: e.message }); }
    setBusy("");
  };
  const render = async () => {
    setBusy("render"); setMsg(null);
    try { const done = await renderReelItem(it, setStep); onReplace(done); setMsg({ ok: `Rendered — ${Math.round(done.video?.duration || total)} seconds.` }); }
    catch (e) { setMsg({ err: e.message }); }
    setBusy(""); setStep("");
  };

  return (
    <div>
      {fresh
        ? <VideoBox key={it.asset_video_url} src={it.asset_video_url} poster={it.asset_url || undefined} controls playsInline preload="metadata" style={{ width: "100%", maxWidth: 360, maxHeight: narrow ? 560 : 640, aspectRatio: "9 / 16", background: "#000", borderRadius: 8, display: "block" }} />
        : <div style={{ position: "relative", maxWidth: 360 }}>
            <GraphicPreview spec={specOf(it, { format: "story" })} />
            <div style={{ position: "absolute", left: 8, top: 8, fontSize: 11, fontWeight: 700, background: "rgba(6,26,24,0.85)", color: it.render_status === "failed" ? DS.orange : DS.lime, padding: "3px 8px", borderRadius: 4 }}>{it.render_status === "failed" ? "Render failed" : dirty ? "Changed — render again" : "The cover · not rendered yet"}</div>
          </div>}
      {it.render_error && it.render_status === "failed" && <div style={{ fontSize: 12, color: DS.orange, marginTop: 6 }}>{it.render_error}</div>}
      {editable && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
        {dirty ? <Btn kind="primary" disabled={!!busy} onClick={save} style={narrow ? { minHeight: 44 } : {}}>{busy === "save" ? "Saving…" : "Save the cut"}</Btn>
          : <Btn kind={fresh ? "ghost" : "primary"} disabled={!!busy} onClick={render} style={narrow ? { minHeight: 44 } : {}}>{busy === "render" ? (step || "Rendering…") : fresh ? "Render again" : "Render the reel"}</Btn>}
        <span style={{ fontSize: 12, color: DS.mut }}>{clips.length} clip{clips.length === 1 ? "" : "s"} · {Math.round(total)} s of video + intro and end card</span>
      </div>}
      <Msg msg={msg} style={{ marginTop: 6 }} />

      {editable && <>
        <div style={{ fontSize: 11, fontWeight: 700, color: DS.mut, margin: "12px 0 6px" }}>Words on the video (cover and the first seconds)</div>
        <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "2fr 1fr", gap: 6 }}>
          <input value={words.headline} onChange={e => setWords({ ...words, headline: e.target.value })} onBlur={() => saveWords("headline")} placeholder="Headline" style={{ ...inputStyle, fontSize: narrow ? 16 : 14 }} />
          <input value={words.tag} onChange={e => setWords({ ...words, tag: e.target.value })} onBlur={() => saveWords("tag")} placeholder="Tag" style={{ ...inputStyle, fontSize: narrow ? 16 : 14 }} />
        </div>
      </>}
      <div style={{ fontSize: 11, fontWeight: 700, color: DS.mut, margin: "12px 0 6px" }}>The cut</div>
      {clips.map((c, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderTop: "1px solid " + DS.line }}>
          {thumb(c) ? <img src={thumb(c)} alt="" style={{ width: 44, height: 58, objectFit: "cover", borderRadius: 4, flex: "none" }} /> : <div style={{ width: 44, height: 58, background: DS.panel2, borderRadius: 4, flex: "none" }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i + 1}. {c.label || "Clip"}</div>
            <div style={{ fontSize: 12, color: DS.mut }}>{fmtT(c.start)}–{fmtT(c.end)} · {(c.end - c.start).toFixed(1)} s</div>
            {editable && <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
              {[["start", -0.5, "◀ in"], ["start", 0.5, "in ▶"], ["end", -0.5, "◀ out"], ["end", 0.5, "out ▶"]].map(([k, d, l]) => <button key={k + d} onClick={() => nudge(i, k, d)} style={{ ...chipStyle(false, DS.mut), padding: "2px 7px", fontSize: 11 }}>{l}</button>)}
            </div>}
          </div>
          {editable && <div style={{ display: "flex", gap: 3 }}>
            <Btn small kind="quiet" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Earlier">↑</Btn>
            <Btn small kind="quiet" disabled={i === clips.length - 1} onClick={() => move(i, 1)} aria-label="Later">↓</Btn>
            <Btn small kind="quiet" disabled={clips.length < 2} onClick={() => setClips(clips.filter((_, j) => j !== i))} aria-label="Remove">✕</Btn>
          </div>}
        </div>
      ))}
      {editable && spare.length > 0 && <div style={{ marginTop: 6 }}>
        <Btn small kind="link" onClick={() => setAdding(a => !a)}>{adding ? "Close" : `+ Add a clip (${spare.length} more from these videos)`}</Btn>
        {adding && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 6, marginTop: 6 }}>
          {spare.slice(0, 18).map(m => (
            <button key={m.video_id + m.id} onClick={() => { setClips([...clips, { video_id: m.video_id, moment_id: m.id, start: m.start, end: Math.min(m.end, m.start + 5), label: m.label }]); setAdding(false); }} style={{ padding: 0, border: "1px solid " + DS.line, background: DS.panel2, borderRadius: 6, overflow: "hidden", cursor: "pointer", textAlign: "left", color: DS.text }}>
              {m.thumb_url && <img src={m.thumb_url} alt="" style={{ width: "100%", aspectRatio: "3 / 4", objectFit: "cover", display: "block" }} />}
              <div style={{ fontSize: 11, padding: "3px 5px" }}>{m.label} · {m.score}/10</div>
            </button>
          ))}
        </div>}
      </div>}

      <div style={{ fontSize: 11, fontWeight: 700, color: DS.mut, margin: "12px 0 6px" }}>Sound</div>
      <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 40px", gap: 8, alignItems: "center", fontSize: 13 }}>
        <span>Original sound</span>
        <input type="range" min={0} max={1.5} step={0.1} disabled={!editable} value={origVol} onChange={e => setOrigVol(+e.target.value)} style={{ accentColor: DS.lime }} />
        <b>{Math.round(origVol * 100)}%</b>
        <span>Music</span>
        <select disabled={!editable} value={musicId || ""} onChange={e => setMusicId(e.target.value)} style={{ ...inputStyle, colorScheme: "dark", padding: "6px 8px", fontSize: narrow ? 16 : 13 }}>
          <option value="">No music</option>
          {music.map(m => <option key={m.id} value={m.id}>{m.title}{m.artist ? ` — ${m.artist}` : ""}{(m.mood || []).length ? ` (${m.mood.join(", ")})` : ""}</option>)}
        </select>
        <span />
        {musicId ? <>
          <span>Music volume</span>
          <input type="range" min={0} max={1} step={0.05} disabled={!editable} value={musicVol} onChange={e => setMusicVol(+e.target.value)} style={{ accentColor: DS.lime }} />
          <b>{Math.round(musicVol * 100)}%</b>
        </> : null}
      </div>
      <SoundPreview clips={clips} videos={videos} track={music.find(m => String(m.id) === String(musicId)) || null} musicVol={musicVol} origVol={origVol} cover={it.asset_url} narrow={narrow} />
      {!music.length && <div style={{ fontSize: 12, color: DS.dim, marginTop: 4 }}>No music in the library yet — add tracks the club has the rights to in Marketing → Videos.</div>}
    </div>
  );
}

// Plays the cut with its sound in the browser: the intro card's moment, each
// clip from its in to its out point, the end card - with the music under it
// all (fading in and out like the render). Volumes go through Web Audio, so the
// sliders change the mix live, also on iPhones (where a video's own volume
// can't be set), and the original sound can go above 100% as in the render.
function SoundPreview({ clips, videos, track, musicVol, origVol, cover, narrow }) {
  const vidRef = useRef(null), musRef = useRef(null);
  const audio = useRef(null);          // { ctx, vGain, mGain }
  const run = useRef(0);               // bumps to cancel a playing preview
  const [urls, setUrls] = useState({});
  const [state, setState] = useState(null);   // { phase: "intro"|"clip"|"outro", i, t, T } while playing
  const [err, setErr] = useState("");
  const vol = useRef({ musicVol, origVol });
  vol.current = { musicVol, origVol };

  const need = [...new Set(clips.map(c => c.video_id))].filter(id => videos[id]?.path && !urls[id]);
  useEffect(() => {
    if (!need.length) return;
    Promise.all(need.map(id => supabase.storage.from("marketing-video").createSignedUrl(videos[id].path, 3600).then(({ data }) => [id, data?.signedUrl])))
      .then(pairs => setUrls(u => ({ ...u, ...Object.fromEntries(pairs.filter(p => p[1])) })));
  }, [need.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { run.current++; audio.current?.ctx.close().catch(() => {}); }, []);
  // Live volume while it plays (the music's fade is applied in the loop below).
  useEffect(() => { if (audio.current) audio.current.vGain.gain.value = clips[state?.i]?.video_id && videos[clips[state.i].video_id]?.has_audio === false ? 0 : origVol; }, [origVol, state?.i]); // eslint-disable-line react-hooks/exhaustive-deps

  const T = INTRO + clips.reduce((s, c) => s + (c.end - c.start), 0) + OUTRO;
  const ready = clips.length > 0 && clips.every(c => urls[c.video_id]);
  // The first clip waits in the player, so the tap that starts the preview can start it (iPhone).
  const first = ready ? urls[clips[0].video_id] : null;
  useEffect(() => { const v = vidRef.current; if (v && first && !state && v.src !== first) v.src = first; }, [first]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = () => {
    run.current++;
    vidRef.current?.pause(); musRef.current?.pause();
    setState(null);
  };
  const play = () => {
    const v = vidRef.current, mu = musRef.current;
    if (!v || !ready) return;
    setErr("");
    // Everything that needs the tap happens before the first await (Safari).
    if (!audio.current) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const vGain = ctx.createGain(), mGain = ctx.createGain();
        ctx.createMediaElementSource(v).connect(vGain).connect(ctx.destination);
        ctx.createMediaElementSource(mu).connect(mGain).connect(ctx.destination);
        audio.current = { ctx, vGain, mGain };
      } catch (e) { setErr("This browser can't preview the mix: " + e.message); return; }
    }
    const { ctx, vGain, mGain } = audio.current;
    ctx.resume().catch(() => {});
    mGain.gain.value = 0;
    if (track?.url) { mu.currentTime = 0; mu.play().catch(() => {}); }
    v.muted = false; v.play().then(() => v.pause()).catch(() => {});
    const me = ++run.current;
    const live = () => run.current === me;
    // Where we are in the reel: a card counts by the clock, a clip by the video's own time
    // (so loading a clip doesn't push the music's fade-out early).
    const pos = { at: 0, since: performance.now(), clip: null };
    const reelTime = () => pos.at + (pos.clip ? Math.max(0, v.currentTime - pos.clip.start) : (performance.now() - pos.since) / 1000);
    const tick = () => {
      if (!live()) return;
      const e = Math.min(reelTime(), T);
      const fade = Math.min(1, e / 0.6, Math.max(0, (T - e) / 1.5));
      mGain.gain.value = track?.url ? vol.current.musicVol * fade : 0;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const wait = (sec) => new Promise(r => setTimeout(r, sec * 1000));
    const seek = (el, t) => new Promise(r => { if (Math.abs(el.currentTime - t) < 0.05) return r(); el.addEventListener("seeked", r, { once: true }); el.currentTime = t; setTimeout(r, 4000); });
    const loaded = (el, src) => new Promise(r => { if (el.src === src && el.readyState >= 1) return r(); el.addEventListener("loadedmetadata", r, { once: true }); el.addEventListener("error", r, { once: true }); if (el.src !== src || el.error) { el.src = src; el.load(); } setTimeout(r, 15000); });
    (async () => {
      setState({ phase: "intro", i: -1 });
      await wait(INTRO);
      let at = INTRO;
      for (let i = 0; i < clips.length && live(); i++) {
        const c = clips[i];
        Object.assign(pos, { at, clip: null, since: performance.now() + 1e9 });   // hold the music's place while the clip loads
        await loaded(v, urls[c.video_id]); if (!live()) return;
        if (v.error || v.readyState < 1) { setErr(`Clip ${i + 1} wouldn't load${v.error?.code === 4 ? " - this browser can't play that video's format (the render will still work)" : " - check the connection and try again"}.`); stop(); return; }
        await seek(v, c.start); if (!live()) return;
        vGain.gain.value = videos[c.video_id]?.has_audio === false ? 0 : vol.current.origVol;
        pos.clip = c;
        setState({ phase: "clip", i });
        await v.play().catch(e => setErr("Couldn't play a clip: " + e.message));
        await new Promise(r => { const f = () => { if (!live() || v.currentTime >= c.end || v.ended || v.paused) return r(); requestAnimationFrame(f); }; requestAnimationFrame(f); });
        v.pause();
        at += c.end - c.start;
      }
      if (!live()) return;
      Object.assign(pos, { at, clip: null, since: performance.now() });
      setState({ phase: "outro", i: clips.length });
      await wait(OUTRO);
      if (live()) stop();
    })();
  };

  const playing = !!state;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {playing ? <Btn kind="ghost" onClick={stop} style={narrow ? { minHeight: 44 } : {}}>■ Stop</Btn>
          : <Btn kind="ghost" disabled={!ready} onClick={play} style={narrow ? { minHeight: 44 } : {}}>{ready ? "▶ Hear it" : "Loading clips…"}</Btn>}
        <span style={{ fontSize: 12, color: DS.mut }}>{playing ? (state.phase === "intro" ? "Intro card" : state.phase === "outro" ? "End card" : `Clip ${state.i + 1} of ${clips.length}`) + ` · ${Math.round(T)} s` : `Plays the cut with ${track ? `"${track.title}" under it` : "its own sound only"} — move the sliders while it plays.`}</span>
      </div>
      {err && <div style={{ fontSize: 12, color: DS.orange, marginTop: 4 }}>{err}</div>}
      <div style={{ display: playing ? "block" : "none", position: "relative", maxWidth: 220, aspectRatio: "9 / 16", marginTop: 8, background: "#000", borderRadius: 8, overflow: "hidden" }}>
        <video ref={vidRef} crossOrigin="anonymous" playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover", display: state?.phase === "clip" ? "block" : "none" }} />
        {state && state.phase !== "clip" && (cover
          ? <img src={cover} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: DS.mut, fontSize: 12 }}>{state.phase === "intro" ? "Intro card" : "End card"}</div>)}
      </div>
      <audio ref={musRef} src={track?.url || undefined} crossOrigin="anonymous" loop preload="auto" style={{ display: "none" }} />
    </div>
  );
}
