// Checks the video desk (api/_lib/marketing-video.js) with the real ffmpeg
// (ffmpeg-static) on a synthetic clip: contact sheets + poster + moment
// thumbnails, Claude's moments cleaned, a reel picked and written, and the
// reel rendered to a 1080x1920 H.264/AAC MP4 with cards, overlay and music.
// Claude is stubbed; storage is the in-memory fake (files on local disk).
//
//   node scripts/test-marketing-video.mjs

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeSupabase } from "./lib/fake-supabase.mjs";

process.env.ANTHROPIC_API_KEY = "sk-test";
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) return realFetch(url, init);   // the test's own file server
  if (!u.startsWith("https://api.anthropic.com/")) throw new Error("Unexpected fetch: " + u);
  const req = JSON.parse(init.body); calls.push(req);
  const base = { id: "msg", type: "message", role: "assistant", model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "end_turn" };
  const schema = req.output_config?.format?.schema;
  const text = (o) => ({ ...base, content: [{ type: "text", text: JSON.stringify(o) }] });
  if (schema?.properties?.moments) return new Response(JSON.stringify(text({ description: "First-person view of a volleyball drill.", line: "volleyball", tags: ["volleyball", "action", "nope"], minors: true, moments: [
    { start: 2, end: 5, score: 9, label: "Kill at the net", description: "A spike lands.", tags: ["action"], minors: true },
    { start: 4, end: 7, score: 6, label: "Overlapping", description: "", tags: [], minors: false },          // overlaps the 9 -> dropped
    { start: 10, end: 10.4, score: 7, label: "Too short", description: "", tags: [], minors: false },         // widened to 1.5 s+
    { start: 13, end: 40, score: 8, label: "Huddle cheer", description: "Team cheers.", tags: ["celebration"], minors: false }, // capped at 10 s and the video's end
  ] })), { headers: { "content-type": "application/json" } });
  if (schema?.properties?.order) return new Response(JSON.stringify(text({ order: ["v1m3", "v1m1", "v1m2"], headline: "Friday night lights", accent: "lights", sub: "Volleyball at DSSC", tag: "Highlights", caption: "What a week at the Warehouse.", hashtags: ["DrippingSprings", "#DSSC"], mood: "hype" })), { headers: { "content-type": "application/json" } });
  throw new Error("Unexpected Claude request");
};

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) fails++; };
const V = await import("../api/_lib/marketing-video.js");
const dir = await mkdtemp(join(tmpdir(), "vtest-"));
const src = join(dir, "glasses.mp4");
// 20 s, 1440x1920 portrait, a tone for sound.
let r = await V.ffmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=1440x1920:rate=30:duration=20", "-f", "lavfi", "-i", "sine=frequency=440:duration=20", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", src]);
check(r.code === 0, "made a 20 s 1440x1920 test clip");

console.log("\n== probe ==");
const p = await V.probe(src);
check(Math.abs(p.duration - 20) < 0.2 && p.width === 1440 && p.height === 1920 && p.has_audio, `probe: ${JSON.stringify(p)}`);
const rot = V.parseProbe("Duration: 00:01:02.50, start\n  Stream #0:0: Video: hevc, yuv420p, 1920x1440, 30 fps\n    Side data:\n      displaymatrix: rotation of -90.00 degrees\n  Stream #0:1: Audio: aac");
check(rot.width === 1440 && rot.height === 1920 && rot.duration === 62.5 && rot.has_audio, "a phone/glasses rotation flag swaps width and height");
check(V.sampleFps(20) === 2 && Math.abs(V.sampleFps(480) - 0.2) < 1e-9, "2 frames a second, fewer for long videos (96 max)");

