// The Marketing Machine's video desk (Drew, 23 Oct 2026: "If I upload videos
// from meta glasses to the app - can you edit them and find cool videos to cut
// together"). Runs on Vercel with a static ffmpeg (ffmpeg-static).
//
//   analyzeVideo  ffmpeg reads the raw upload (private bucket marketing-video,
//                 over a short signed link) and lays frames out as contact
//                 sheets - a frame every half-second or so, 12 to a sheet,
//                 each frame's time known. Claude looks at the sheets and
//                 picks the moments worth posting (a kill at the net, a made
//                 three, a celebration, kids laughing): start/end, a score,
//                 a label, tags, recognizable kids. Each moment gets a
//                 thumbnail cut from its sheet. Claude can't hear: it picks by
//                 what it sees; the reel keeps the clip's own sound.
//   createReel    Claude picks and orders 3-6 moments (or uses the ones a
//                 director picked), writes the headline and caption, and a
//                 music track is chosen from the club's library - a draft
//                 mkt_items row, kind 'reel', render_status needs_render.
//   renderReel    ffmpeg cuts the clips to 1080x1920 at 30fps, adds the intro
//                 card, the headline overlay and the end card (PNGs drawn in HQ
//                 with the club's graphics renderer), mixes the music under the
//                 original sound, and encodes H.264 + AAC with faststart - what
//                 Instagram and Facebook Reels take. The MP4 goes to the public
//                 marketing bucket (items/<id>/reel-<ts>.mp4).

import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import Anthropic from "@anthropic-ai/sdk";
import { LINE_KEYS, LINE_LINKS, lineLabel, lineUrl, addDays, mondayOf } from "../../shared/marketing-plan.js";
import { AI_MODEL, aiReady, flairText, ctIso, ctToday } from "./marketing-ai.js";

export const RAW_BUCKET = "marketing-video";
export const PUBLIC_BUCKET = "marketing";
export const W = 1080, H = 1920, FPS = 30;
export const INTRO = 1.2, OUTRO = 2.0;
const MAX_FRAMES = 96, PER_SHEET = 12, COLS = 4, ROWS = 3, TILE_W = 360;
export const MOMENT_TAGS = ["volleyball", "basketball", "reach", "camp", "parties", "kids", "teens", "adults", "action", "celebration", "teamwork", "coach", "funny", "skill", "game", "drill", "crowd", "facility", "behind_the_scenes"];

// ── ffmpeg ───────────────────────────────────────────────────────────────────
export function ffmpeg(args, { timeoutMs = 240000 } = {}) {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath, ["-hide_banner", "-nostdin", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", d => { err += d; if (err.length > 400000) err = err.slice(-200000); });
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("close", (code) => { clearTimeout(t); resolve({ code, stderr: err }); });
    p.on("error", (e) => { clearTimeout(t); resolve({ code: -1, stderr: String(e?.message || e) }); });
  });
}
const tail = (s) => String(s || "").trim().split("\n").slice(-4).join(" | ").slice(0, 400);

