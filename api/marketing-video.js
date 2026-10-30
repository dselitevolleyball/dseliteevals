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
//   collection_plan { id, count?, instruction? }                    Claude reads every moment across a
//                collection's videos and plans `count` reels (plan.ideas)
//   collection_reel { id, idea_id }                                 one planned idea -> a reel draft
//   New reels go to the Reels shelf (no date) unless reel_create is given a day:
//   reel_schedule { id, day, time? }   shelf -> the calendar, as a draft to approve that week
//   reel_shelve   { id }               the calendar -> back to the shelf (not once it's posted)
//   reel_delete   { id }               throw a shelf reel away
//
// The heavy lifting is api/_lib/marketing-video.js (ffmpeg-static). 300 s, 3 GB.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.

import { readBody } from "./_lib/site-forms.js";
import { verifyDirector } from "./_lib/site-inbox.js";
import { serviceSb, loadSettings, log } from "./_lib/marketing-core.js";
import { SHELF_WEEK, weekStartOf } from "../shared/marketing-plan.js";
import { ctIso, ctToday } from "./_lib/marketing-ai.js";
import { analyzeVideo, createReel, renderReel, planCollection, RAW_BUCKET } from "./_lib/marketing-video.js";

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

const reelById = async (sb, id) => { const { data } = await sb.from("mkt_items").select("*").eq("id", Number(id)).maybeSingle(); if (!data || data.kind !== "reel") throw fail(404, "That reel is gone"); return data; };
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
      const day = /^\d{4}-\d{2}-\d{2}$/.test(b.day || "") ? b.day : null;
      const item = await createReel(sb, { picks, videoIds: Array.isArray(b.video_ids) ? b.video_ids.map(Number).filter(Boolean) : null, line: b.line || null, instruction: String(b.instruction || "").slice(0, 500), day, shelf: !day, by: me, settings })
        .catch(e => { throw fail(400, e.message); });
      await log(sb, item.id, "reel_create", { by: me, clips: item.video.clips.length });
      return { item };
    }

    // A collection (several videos from one session): Claude plans a few reels
    // across all of them; each idea then becomes a reel draft like any other.
    case "collection_plan": {
      const { data: coll } = await sb.from("mkt_video_collections").select("*").eq("id", Number(b.id)).maybeSingle();
      if (!coll) throw fail(404, "That collection is gone");
      const settings = await loadSettings(sb);
      const collection = await planCollection(sb, coll, { count: b.count, instruction: String(b.instruction || "").slice(0, 500), settings }).catch(e => { throw fail(400, e.message); });
      return { collection };
    }
    case "collection_reel": {
      const { data: coll } = await sb.from("mkt_video_collections").select("*").eq("id", Number(b.id)).maybeSingle();
      if (!coll) throw fail(404, "That collection is gone");
      const idea = (coll.plan?.ideas || []).find(x => x.id === b.idea_id);
      if (!idea) throw fail(404, "That reel idea is gone - plan again");
      const settings = await loadSettings(sb);
      const item = await createReel(sb, { picks: idea.picks.map(p => ({ video_id: p.video_id, moment_id: p.moment_id })), line: coll.line || null, instruction: `${idea.title}: ${idea.angle}`.slice(0, 500), shelf: true, by: me, settings })
        .catch(e => { throw fail(400, e.message); });
      await log(sb, item.id, "reel_create", { by: me, clips: item.video.clips.length, collection: coll.id });
      // Re-read so two ideas made at once don't overwrite each other's reel_id.
      const { data: now } = await sb.from("mkt_video_collections").select("plan").eq("id", coll.id).single();
      const plan = { ...(now?.plan || coll.plan), ideas: (now?.plan?.ideas || coll.plan.ideas).map(x => x.id === idea.id ? { ...x, reel_id: item.id, week_of: item.week_of } : x) };
      await sb.from("mkt_video_collections").update({ plan }).eq("id", coll.id);
      return { item, plan };
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

    case "reel_schedule": {
      const item = await reelById(sb, b.id);
      if (["publishing", "published"].includes(item.status)) throw fail(409, `Already ${item.status}`);
      const day = String(b.day || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < ctToday()) throw fail(400, "Pick today or a later day");
      const time = /^\d{1,2}:\d{2}$/.test(b.time || "") ? b.time : (await loadSettings(sb)).cadence?.social?.time || "18:30";
      const { data, error } = await sb.from("mkt_items").update({ week_of: weekStartOf(day), scheduled_at: ctIso(day, time), status: "draft", approved_by: null, approved_at: null }).eq("id", item.id).select("*").single();
      if (error) throw fail(500, error.message);
      await log(sb, item.id, "reel_schedule", { by: me, day, time });
      return { item: data };
    }
    case "reel_shelve": {
      const item = await reelById(sb, b.id);
      if (["publishing", "published"].includes(item.status)) throw fail(409, `Already ${item.status}`);
      const { data, error } = await sb.from("mkt_items").update({ week_of: SHELF_WEEK, scheduled_at: null, status: "draft", approved_by: null, approved_at: null }).eq("id", item.id).select("*").single();
      if (error) throw fail(500, error.message);
      await log(sb, item.id, "reel_shelve", { by: me });
      return { item: data };
    }
    case "reel_delete": {
      const item = await reelById(sb, b.id);
      if (item.week_of !== SHELF_WEEK) throw fail(400, "Take it off the calendar first (Back to the shelf)");
      await sb.from("mkt_items").delete().eq("id", item.id);
      return {};
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