console.log("\n== analyze ==");
const sb = fakeSupabase({ mkt_videos: [{ id: 1, path: "raw/glasses.mp4", filename: "PXL_glasses.mp4", status: "analyzing", tags: [], moments: [], active: true }], mkt_items: [], mkt_music: [] });
sb.storage.files["marketing-video/raw/glasses.mp4"] = src;
const t0 = Date.now();
const v = await V.analyzeVideo(sb, sb.db.mkt_videos[0]);
console.log(`  (analysis took ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
const req = calls.find(c => c.output_config?.format?.schema?.properties?.moments);
check(v.status === "ready" && v.sheets.length === 4 && v.poster_url && v.duration === 20 && v.width === 1440 && v.has_audio, `ready: ${v.sheets.length} contact sheets, poster, ${v.duration}s`);
check(req.model === "claude-opus-5-5" && req.fallbacks === "default" && req.messages[0].content.filter(b => b.type === "image").length === 4 && /Sheet 1: frames at 0s, 0.5s, 1s/.test(req.messages[0].content[0].text), "Claude gets the sheets with each frame's time");
const uploadedSheet = sb.storage.files[`marketing/${v.sheets[0].url.split("/public/marketing/")[1]}`];
check(uploadedSheet && uploadedSheet.contentType === "image/jpeg" && uploadedSheet.body.length > 10000, `sheets uploaded as JPEG (${uploadedSheet?.body.length} bytes)`);
const ms = v.moments;
check(ms.length === 3 && ms[0].label === "Kill at the net" && !ms.some(m => m.label === "Overlapping") && ms.every(m => m.end - m.start >= 1.5 && m.end - m.start <= 10 && m.end <= 20), `moments cleaned: ${ms.map(m => `${m.label} ${m.start}-${m.end}`).join(" | ")}`);
check(ms.every(m => m.thumb_url) && v.minors === true && v.line === "volleyball" && !v.tags.includes("nope"), "every moment has a thumbnail; kids flagged; line + tags kept");

console.log("\n== reel ==");
sb.db.mkt_music = [{ id: 5, title: "Hype track", url: join(dir, "music.mp3"), mood: ["hype"], rights_ok: true, active: true, used_count: 0 }, { id: 6, title: "No rights", url: "x", mood: ["hype"], rights_ok: false, active: true }];
r = await V.ffmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=8", "-c:a", "libmp3lame", join(dir, "music.mp3")]);
const item = await V.createReel(sb, { videoIds: [1], settings: {}, today: "2026-10-26" });
check(item.kind === "reel" && item.render_status === "needs_render" && item.video.clips.length === 3 && item.video.clips[0].moment_id === "m3" && item.video.music_id === 5, `reel draft: clips ${item.video.clips.map(c => c.moment_id + " " + c.start + "-" + c.end).join(", ")}, music #${item.video.music_id}`);
check(item.headline === "FRIDAY NIGHT LIGHTS" && item.hashtags.join() === "DrippingSprings,DSSC" && item.platforms.join() === "instagram,facebook" && item.graphic.format === "story", "Claude's order and words; reel goes to IG + FB");
const total = item.video.clips.reduce((s, c) => s + c.end - c.start, 0);
check(item.video.clips.every(c => c.end - c.start <= 5) && total <= 30, `each clip at most 5 s, ${total.toFixed(1)} s in all`);

// Cards drawn in HQ - stand-ins here.
const card = (name, color, extra = []) => V.ffmpeg(["-y", "-f", "lavfi", "-i", `color=c=${color}:s=1080x1920`, ...extra, "-frames:v", "1", join(dir, name)]);
await card("intro.png", "0x104946"); await card("outro.png", "0x061a18");
await V.ffmpeg(["-y", "-f", "lavfi", "-i", "color=c=0xB2D04980:s=1080x1920,format=rgba", "-frames:v", "1", join(dir, "overlay.png")]);
const t1 = Date.now();
const done = await V.renderReel(sb, item, { cards: { intro: join(dir, "intro.png"), outro: join(dir, "outro.png"), overlay: join(dir, "overlay.png") } });
console.log(`  (render took ${((Date.now() - t1) / 1000).toFixed(1)} s)`);
const mp4 = sb.storage.files[`marketing/${done.asset_video_url.split("/public/marketing/")[1]}`];
check(done.render_status === "rendered" && mp4 && mp4.contentType === "video/mp4", `rendered and uploaded (${(mp4?.body.length / 1e6).toFixed(1)} MB)`);
const outFile = join(dir, "check.mp4");
await (await import("node:fs/promises")).writeFile(outFile, mp4.body);
const info = await V.ffmpeg(["-i", outFile]);
const op = V.parseProbe(info.stderr);
const want = V.INTRO + total + V.OUTRO;
check(op.width === 1080 && op.height === 1920 && op.has_audio && Math.abs(op.duration - want) < 0.25, `1080x1920 with sound, ${op.duration?.toFixed(2)} s (expected ${want.toFixed(2)})`);
check(/Video: h264 \(High\)/.test(info.stderr) && /Audio: aac/.test(info.stderr) && /30 fps/.test(info.stderr) && /48000 Hz, stereo/.test(info.stderr), "H.264 High + AAC 48 kHz stereo, 30 fps (what Reels take)");
check(done.asset_url === join(dir, "intro.png") && done.video.cards.intro && done.video.duration, "the intro card is the cover; the cards are kept for re-renders");

// No cards, no music, a clip without sound: still renders.
const bare = await V.renderReel(sb, { ...item, id: item.id, video: { ...item.video, music_id: null, cards: null } }, { cards: {} });
const bareFile = join(dir, "bare.mp4");
await (await import("node:fs/promises")).writeFile(bareFile, sb.storage.files[`marketing/${bare.asset_video_url.split("/public/marketing/")[1]}`].body);
const bp = V.parseProbe((await V.ffmpeg(["-i", bareFile])).stderr);
check(Math.abs(bp.duration - total) < 0.25 && bp.has_audio, `bare reel (no cards, no music): ${bp.duration?.toFixed(2)} s`);
sb.db.mkt_videos[0].has_audio = false;
const quiet = await V.renderReel(sb, item, { cards: {} });
check(quiet.render_status === "rendered", "a video with no sound gets a silent track (Reels need audio)");

console.log("\n== publishing a reel ==");
// Instagram: the container is still processing on the first run, done on the next.
Object.assign(process.env, { META_PAGE_ACCESS_TOKEN: "tok", META_PAGE_ID: "111", META_IG_USER_ID: "222" });
const graph = [];
let polls = 0;
const prevFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith("https://graph.facebook.com/")) return prevFetch(url, init);
  const body = init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : Object.fromEntries(new URL(u).searchParams);
  graph.push({ path: new URL(u).pathname, body });
  const j = (o) => new Response(JSON.stringify(o));
  if (u.includes("/222/media_publish")) return j({ id: "ig_reel_1" });
  if (u.includes("/222/media")) return j({ id: "cont_9" });
  if (u.includes("/111/videos")) return j({ id: "fb_vid_1" });
  if (u.includes("/cont_9")) return j({ status_code: ++polls < 4 ? "IN_PROGRESS" : "FINISHED" });
  return j({});
};
const pub = await import("../api/_lib/marketing-publish.js");
Object.assign(sb.db.mkt_items[0], { status: "approved", approved_by: "drew", scheduled_at: new Date(Date.now() - 60e3).toISOString(), asset_url: "https://x/intro.png", asset_video_url: "https://x/reel.mp4", external_ids: {} });
const r1 = await pub.publishItem(sb, sb.db.mkt_items[0], { deadline: Date.now() + 12000 });
const after1 = sb.db.mkt_items[0];
const ig = graph.find(g => g.path.endsWith("/222/media"));
check(r1.status === "publishing" && after1.external_ids.instagram_container === "cont_9" && after1.external_ids.facebook === "fb_vid_1" && !after1.external_ids.instagram, `run 1: Facebook posted, Instagram still processing (${JSON.stringify(after1.external_ids)})`);
check(ig.body.media_type === "REELS" && ig.body.video_url === "https://x/reel.mp4" && ig.body.cover_url === "https://x/intro.png" && ig.body.share_to_feed === "true" && /DrippingSprings/.test(ig.body.caption), "IG container: REELS, the MP4, the intro card as cover, caption with hashtags");
check(graph.find(g => g.path.endsWith("/111/videos")).body.file_url === "https://x/reel.mp4", "FB posts the MP4 by URL");
const r2 = await pub.publishItem(sb, sb.db.mkt_items[0], { resume: true, deadline: Date.now() + 60000 });
check(r2.status === "published" && sb.db.mkt_items[0].external_ids.instagram === "ig_reel_1" && !sb.db.mkt_items[0].external_ids.instagram_container && graph.filter(g => g.path.endsWith("/111/videos")).length === 1 && graph.filter(g => g.path.endsWith("/222/media")).length === 1, "run 2: Instagram published from the same container; nothing posted twice");