// Duration, size (after rotation), audio - from ffmpeg's own report.
export function parseProbe(stderr) {
  const s = String(stderr || "");
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
  const duration = d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : null;
  const v = /Stream #\S+.*Video:.*?(\d{2,5})x(\d{2,5})/.exec(s);
  let width = v ? +v[1] : null, height = v ? +v[2] : null;
  const rot = /rotat(?:e|ion of)\s*:?\s*(-?\d+(?:\.\d+)?)/i.exec(s);
  if (rot && Math.abs(Math.round(+rot[1])) % 180 === 90) [width, height] = [height, width];
  return { duration, width, height, has_audio: /Stream #\S+.*Audio:/.test(s) };
}
export async function probe(input) {
  const r = await ffmpeg(["-i", input], { timeoutMs: 60000 });
  return parseProbe(r.stderr);
}

export async function rawUrl(sb, path, secs = 3600) {
  const { data, error } = await sb.storage.from(RAW_BUCKET).createSignedUrl(path, secs);
  if (error || !data?.signedUrl) throw new Error("Couldn't open the video: " + (error?.message || "no link"));
  return data.signedUrl;
}
async function putPublic(sb, path, buf, contentType) {
  const { error } = await sb.storage.from(PUBLIC_BUCKET).upload(path, buf, { contentType, upsert: true, cacheControl: "31536000" });
  if (error) throw new Error("Upload " + path + ": " + error.message);
  return sb.storage.from(PUBLIC_BUCKET).getPublicUrl(path).data.publicUrl;
}

// ── analysis ─────────────────────────────────────────────────────────────────
// The frame rate that keeps a video to MAX_FRAMES sampled frames (2 a second at most).
export const sampleFps = (duration) => Math.max(0.05, Math.min(2, MAX_FRAMES / Math.max(1, duration || 1)));

const M_SCHEMA = {
  type: "object", additionalProperties: false, required: ["description", "line", "tags", "minors", "moments"],
  properties: {
    description: { type: "string" }, line: { type: "string", enum: [...LINE_KEYS, "none"] },
    tags: { type: "array", items: { type: "string", enum: MOMENT_TAGS } }, minors: { type: "boolean" },
    moments: { type: "array", items: { type: "object", additionalProperties: false, required: ["start", "end", "score", "label", "description", "tags", "minors"], properties: {
      start: { type: "number" }, end: { type: "number" }, score: { type: "integer", enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      label: { type: "string" }, description: { type: "string" }, tags: { type: "array", items: { type: "string", enum: MOMENT_TAGS } }, minors: { type: "boolean" },
    } } },
  },
};
const M_SYSTEM = `You are the video editor for Dripping Springs Sports Club (DSSC) in Dripping Springs, Texas - youth and adult volleyball, basketball, Reach Performance (speed and strength training), Camp Elevate, birthday parties and open gym. Much of the footage is first-person, shot on Meta smart glasses by a coach or director on the court.

You get contact sheets: frames from one video laid out in a grid, left to right, top to bottom, each frame's time in seconds listed for you. Find the moments worth putting in a short social reel:
- peaks of action (a spike, a block, a made shot, a dig, a sprint finish), celebrations, high fives, kids laughing, a great rep, a coach's moment with an athlete, a big crowd reaction, a funny beat;
- start a moment a little before the action and end it just after (usually 2 to 6 seconds); never longer than 10 seconds; moments must not overlap;
- score 1-10 for how good it would look in a reel (10 = stop-the-scroll); skip dull stretches, blurry or shaky frames, floors and ceilings;
- label: 2-5 words ("Kill at the net", "Team huddle cheer"); description: one sentence of what happens.
- minors: true when a child's face can be recognized in that moment.
Also describe the whole video in one sentence, pick its program line and tags. Describe only what you can see; never name people. Up to 12 moments, best ones first is fine - order doesn't matter.`;

// Clean Claude's moments: inside the video, 1.5-10 s, no overlaps (the better one wins).
export function cleanMoments(list, duration) {
  const dur = Number(duration) || 0;
  const ms = (Array.isArray(list) ? list : []).map(m => {
    let s = Math.max(0, Number(m?.start) || 0), e = Math.min(dur || Infinity, Number(m?.end) || 0);
    if (!(e > s)) e = s + 3;
    if (e - s < 1.5) { const mid = (s + e) / 2; s = Math.max(0, mid - 1); e = Math.min(dur || mid + 1, mid + 1); }
    if (e - s > 10) e = s + 10;
    return { start: +s.toFixed(2), end: +e.toFixed(2), score: Math.max(1, Math.min(10, Math.round(+m?.score || 5))), label: String(m?.label || "Moment").trim().slice(0, 60),
      description: String(m?.description || "").trim().slice(0, 240), tags: (m?.tags || []).filter(t => MOMENT_TAGS.includes(t)), minors: !!m?.minors };
  }).filter(m => m.end - m.start >= 1).sort((a, b) => b.score - a.score);
  const kept = [];
  for (const m of ms) if (!kept.some(k => m.start < k.end && k.start < m.end)) kept.push(m);
  return kept.slice(0, 12).sort((a, b) => a.start - b.start).map((m, i) => ({ id: `m${i + 1}`, ...m }));
}
// Without Claude: even slices, so a reel can still be cut.
export function evenMoments(duration) {
  const d = Number(duration) || 0, n = Math.max(1, Math.min(6, Math.floor(d / 6)));
  return Array.from({ length: n }, (_, i) => { const s = +(((i + 0.5) * d) / n - 1.5).toFixed(2); return { id: `m${i + 1}`, start: Math.max(0, s), end: Math.min(d, Math.max(0, s) + 3), score: 5, label: `Clip ${i + 1}`, description: "", tags: [], minors: false }; });
}

// -> the updated mkt_videos row
export async function analyzeVideo(sb, video, { deadline = Date.now() + 250000, settings = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "vid-"));
  const fail = async (msg) => { await sb.from("mkt_videos").update({ status: "failed", ai_error: msg.slice(0, 400) }).eq("id", video.id); throw new Error(msg); };
  try {
    await sb.from("mkt_videos").update({ status: "analyzing", ai_error: null }).eq("id", video.id);
    const url = await rawUrl(sb, video.path);
    const info = await probe(url);
    if (!info.duration) return await fail("ffmpeg couldn't read this video");
    const fps = sampleFps(info.duration);
    // Contact sheets + a poster, in one pass over the file.
    const posterAt = Math.min(info.duration / 3, 2);
    const r = await ffmpeg(["-i", url, "-filter_complex", `[0:v]split=2[a][b];[a]fps=${fps.toFixed(4)},scale=${TILE_W}:-2,tile=${COLS}x${ROWS}[s];[b]trim=start=${posterAt.toFixed(2)}:duration=0.5,setpts=PTS-STARTPTS,scale=720:-2[p]`,
      "-map", "[s]", "-q:v", "4", join(dir, "sheet-%02d.jpg"), "-map", "[p]", "-frames:v", "1", "-q:v", "3", join(dir, "poster.jpg")], { timeoutMs: Math.max(30000, deadline - Date.now() - 60000) });
    const files = (await readdir(dir)).filter(f => /^sheet-\d+\.jpg$/.test(f)).sort();
    if (!files.length) return await fail("Couldn't read frames: " + tail(r.stderr));
    const base = `videos/${video.id}`;
    const stamp = Date.now().toString(36);
    const sheets = [];
    for (let i = 0; i < files.length; i++) {
      const u = await putPublic(sb, `${base}/sheet-${stamp}-${i + 1}.jpg`, await readFile(join(dir, files[i])), "image/jpeg");
      sheets.push({ url: u, first: i * PER_SHEET, frames: PER_SHEET, step: +(1 / fps).toFixed(3) });
    }
    let poster_url = null;
    try { poster_url = await putPublic(sb, `${base}/poster-${stamp}.jpg`, await readFile(join(dir, "poster.jpg")), "image/jpeg"); } catch { /* no poster */ }

    // Claude picks the moments.
    let ai = null, aiErr = null, model = null;
    if (aiReady() && Date.now() < deadline - 40000) {
      try {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: Math.min(120000, deadline - Date.now() - 20000), maxRetries: 1 });
        const total = files.length * PER_SHEET;
        const times = Array.from({ length: total }, (_, k) => +(k / fps).toFixed(2)).filter(t => t <= info.duration);
        const content = [];
        sheets.forEach((s, i) => {
          const ts = times.slice(i * PER_SHEET, (i + 1) * PER_SHEET);
          content.push({ type: "text", text: `Sheet ${i + 1}: frames at ${ts.map(t => t + "s").join(", ")} (${COLS} across, ${ROWS} down).` });
          content.push({ type: "image", source: { type: "url", url: s.url } });
        });
        content.push({ type: "text", text: `The video is ${info.duration.toFixed(1)} seconds long${video.filename ? ` (file: ${video.filename})` : ""}. Find the moments.` });
        const msg = await client.beta.messages.create({
          model: AI_MODEL, max_tokens: 12000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
          output_config: { effort: "medium", format: { type: "json_schema", schema: M_SCHEMA } },
          system: M_SYSTEM, messages: [{ role: "user", content }],
        });
        model = msg.model;
        if (msg.stop_reason === "refusal") aiErr = "Claude declined";
        else if (msg.stop_reason === "max_tokens") aiErr = "Claude ran out of room";
        else ai = JSON.parse((msg.content || []).filter(b => b.type === "text").map(b => b.text).join(""));
      } catch (e) { aiErr = e?.message || String(e); }
    } else aiErr = aiReady() ? "out of time" : "ANTHROPIC_API_KEY is not set";

    const moments = ai ? cleanMoments(ai.moments, info.duration) : evenMoments(info.duration);
    // A thumbnail per moment, cut from its sheet (no second pass over the video).
    const tileH = Math.round(TILE_W * (info.height && info.width ? info.height / info.width : 4 / 3) / 2) * 2;
    for (const m of moments) {
      const k = Math.min(Math.round(((m.start + m.end) / 2) * fps), files.length * PER_SHEET - 1);
      const sheet = Math.floor(k / PER_SHEET), pos = k % PER_SHEET;
      const out = join(dir, `${m.id}.jpg`);
      const c = await ffmpeg(["-y", "-i", join(dir, files[sheet]), "-vf", `crop=${TILE_W}:${tileH}:${(pos % COLS) * TILE_W}:${Math.floor(pos / COLS) * tileH}`, "-q:v", "4", out], { timeoutMs: 20000 });
      if (c.code === 0) { try { m.thumb_url = await putPublic(sb, `${base}/${m.id}-${stamp}.jpg`, await readFile(out), "image/jpeg"); } catch { /* none */ } }
    }
    const patch = {
      status: "ready", duration: +info.duration.toFixed(2), width: info.width, height: info.height, has_audio: info.has_audio, poster_url, sheets, moments,
      description: ai?.description?.slice(0, 400) || video.description || null, line: video.line || (LINE_KEYS.includes(ai?.line) ? ai.line : null),
      tags: [...new Set([...(video.tags || []), ...((ai?.tags) || []).filter(t => MOMENT_TAGS.includes(t))])], minors: ai ? !!ai.minors || moments.some(m => m.minors) : null,
      ai_at: new Date().toISOString(), ai_model: model, ai_error: aiErr,
    };
    const { data, error } = await sb.from("mkt_videos").update(patch).eq("id", video.id).select("*").single();
    if (error) throw new Error(error.message);
    return data;
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

// ── reels ────────────────────────────────────────────────────────────────────
const MOOD = ["upbeat", "hype", "chill", "warm", "epic", "fun"];
const R_SCHEMA = {
  type: "object", additionalProperties: false, required: ["order", "headline", "accent", "sub", "tag", "caption", "hashtags", "mood"],
  properties: {
    order: { type: "array", items: { type: "string" } }, headline: { type: "string" }, accent: { type: "string" }, sub: { type: "string" }, tag: { type: "string" },
    caption: { type: "string" }, hashtags: { type: "array", items: { type: "string" } }, mood: { type: "string", enum: MOOD },
  },
};
const key = (videoId, momentId) => `v${videoId}${momentId}`;
const BANNED = /\$\s?\d|\bspots?\s+(left|remaining)\b|\bsold\s+out\b|\bflex\b/i;

// The clip list for a reel: each moment capped at maxLen seconds, total 12-35 s.
export function clipsFrom(moments, { maxLen = 5, maxTotal = 30 } = {}) {
  const out = []; let total = 0;
  for (const m of moments) {
    if (total >= maxTotal) break;
    const len = Math.min(maxLen, m.end - m.start, maxTotal - total);
    if (len < 1) continue;
    const mid = (m.start + m.end) / 2, s = Math.max(m.start, +(mid - len / 2).toFixed(2));
    out.push({ video_id: m.video_id, moment_id: m.id, start: s, end: +(s + len).toFixed(2), label: m.label });
    total += len;
  }
  return out;
}

// opts: { picks: [{ video_id, moment_id }] (in order) | videoIds | line, instruction, day, by, settings }
// -> the new mkt_items row (kind 'reel', needs_render)
export async function createReel(sb, { picks = null, videoIds = null, line = null, instruction = "", day = null, by = "auto", settings = {}, today = ctToday() } = {}) {
  let q = sb.from("mkt_videos").select("*").eq("status", "ready").eq("active", true);
  const ids = picks?.length ? [...new Set(picks.map(p => Number(p.video_id)))] : videoIds?.length ? videoIds.map(Number) : null;
  if (ids) q = q.in("id", ids); else q = q.gte("created_at", addDays(today, -21)).order("created_at", { ascending: false }).limit(20);
  const { data: vids, error } = await q;
  if (error) throw new Error(error.message);
  const usable = (vids || []).filter(v => v.release_ok !== false && (!line || !v.line || v.line === line || ids));
  const all = usable.flatMap(v => (v.moments || []).filter(m => !m.skip && !(m.minors && v.release_ok === false)).map(m => ({ ...m, video_id: v.id, v })));
  let chosen = picks?.length ? picks.map(p => all.find(m => m.video_id === Number(p.video_id) && m.id === p.moment_id)).filter(Boolean) : all.slice().sort((a, b) => b.score - a.score);
  if (!chosen.length) throw new Error(ids ? "Those clips aren't ready yet" : "No sorted videos from the last 3 weeks - upload some first");
  const mainLine = line || mostCommon(chosen.map(m => m.v.line).filter(Boolean)) || "club";
  // Claude orders (and, when nobody picked, chooses) the moments and writes the words.
  let copy = null;
  if (aiReady()) {
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60000, maxRetries: 1 });
      const pool = chosen.slice(0, 24).map(m => ({ key: key(m.video_id, m.id), label: m.label, description: m.description, score: m.score, seconds: +(m.end - m.start).toFixed(1), tags: m.tags, video: m.v.description || m.v.filename }));
      const msg = await client.beta.messages.create({
        model: AI_MODEL, max_tokens: 6000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema: R_SCHEMA } },
        system: `You cut short social reels (15-30 seconds, vertical) for Dripping Springs Sports Club, "Where Dripping Springs plays." From the moments given, ${picks?.length ? "keep all of them, in the best order" : "pick the 3 to 6 that make the best reel"}: open with the strongest, build, end on a celebration or a smile. Then write: headline (2-5 words, the big words over the first seconds), accent (one word of it), sub (under 40 characters), tag (1-3 words), caption (2-4 short sentences, no URL, no hashtags in it), hashtags (3-5, no #, include DrippingSprings), mood (for the music). Only describe what the moments show; no names, no prices, never "the Flex". ${flairText(settings.flair)}`,
        messages: [{ role: "user", content: JSON.stringify({ line: lineLabel(mainLine), director_instruction: String(instruction || "").trim() || undefined, moments: pool }, null, 1) }],
      });
      if (msg.stop_reason !== "refusal" && msg.stop_reason !== "max_tokens") copy = JSON.parse((msg.content || []).filter(b => b.type === "text").map(b => b.text).join(""));
    } catch { copy = null; }
  }
  if (copy && !BANNED.test(`${copy.headline} ${copy.caption}`)) {
    const byKey = new Map(chosen.map(m => [key(m.video_id, m.id), m]));
    const ordered = (copy.order || []).map(k => byKey.get(k)).filter(Boolean);
    if (ordered.length >= Math.min(3, chosen.length)) chosen = [...new Set(picks?.length ? [...ordered, ...chosen] : ordered)];
  } else copy = null;
  if (!picks?.length) chosen = chosen.slice(0, 6);
  const clips = clipsFrom(chosen);
  const first = chosen[0];
  const music = await pickMusic(sb, copy?.mood);
  const headline = (copy?.headline || defaultHeadline(mainLine)).toUpperCase().slice(0, 50);
  const d = day && day >= today ? day : addDays(today, 2);
  const row = {
    week_of: mondayOf(d), channel: "social", kind: "reel", theme: "Reel", line: mainLine, program: null, programs: [], angle: "reel", status: "draft",
    platforms: ["instagram", "facebook"], scheduled_at: ctIso(d, settings.cadence?.social?.time || "18:30"),
    reason: `Reel from ${new Set(chosen.map(m => m.video_id)).size} video${new Set(chosen.map(m => m.video_id)).size === 1 ? "" : "s"}: ${chosen.map(m => m.label).join(" · ")}`,
    headline, body: copy?.caption || `${lineLabel(mainLine)} at DSSC - where Dripping Springs plays.`, hashtags: (copy?.hashtags || ["DrippingSprings", "DSSC"]).map(h => String(h).replace(/[^A-Za-z0-9_]/g, "")).filter(Boolean).slice(0, 6),
    cta_text: LINE_LINKS[mainLine]?.cta || "See what's coming up", cta_url: lineUrl(mainLine), audience: null, created_by: by,
    email_subject: null, email_preheader: null, email_html: null, email_blocks: [],
    graphic: { template: "photo", format: "story", photo_url: first?.thumb_url || first?.v.poster_url || null, headline, accent: (copy?.accent || headline.split(" ").pop()).toUpperCase(), sub: copy?.sub || "", tag: (copy?.tag || lineLabel(mainLine)).toUpperCase(), date_label: "", items: [] },
    video: { clips, music_id: music?.id || null, music_volume: music ? 0.3 : 0, original_volume: 1, cards: null },
    render_status: "needs_render",
  };
  const { data: item, error: e2 } = await sb.from("mkt_items").insert(row).select("*").single();
  if (e2) throw new Error("Saving the reel: " + e2.message);
  return item;
}
const mostCommon = (xs) => { const c = {}; for (const x of xs) c[x] = (c[x] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null; };
const defaultHeadline = (line) => ({ volleyball: "VOLLEYBALL AT DSSC", basketball: "BUCKETS AT DSSC", reach: "TRAIN WITH REACH", camp_elevate: "CAMP ELEVATE", parties: "PARTY TIME", open_gym: "OPEN GYM", rentals: "GAME ON", club: "THIS WEEK AT DSSC" }[line] || "THIS WEEK AT DSSC");

export async function pickMusic(sb, mood) {
  const { data } = await sb.from("mkt_music").select("*").eq("active", true).eq("rights_ok", true);
  const list = data || [];
  if (!list.length) return null;
  return list.slice().sort((a, b) => Number((b.mood || []).includes(mood)) - Number((a.mood || []).includes(mood)) || (a.used_count || 0) - (b.used_count || 0))[0];
}

// The ffmpeg command for a reel. inputs: { cards: { intro, outro, overlay } (paths or URLs),
// clips: [{ url, start, end, has_audio }], music: { url, volume } | null, originalVolume }
export function reelArgs({ cards = {}, clips, music = null, originalVolume = 1, out }) {
  const args = ["-y"], f = [], seg = [];
  let n = 0;
  const intro = cards.intro ? INTRO : 0, outro = cards.outro ? OUTRO : 0;
  const clipTotal = clips.reduce((s, c) => s + (c.end - c.start), 0);
  const T = +(intro + clipTotal + outro).toFixed(3);
  const vfmt = `setsar=1,fps=${FPS},format=yuv420p`;
  const silence = (d, label) => f.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${d.toFixed(3)},asetpts=PTS-STARTPTS[${label}]`);
  const afmt = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
  if (intro) {
    args.push("-loop", "1", "-t", String(intro), "-i", cards.intro);
    f.push(`[${n}:v]scale=${W}:${H},${vfmt},trim=duration=${intro}[v${n}]`); silence(intro, `a${n}`); seg.push(n); n++;
  }
  for (const c of clips) {
    const d = +(c.end - c.start).toFixed(3);
    args.push("-ss", String(c.start), "-t", String(d), "-i", c.url);
    f.push(`[${n}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},${vfmt},trim=duration=${d},setpts=PTS-STARTPTS[v${n}]`);
    if (c.has_audio) f.push(`[${n}:a]${afmt},atrim=duration=${d},asetpts=PTS-STARTPTS,volume=${originalVolume}[a${n}]`); else silence(d, `a${n}`);
    seg.push(n); n++;
  }
  if (outro) {
    args.push("-loop", "1", "-t", String(outro), "-i", cards.outro);
    f.push(`[${n}:v]scale=${W}:${H},${vfmt},trim=duration=${outro}[v${n}]`); silence(outro, `a${n}`); seg.push(n); n++;
  }
  f.push(`${seg.map(i => `[v${i}][a${i}]`).join("")}concat=n=${seg.length}:v=1:a=1[vc][ac]`);
  let v = "vc";
  if (cards.overlay && clipTotal > 0) {
    args.push("-loop", "1", "-t", String(T), "-i", cards.overlay);
    f.push(`[${n}:v]scale=${W}:${H},format=rgba[ol]`, `[vc][ol]overlay=0:0:enable='between(t,${intro.toFixed(3)},${(intro + clipTotal).toFixed(3)})'[vo]`);
    v = "vo"; n++;
  }
  f.push(`[${v}]fade=t=in:st=0:d=0.25,fade=t=out:st=${Math.max(0, T - 0.35).toFixed(3)}:d=0.35[vout]`);
  if (music?.url && music.volume > 0) {
    args.push("-stream_loop", "-1", "-i", music.url);
    f.push(`[${n}:a]${afmt},atrim=duration=${T},asetpts=PTS-STARTPTS,volume=${music.volume},afade=t=in:d=0.6,afade=t=out:st=${Math.max(0, T - 1.5).toFixed(3)}:d=1.5[mu]`,
      `[ac][mu]amix=inputs=2:duration=first:normalize=0[aout]`);
    n++;
  } else f.push(`[ac]afade=t=out:st=${Math.max(0, T - 0.6).toFixed(3)}:d=0.6[aout]`);
  args.push("-filter_complex", f.join(";"), "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-maxrate", "8M", "-bufsize", "16M", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", "-t", String(T), out);
  return { args, duration: T };
}

// -> the updated item. cards: { intro, outro, overlay } public PNG URLs (drawn in HQ).
export async function renderReel(sb, item, { cards = null, deadline = Date.now() + 260000 } = {}) {
  const spec = item.video || {};
  const clips = (spec.clips || []).filter(c => c.end > c.start);
  if (!clips.length) throw new Error("The reel has no clips");
  const ids = [...new Set(clips.map(c => Number(c.video_id)))];
  const { data: vids } = await sb.from("mkt_videos").select("id, path, has_audio, status").in("id", ids);
  const byId = new Map((vids || []).map(v => [v.id, v]));
  const inputs = [];
  for (const c of clips) {
    const v = byId.get(Number(c.video_id));
    if (!v) throw new Error(`A clip's video (#${c.video_id}) is gone`);
    inputs.push({ url: await rawUrl(sb, v.path, 1800), start: c.start, end: c.end, has_audio: v.has_audio !== false });
  }
  let music = null;
  if (spec.music_id && Number(spec.music_volume) > 0) {
    const { data: m } = await sb.from("mkt_music").select("id, url, rights_ok, active").eq("id", spec.music_id).maybeSingle();
    if (m?.url && m.rights_ok && m.active !== false) music = { url: m.url, volume: Math.max(0, Math.min(1, Number(spec.music_volume))) };
  }
  const useCards = cards || spec.cards || {};
  await sb.from("mkt_items").update({ render_status: "rendering", render_error: null }).eq("id", item.id);
  const dir = await mkdtemp(join(tmpdir(), "reel-"));
  try {
    const out = join(dir, "reel.mp4");
    const { args, duration } = reelArgs({ cards: useCards, clips: inputs, music, originalVolume: Number.isFinite(+spec.original_volume) ? Math.max(0, Math.min(1.5, +spec.original_volume)) : 1, out });
    const r = await ffmpeg(args, { timeoutMs: Math.max(30000, deadline - Date.now() - 20000) });
    if (r.code !== 0) throw new Error("ffmpeg: " + tail(r.stderr));
    const url = await putPublic(sb, `items/${item.id}/reel-${Date.now()}.mp4`, await readFile(out), "video/mp4");
    const patch = { asset_video_url: url, render_status: "rendered", render_error: null, rendered_at: new Date().toISOString(), video: { ...spec, cards: useCards, duration } };
    if (useCards.intro) patch.asset_url = useCards.intro;
    const { data, error } = await sb.from("mkt_items").update(patch).eq("id", item.id).select("*").single();
    if (error) throw new Error(error.message);
    return data;
  } catch (e) {
    await sb.from("mkt_items").update({ render_status: "failed", render_error: String(e.message || e).slice(0, 500) }).eq("id", item.id);
    throw e;
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
