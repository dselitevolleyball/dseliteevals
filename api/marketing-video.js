// POST /api/marketing-video — HQ → Marketing → Videos (directors only).
//
//   Authorization: Bearer <Supabase session token> of a DSSC director
//   Body: JSON { action, ... } -> 200 { ok: true, ... } | 4xx/5xx { error }
//
//   upload_done  { path, filename, bytes, content_type, source? }   the browser finished a resumable
//                upload to marketing-video/<path>; registers it and sorts it (contact sheets + Claude)
//   analyze      { id }                                              sort it again
//   reel_create  { picks?: [{ video_id, moment_id }], video_ids?, line?, instruction?, day? }
//                a reel draft (kind 'reel') - Claude orders the clips and writes the words
//   reel_update  { id, video }                                       the cut: clips (order, in/out),
//                music, volumes; it needs a new render (an approved reel goes back to draft)
//   reel_render  { id, cards: { intro, outro, overlay } }            ffmpeg renders the MP4
//
// The heavy lifting is api/_lib/marketing-video.js (ffmpeg-static). 300 s, 3 GB.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.

import { readBody } from "./_lib/site-forms.js";
import { verifyDirector } from "./_lib/site-inbox.js";
import { serviceSb, loadSettings, log } from "./_lib/marketing-core.js";
import { analyzeVideo, createReel, renderReel, RAW_BUCKET } from "./_lib/marketing-video.js";

const fail = (status, error) => Object.assign(new Error(error), { status });

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }
  const sb = serviceSb();
  if (!sb) return res.status(500).json({ error: "Server not configured" });
  const who = await verifyDirector(sb, req);
  if (who.error) return res.status(who.status).json({ error: who.status === 403 ? "Marketing is for the club's directors" : who.error });
  const body = readBody(req);
  try {
    return res.status(200).json({ ok: true, ...(await runVideo(sb, who, body)) });
  } catch (e) {
    console.error("marketing-video", body?.action, e);
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

const isHttpsOk = (u) => /^https:\/\/\S+$/.test(String(u || ""));

export async function runVideo(sb, { me }, b, { deadline = Date.now() + 280000 } = {}) {
  switch (b.action) {
    case "upload_done": {
      const path = String(b.path || "");
      if (!/^raw\/[\w./-]+$/.test(path) || path.includes("..")) throw fail(400, "Bad upload path");
      const row = { path, filename: String(b.filename || "").slice(0, 200) || null, bytes: Number(b.bytes) || null, content_type: String(b.content_type || "").slice(0, 60) || null,
        source: ["glasses", "phone", "upload"].includes(b.source) ? b.source : /^(VID|PXL|IMG)_|\.mov$/i.test(String(b.filename || "")) ? "phone" : "upload", status: "analyzing", created_by: me };
      const { data: existing } = await sb.from("mkt_videos").select("*").eq("path", path).maybeSingle();
      const video = existing || (await sb.from("mkt_videos").insert(row).select("*").single()).data;
      if (!video) throw fail(500, "Couldn't save the video");
      const settings = await loadSettings(sb);
      try { return { video: await analyzeVideo(sb, video, { deadline, settings }) }; }
      catch (e) { const { data } = await sb.from("mkt_videos").select("*").eq("id", video.id).single(); return { video: data, error: e.message }; }
    }

    case "analyze": {
      const { data: video } = await sb.from("mkt_videos").select("*").eq("id", Number(b.id)).maybeSingle();
      if (!video) throw fail(404, "That video is gone");
      const settings = await loadSettings(sb);
      return { video: await analyzeVideo(sb, video, { deadline, settings }) };
    }

    case "reel_create": {
      const settings = await loadSettings(sb);
      const picks = Array.isArray(b.picks) ? b.picks.filter(p => p && Number(p.video_id) > 0 && /^m\d+$/.test(String(p.moment_id))).slice(0, 12) : null;
      const item = await createReel(sb, { picks, videoIds: Array.isArray(b.video_ids) ? b.video_ids.map(Number).filter(Boolean) : null, line: b.line || null, instruction: String(b.instruction || "").slice(0, 500), day: /^\d{4}-\d{2}-\d{2}$/.test(b.day || "") ? b.day : null, by: me, settings })
        .catch(e => { throw fail(400, e.message); });
      await log(sb, item.id, "reel_create", { by: me, clips: item.video.clips.length });
      return { item };
    }

    case "reel_update": {
      const { data: item } = await sb.from("mkt_items").select("*").eq("id", Number(b.id)).maybeSingle();
      if (!item || item.kind !== "reel") throw fail(404, "That reel is gone");
      if (["publishing", "published"].includes(item.status)) throw fail(409, `Already ${item.status}`);
      const v = b.video && typeof b.video === "object" ? b.video : {};
      const clips = (Array.isArray(v.clips) ? v.clips : item.video?.clips || []).map(c => ({ video_id: Number(c.video_id), moment_id: c.moment_id || null, start: Math.max(0, +(+c.start).toFixed(2)), end: +(+c.end).toFixed(2), label: String(c.label || "").slice(0, 60) }))
        .filter(c => c.video_id > 0 && c.end - c.start >= 0.5 && c.end - c.start <= 15).slice(0, 12);
      if (!clips.length) throw fail(400, "Keep at least one clip");
      const next = { ...(item.video || {}), clips,
        music_id: "music_id" in v ? (Number(v.music_id) || null) : item.video?.music_id || null,
        music_volume: "music_volume" in v ? Math.max(0, Math.min(1, +v.music_volume || 0)) : item.video?.music_volume ?? 0.3,
        original_volume: "original_volume" in v ? Math.max(0, Math.min(1.5, +v.original_volume || 0)) : item.video?.original_volume ?? 1 };
      const patch = { video: next, render_status: "needs_render", render_error: null };
      if (item.status === "approved") Object.assign(patch, { status: "draft", approved_by: null, approved_at: null });
      const { data, error } = await sb.from("mkt_items").update(patch).eq("id", item.id).select("*").single();
      if (error) throw fail(500, error.message);
      return { item: data };
    }

    case "reel_render": {
      const { data: item } = await sb.from("mkt_items").select("*").eq("id", Number(b.id)).maybeSingle();
      if (!item || item.kind !== "reel") throw fail(404, "That reel is gone");
      if (["publishing", "published"].includes(item.status)) throw fail(409, `Already ${item.status}`);
      const c = b.cards && typeof b.cards === "object" ? b.cards : {};
      const cards = Object.fromEntries(["intro", "outro", "overlay"].filter(k => isHttpsOk(c[k])).map(k => [k, c[k]]));
      const done = await renderReel(sb, item, { cards, deadline }).catch(e => { throw fail(500, "Render failed: " + e.message); });
      await log(sb, item.id, "reel_render", { by: me, seconds: done.video?.duration || null });
      return { item: done };
    }

    default:
      throw fail(400, `Unknown action "${b.action || ""}"`);
  }
}

export { RAW_BUCKET };