console.log("\n== inputs by URL (the static ffmpeg can't look up host names) ==");
// Production reads the raw video, the cards and the music over https; the
// static ffmpeg segfaults resolving a host name, so URLs go through a relay.
const { createServer } = await import("node:http");
const { statSync, createReadStream } = await import("node:fs");
const files = { "/glasses.mp4": src, "/music.mp3": join(dir, "music.mp3"), "/intro.png": join(dir, "intro.png") };
const web = createServer((req, res) => {
  const f = files[req.url]; if (!f) { res.writeHead(404); return res.end(); }
  const size = statSync(f).size, m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
  const a = m && m[1] ? +m[1] : 0, b = m && m[2] ? +m[2] : size - 1;
  res.writeHead(m ? 206 : 200, { "content-length": b - a + 1, "accept-ranges": "bytes", ...(m ? { "content-range": `bytes ${a}-${b}/${size}` } : {}) });
  createReadStream(f, { start: a, end: b }).pipe(res);
});
await new Promise(r => web.listen(0, "127.0.0.1", r));
const base = `http://localhost:${web.address().port}`;
const pu = await V.probe(base + "/glasses.mp4");
check(Math.abs(pu.duration - 20) < 0.2 && pu.has_audio, `probe by URL with a host name: ${pu.duration}s`);
const urlArgs = V.reelArgs({ cards: { intro: base + "/intro.png" }, clips: [{ url: base + "/glasses.mp4", start: 12, end: 15, has_audio: true }], music: { url: base + "/music.mp3", volume: 0.3 }, out: join(dir, "url.mp4") });
const ur = await V.ffmpeg(urlArgs.args, { timeoutMs: 60000 });
const uo = V.parseProbe((await V.ffmpeg(["-i", join(dir, "url.mp4")])).stderr);
check(ur.code === 0 && Math.abs(uo.duration - urlArgs.duration) < 0.25, `a reel from URLs (clip, card, looped music): exit ${ur.code}, ${uo.duration?.toFixed(2)} s`);
web.close();

console.log("\n== the scout suggests a reel ==");
const scout = await import("../api/_lib/marketing-scout.js");
const sv = { ...v, id: 7, created_at: "2026-10-24T15:00:00Z", release_ok: true, status: "ready", active: true };
const sb2 = fakeSupabase({ mkt_videos: [sv], mkt_items: [{ id: 50, kind: "reel", status: "published", created_at: "2026-10-01T00:00:00Z" }], mkt_ideas: [], mkt_music: [], mkt_settings: [], mkt_log: [] });
const idea = await scout.reelIdea(sb2, "2026-10-26");
check(idea && idea.format === "reel" && idea.kind === "reel" && idea.line === "volleyball" && /1 new video since the last reel - 3 usable moments/.test(idea.pitch) && /Kill at the net/.test(idea.pitch), `reel idea: ${idea?.pitch}`);
sb2.db.mkt_items.push({ id: 51, kind: "reel", status: "draft", created_at: "2026-10-25T00:00:00Z" });
check(await scout.reelIdea(sb2, "2026-10-26") === null, "no idea when a reel was cut after the newest video");
check(await scout.reelIdea(fakeSupabase({ mkt_videos: [{ ...sv, release_ok: false }], mkt_items: [], mkt_ideas: [] }), "2026-10-26") === null, "a video marked don't-post doesn't count");
sb2.db.mkt_items.pop();
sb2.db.mkt_ideas.push({ id: 3, ...idea, batch: "2026-10-26", status: "new", created_by: "scout", sources: [] });
check(await scout.reelIdea(sb2, "2026-10-26") === null, "no second reel idea while one is open");
const acc = await scout.acceptIdea(sb2, 3, { by: "drew", now: new Date("2026-10-26T15:00:00Z") });
check(acc.item.kind === "reel" && acc.item.video.clips.length >= 1 && acc.item.scheduled_at.startsWith("2026-10-28") && acc.idea.status === "accepted" && acc.idea.item_id === acc.item.id, `accepting it cuts the reel draft on its best day (${acc.item.scheduled_at})`);

console.log(`\n${fails ? fails + " FAILED" : "all checks passed"}`);
process.exit(fails ? 1 : 0);
