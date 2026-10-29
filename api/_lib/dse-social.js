// DS Elite Social (Drew, Oct 28 2026) - posts for DS Elite's Facebook Page and
// Instagram, made from what families and coaches already send us, each one
// approved before it goes out. DSE_SOCIAL_SETUP.md has the whole picture.
//
// PHOTO POSTS
//   Families upload to /photos (player_photos, private bucket team-photos).
//   The cron groups new uploads by team, event and day; a batch with enough
//   photos that has gone quiet for 2 hours goes to Claude, who looks at every
//   photo, rules out anything that shouldn't be on a public page (swimwear,
//   hot tubs, bedrooms, blurry, screenshots...), picks the best, chooses a
//   collage / carousel / single photo, finds each pick's focus point and
//   writes the caption. The graphic is rendered on the server
//   (dse-social-render.js), the picks are copied to the public dse-social
//   bucket (Facebook has to fetch them), and the draft is DMed in Slack to the
//   approvers with Approve & post / Skip. Every photo in the batch is marked
//   with the post it was considered for, so nothing is looked at twice.
//
// COACH INTROS
//   HQ sends a coach a short survey (email and/or text) with their own page
//   (/coach-intro?t=...): a few questions, a photo or two, OK to share. When
//   they answer, Claude writes the "Meet the Coach" poster from their own
//   words (the quote must be theirs) and picks the photo; it's drafted and
//   DMed for approval like a photo post. Approved intros go out one a day at
//   settings.intro_time (Central), so ten answers don't land in one evening.
//
// Nothing here posts without an approval. Kids are never named in captions.

import { randomUUID } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { claudeClient } from "./ai-client.js";
import { renderCollage, renderFrame, renderPoster, photo as loadPhoto } from "./dse-social-render.js";
import { fbPhoto, fbMultiPhoto, igImage, igCarousel, dseMeta, permalinks } from "./dse-social-meta.js";
import { slackCfg, slackApi } from "./product-slack.js";
import { feedIndex, photoHashes, matchFeed, recordFeedMatches } from "./dse-social-feed.js";
import { sendOneSms, normalizePhone } from "./sms.js";
import { resendKeyFor } from "./resend-key.js";

export const AI_MODEL = "claude-opus-5-5";
export const IN_BUCKET = "team-photos", OUT_BUCKET = "dse-social";
export const HQ_URL = "https://dseliteevals.vercel.app/?view=social";
export const FORM_BASE = "https://dseliteevals.vercel.app/coach-intro";
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const QUIET_MS = 2 * 3600e3, LOOKBACK_DAYS = 21, MAX_BATCH = 20;
const fail = (status, msg) => Object.assign(new Error(msg), { status });

// "12 Rise 1" in the data is "12 Rise" to people (CLAUDE.md).
export const teamLabel = (t) => String(t || "").replace(/^(\d+ Rise) 1$/, "$1");
const ctDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const fmtDay = (ymd) => ymd ? new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "";
const GENERIC_EVENT = /^(team event|other|practice|tournament|misc)$/i;
const firstName = (n) => String(n || "").trim().replace(/^coach\s+/i, "").split(/\s+/)[0] || "Coach";

export const DEFAULT_QUESTIONS = [
  "How did you get into volleyball? Where did you play, and what position?",
  "What's the one thing you want every player on your team to walk away with this season?",
  "What does a great practice look like to you?",
  "Favorite volleyball memory, as a player or a coach?",
  "Pre-game ritual, walk-up song or go-to snack?",
  "When you're not in the gym, where can we find you?",
  "One piece of advice for a player who's just starting out?",
];

export async function getSettings(sb) {
  const { data } = await sb.from("dse_social_settings").select("*").eq("id", 1).maybeSingle();
  const s = data || {};
  return {
    auto_photos: s.auto_photos !== false, min_photos: Math.max(1, Number(s.min_photos) || 3),
    platforms: s.platforms?.length ? s.platforms : ["facebook", "instagram"],
    approvers: s.approvers?.length ? s.approvers : ["drew@dselitevolleyball.com"],
    hashtags: s.hashtags || [], intro_questions: Array.isArray(s.intro_questions) && s.intro_questions.length ? s.intro_questions : DEFAULT_QUESTIONS,
    intro_time: /^\d{1,2}:\d{2}$/.test(s.intro_time || "") ? s.intro_time : "18:30", last_scan_at: s.last_scan_at || null,
  };
}

// The caption as posted: the words, then the hashtags.
export function captionFor(post) {
  const tags = [...new Set((post.hashtags || []).map(h => "#" + String(h).replace(/^#+/, "").replace(/\s+/g, "")).filter(h => h.length > 1))].join(" ");
  return [String(post.caption || "").trim(), tags].filter(Boolean).join("\n\n").slice(0, 2200);
}

// ── the photo pool and its batches ──────────────────────────────────────────
// Photos that could go in a post: images, not yet considered, not hidden,
// not from a family that asked to stay off social.
export async function photoPool(sb, { days = LOOKBACK_DAYS, team = null, includeUsed = false } = {}) {
  let q = sb.from("player_photos").select("id, storage_path, player_id, team_name, context, tournament_id, event_label, taken_on, caption, content_type, created_at, social_hidden, social_post_id")
    .in("content_type", IMAGE_TYPES).gte("created_at", new Date(Date.now() - days * 86400e3).toISOString()).order("created_at", { ascending: false }).limit(1000);
  if (!includeUsed) q = q.is("social_post_id", null).eq("social_hidden", false);
  if (team) q = q.eq("team_name", team);
  const { data, error } = await q;
  if (error) throw fail(500, error.message);
  const { data: off } = await sb.from("players").select("id").eq("no_social", true);
  const blocked = new Set((off || []).map(p => p.id));
  return (data || []).map(p => ({ ...p, blocked: !!(p.player_id && blocked.has(p.player_id)) })).filter(p => includeUsed || !p.blocked);
}
export const batchKey = (p) => [p.team_name || "", p.tournament_id ? "t" + p.tournament_id : (GENERIC_EVENT.test(p.event_label || "") ? p.context || "" : p.event_label || ""), p.taken_on || ctDay(p.created_at)].join("|");
// Group into batches; `ready` once there are enough and nobody has added to it for a while.
export function groupBatches(rows, { min = 3, now = Date.now(), quietMs = QUIET_MS } = {}) {
  const m = new Map();
  for (const p of rows) { const k = batchKey(p); if (!m.has(k)) m.set(k, []); m.get(k).push(p); }
  return [...m.entries()].map(([key, list]) => {
    const newest = Math.max(...list.map(p => Date.parse(p.created_at)));
    const [team, , day] = key.split("|");
    const ev = list.find(p => p.event_label && !GENERIC_EVENT.test(p.event_label))?.event_label || null;
    return { key, team, day, event: ev, photos: list.slice(0, MAX_BATCH), count: list.length, ready: list.length >= min && now - newest >= quietMs };
  }).sort((a, b) => b.day.localeCompare(a.day));
}

// ── Claude looks at the photos ──────────────────────────────────────────────
const SYSTEM = `You run social media for DS Elite Volleyball, a girls' club volleyball program in Dripping Springs, Texas (players about 10-18). Families upload photos from tournaments, practices and team events; you turn them into posts for the club's public Facebook Page and Instagram. A director approves every post before it goes out.

Safety comes first - these are photos of minors on a public page. Mark a photo unusable if ANY of these is true:
- anyone is in swimwear, underwear, sleepwear, or the photo is at a pool, hot tub, lake, beach or in a bedroom or bathroom
- it's revealing, suggestive, or a pose a parent could reasonably not want public
- someone looks upset, injured, embarrassed, or mid-meltdown
- it shows personal information: a readable home address, a phone number, a name tag with a last name, a car plate up close
- it's a screenshot, a meme, mostly text, a duplicate of a better shot, badly blurred, very dark, or nobody can be seen
- there's alcohol, a rude gesture, or anything off-brand for a youth club
When unsure, mark it unusable. It is fine to reject every photo.

Best photos: game action, celebrations, huddles, the team together, players in DS Elite gear, smiles, tournament moments, coaches with the team.

Caption rules:
- Never name a player - not first names, not nicknames, not jersey-number shout-outs - even if a family's caption names her. Refer to the team ("12 Rise", "our 14 Diamond girls").
- Use the team name exactly as given. No last names of anyone.
- 1-3 short sentences, warm and proud, a little energy; at most 2 emoji. No links, no prices, no made-up results or scores - only say what the photos and the given details show.
- Hashtags: 2-4 specific ones (team, event); the club's standard tags are added separately.`;

const PICK_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["photos", "format", "picks", "title", "sub", "caption", "hashtags"],
  properties: {
    photos: { type: "array", items: { type: "object", additionalProperties: false, required: ["i", "usable", "reason", "score", "focus_x", "focus_y"], properties: {
      i: { type: "integer" }, usable: { type: "boolean" }, reason: { type: "string" }, score: { type: "integer" },
      focus_x: { type: "number" }, focus_y: { type: "number" } } } },
    format: { type: "string", enum: ["collage", "carousel", "single", "none"] },
    picks: { type: "array", items: { type: "integer" } },
    title: { type: "string" }, sub: { type: "string" }, caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
  },
};

// A copy no bigger than `max` px on its long side (a canvas draws like an image).
function shrink(img, max) {
  const s = Math.min(1, max / Math.max(img.width, img.height));
  if (s === 1) return img;
  const c = createCanvas(Math.round(img.width * s), Math.round(img.height * s));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c;
}
// A small JPEG for Claude to look at (and a photo object to draw from).
async function thumbB64(img, max = 768) {
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = createCanvas(Math.round(img.width * s), Math.round(img.height * s));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return (await c.encode("jpeg", 78)).toString("base64");
}

async function askClaude({ system, text, images, schema, feature, maxTokens = 8000 }) {
  if (!process.env.ANTHROPIC_API_KEY) return { error: "ANTHROPIC_API_KEY isn't set" };
  const client = claudeClient(feature, { timeout: 120000, maxRetries: 1 });
  const content = [];
  images.forEach((b64, i) => { content.push({ type: "text", text: `Photo ${i}:` }); content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }); });
  content.push({ type: "text", text });
  const msg = await client.beta.messages.create({
    model: AI_MODEL, max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    system, messages: [{ role: "user", content }],
  });
  if (msg.stop_reason === "refusal") return { error: "Claude declined" + (msg.stop_details?.category ? ` (${msg.stop_details.category})` : ""), model: msg.model };
  if (msg.stop_reason === "max_tokens") return { error: "Claude ran out of room", model: msg.model };
  try { return { json: JSON.parse((msg.content || []).filter(b => b.type === "text").map(b => b.text).join("")), model: msg.model }; }
  catch { return { error: "Couldn't read Claude's answer", model: msg.model }; }
}

// Turn Claude's answer into a safe plan: only usable photos, sensible counts.
export function planFrom(ai, n) {
  const usable = new Map((ai?.photos || []).filter(p => p.usable && p.i >= 0 && p.i < n).map(p => [p.i, p]));
  let picks = [...new Set((ai?.picks || []).filter(i => usable.has(i)))];
  if (!picks.length) picks = [...usable.values()].sort((a, b) => b.score - a.score).map(p => p.i);
  let format = ai?.format;
  if (!picks.length || format === "none") return { format: "none", picks: [], usable };
  if (format === "single") picks = picks.slice(0, 1);
  if (format === "collage" && picks.length > 6) format = "carousel";
  if (format === "carousel") picks = picks.slice(0, 10);
  if (picks.length === 1) format = "single";
  if (format === "collage" && picks.length < 2) format = "single";
  if (!["collage", "carousel", "single"].includes(format)) format = picks.length >= 3 && picks.length <= 6 ? "collage" : picks.length > 6 ? "carousel" : "single";
  return { format, picks, usable };
}

// ── making a photo post ─────────────────────────────────────────────────────
async function upload(sb, path, buf) {
  const { error } = await sb.storage.from(OUT_BUCKET).upload(path, buf, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error("Saving the image: " + error.message);
  return sb.storage.from(OUT_BUCKET).getPublicUrl(path).data.publicUrl;
}
async function download(sb, path) {
  const { data, error } = await sb.storage.from(IN_BUCKET).download(path);
  if (error) throw new Error(`Couldn't open ${path}: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

// Draws the post's graphic(s) from its picks and stores them. Used on draft
// and again when someone reorders, removes or changes the format in HQ.
export async function renderPost(sb, post, imgs = null) {
  const folder = post.ai?.folder || randomUUID();
  const picks = post.photos || [];
  let loaded = imgs;
  if (!loaded) { loaded = []; for (const p of picks) loaded.push(shrink(p.path ? await loadPhoto(await download(sb, p.path)) : await loadPhoto(p.url), 2000)); }
  const stamp = Date.now().toString(36);
  const out = { ai: { ...(post.ai || {}), folder } };
  if (post.format === "collage") {
    const buf = await renderCollage(loaded.map((img, i) => ({ img, focus: picks[i].focus })), { title: post.design?.title || teamLabel(post.team_name), sub: post.design?.sub || "" });
    out.asset_url = await upload(sb, `posts/${folder}/collage-${stamp}.jpg`, buf);
  }
  const urls = [];
  if (post.format !== "collage") for (let i = 0; i < loaded.length; i++) urls.push(await upload(sb, `posts/${folder}/${i + 1}-${stamp}.jpg`, await renderFrame(loaded[i], picks[i].focus)));
  out.photos = picks.map((p, i) => ({ ...p, url: urls[i] || p.url || null }));
  if (post.format !== "collage") out.asset_url = urls[0] || null;
  return out;
}

// rows: player_photos (one batch, or a hand-picked set). Returns the post, or
// { skipped } when nothing was usable.
export async function draftPhotoPost(sb, rows, { by = "auto", settings = null, notify = true, dry = false, plannedAt = null } = {}) {
  const s = settings || await getSettings(sb);
  const list = rows.slice(0, MAX_BATCH);
  if (!list.length) throw fail(400, "No photos");
  // An upload that never finished is an empty file (22 of the first 153 were),
  // and one was an iPhone HEIC the decoder can't open: they're set aside, not
  // sent to Claude, and marked so the cron doesn't keep opening them.
  // Four at a time, each shrunk to 2000px as soon as it's open: sixteen
  // full-size phone photos at once (~50 MB each decoded) ran the function out
  // of memory on Oct 29.
  const imgs = new Array(list.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < list.length) {
      const k = next++, buf = await download(sb, list[k].storage_path).catch(() => null);
      if (!buf?.length) continue;
      const im = await loadPhoto(buf).catch(() => null);
      if (im?.width) imgs[k] = shrink(im, 2000);
    }
  }));
  const broken = list.filter((_, i) => !imgs[i]).map(p => p.id);
  if (broken.length && !dry) await sb.from("player_photos").update({ social_post_id: 0 }).in("id", broken);
  let ok = list.map((p, i) => ({ p, img: imgs[i] })).filter(x => x.img);
  if (!ok.length) return { skipped: true, error: `None of those ${list.length} photos could be opened (empty uploads or iPhone HEIC files)`, broken };
  // Already on the Page or Instagram (the club posts by hand too): recorded
  // as used and left out (api/_lib/dse-social-feed.js).
  const feed = await feedIndex(sb).catch(e => { console.error("dse social feed", e.message); return []; });
  const already = [];
  if (feed.length) ok = ok.filter(x => { const m = matchFeed(photoHashes(x.img), feed, x.img.width / x.img.height); if (m) already.push({ photo: x.p, item: m }); return !m; });
  const recorded = already.length && !dry ? await recordFeedMatches(sb, already) : [];
  const alreadyOut = already.map(h => ({ photo_id: h.photo.id, where: h.item.where, at: h.item.at, link: h.item.link }));
  if (!ok.length) return { skipped: true, already: alreadyOut, recorded, error: `All ${already.length} of these are already on ${[...new Set(already.map(h => h.item.where === "facebook" ? "Facebook" : "Instagram"))].join(" / ")}` };
  const team = teamLabel(ok[0].p.team_name);
  const ev = ok.find(x => x.p.event_label && !GENERIC_EVENT.test(x.p.event_label))?.p.event_label || null;
  const day = ok[0].p.taken_on || ctDay(ok[0].p.created_at);
  const notes = ok.map((x, i) => x.p.caption ? `Photo ${i} - the family's note: "${String(x.p.caption).slice(0, 200)}"` : null).filter(Boolean);
  const text = `These ${ok.length} photos were uploaded by ${team} families${ev ? ` from "${ev}"` : ""} (${fmtDay(day)}${ok[0].p.context === "team_event" ? ", a team event" : ok[0].p.context === "practice" ? ", practice" : ""}).
${notes.length ? notes.join("\n") + "\n(Family notes are background only - never name a player.)\n" : ""}
For every photo, say whether it's usable under the safety rules, why, a score 1-10, and its focus point (focus_x, focus_y from 0 to 1: the centre of the people that matter, so a crop keeps faces).
Then choose the post: "collage" (3-6 photos that work together as one image), "carousel" (several strong photos, swiped one by one - up to 10), "single" (one photo clearly stands out), or "none" if nothing is good enough. List the picks best first.
title: the team as written ("${team}"). sub: a short line for under it, like the event and date ("${ev ? ev + " · " : ""}${fmtDay(day)}"). Then the caption and 2-4 hashtags.`;
  let ai = null, aiErr = null, model = null;
  const thumbs = await Promise.all(ok.map(x => thumbB64(x.img)));
  const r = await askClaude({ system: SYSTEM, text, images: thumbs, schema: PICK_SCHEMA, feature: "dse-social-photos" }).catch(e => ({ error: e.message }));
  ai = r.json || null; aiErr = r.error || null; model = r.model || null;
  // No Claude: nothing is judged safe, so nothing is posted automatically.
  if (!ai) {
    if (by === "auto") return { skipped: true, error: aiErr };
    ai = { photos: ok.map((_, i) => ({ i, usable: true, reason: "picked by hand", score: 5, focus_x: 0.5, focus_y: 0.4 })), format: ok.length >= 3 && ok.length <= 6 ? "collage" : "carousel", picks: ok.map((_, i) => i), title: team, sub: ev || fmtDay(day), caption: `${team} 💗`, hashtags: [] };
  }
  const plan = planFrom(ai, ok.length);
  // A look without saving anything: what Claude thought of each photo.
  if (dry) return { dry: true, already: alreadyOut, model, error: aiErr, format: plan.format, picks: plan.picks.map(i => ok[i].p.id), title: ai.title, sub: ai.sub, caption: ai.caption, hashtags: ai.hashtags, verdicts: (ai.photos || []).map(p => ({ photo_id: ok[p.i]?.p.id, usable: p.usable, reason: p.reason, score: p.score })) };
  const considered = ok.map(x => x.p.id);
  if (plan.format === "none") {
    await sb.from("player_photos").update({ social_post_id: 0 }).in("id", considered).is("social_post_id", null);
    return { skipped: true, reasons: (ai.photos || []).map(p => ({ id: ok[p.i]?.p.id, usable: p.usable, reason: p.reason })) };
  }
  const picks = plan.picks.map(i => { const a = plan.usable.get(i) || {}; return { photo_id: ok[i].p.id, path: ok[i].p.storage_path, focus: { x: a.focus_x ?? 0.5, y: a.focus_y ?? 0.4 }, note: a.reason || "" }; });
  const draft = {
    kind: "photos", format: plan.format, status: "draft", team_name: ok[0].p.team_name, event_label: ev, title: `${team}${ev ? " · " + ev : ""} · ${fmtDay(day)}`,
    photo_ids: considered, photos: picks, caption: String(ai.caption || "").trim(), hashtags: [...(ai.hashtags || []).slice(0, 4), ...s.hashtags],
    design: { title: String(ai.title || team).trim() || team, sub: String(ai.sub || "").trim() }, platforms: s.platforms, created_by: by,
    scheduled_at: (plannedAt ? new Date(plannedAt) : await nextSlot(sb, s)).toISOString(),
    ai: { model, error: aiErr, verdicts: (ai.photos || []).map(p => ({ photo_id: ok[p.i]?.p.id, usable: p.usable, reason: p.reason, score: p.score })) },
  };
  // Two drafts racing for the same photos (the cron and "Make the draft"
  // within a second, Oct 29): whoever is second stops here.
  const { data: taken } = await sb.from("player_photos").select("id").in("id", considered).not("social_post_id", "is", null);
  if (taken?.length) return { skipped: true, error: `${taken.length} of these photos were just put in another draft` };
  Object.assign(draft, await renderPost(sb, draft, plan.picks.map(i => ok[i].img)));
  const { data: post, error } = await sb.from("dse_social_posts").insert(draft).select().single();
  if (error) throw fail(500, error.message);
  await sb.from("player_photos").update({ social_post_id: post.id }).in("id", considered).is("social_post_id", null);
  if (notify) await notifyApprovers(sb, post, s).catch(e => console.error("dse social slack", e.message));
  return { post, already: alreadyOut };
}

// ── Slack: the quick approval ───────────────────────────────────────────────
const KIND_LABEL = { collage: "Collage", carousel: "Photo carousel", single: "Photo post", poster: "Coach intro poster" };
export const ctWhen = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export function approvalMessage(post, { done = null } = {}) {
  const imgs = post.format === "carousel" ? (post.photos || []).map(p => p.url).filter(Boolean).slice(0, 4) : [post.asset_url].filter(Boolean);
  const where = (post.platforms || []).map(p => p === "facebook" ? "Facebook" : "Instagram").join(" + ");
  const blocks = [
    { type: "section", text: { type: "mrkdwn", text: `*${KIND_LABEL[post.format] || "Post"} ready for DS Elite* · ${post.title || ""}\n${post.format === "carousel" ? `${(post.photos || []).length} photos · ` : ""}${where}${post.scheduled_at && !done ? ` · planned for *${ctWhen(post.scheduled_at)}*` : ""}` } },
    ...imgs.map((url, i) => ({ type: "image", image_url: url, alt_text: `Photo ${i + 1}` })),
    { type: "section", text: { type: "mrkdwn", text: captionFor(post).split("\n").map(l => "> " + l.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c])).join("\n") } },
  ];
  if (done) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: done }] });
  else blocks.push({ type: "actions", elements: [
    { type: "button", style: "primary", text: { type: "plain_text", text: post.scheduled_at && Date.parse(post.scheduled_at) > Date.now() ? "✓ Approve for " + ctWhen(post.scheduled_at).replace(/^\w+, /, "") : "✓ Approve & post" }, action_id: "dse_social_approve", value: String(post.id) },
    { type: "button", text: { type: "plain_text", text: "Post now" }, action_id: "dse_social_now", value: String(post.id) },
    { type: "button", text: { type: "plain_text", text: "Skip" }, action_id: "dse_social_skip", value: String(post.id) },
    { type: "button", text: { type: "plain_text", text: "Edit in HQ" }, url: `${HQ_URL}&post=${post.id}`, action_id: "dse_social_open" },
  ] });
  return { text: `${KIND_LABEL[post.format] || "Post"} ready for DS Elite: ${post.title || ""}`, blocks };
}
export async function notifyApprovers(sb, post, s = null) {
  const cfg = await slackCfg(sb);
  if (!cfg.bot_token) return { ok: false, error: "no Slack bot" };
  const { approvers } = s || await getSettings(sb);
  const { data: st } = await sb.from("dssc_project_settings").select("slack_ids").eq("id", 1).maybeSingle();
  const sent = [];
  for (const email of approvers) {
    const e = String(email).trim().toLowerCase();
    let user = (st?.slack_ids || {})[e] || null;
    if (!user) { const u = await slackApi(cfg.bot_token, "users.lookupByEmail", { email: e }); user = u.ok ? u.user.id : null; }
    if (!user) continue;
    const im = await slackApi(cfg.bot_token, "conversations.open", { users: user });
    if (!im.ok) continue;
    const r = await slackApi(cfg.bot_token, "chat.postMessage", { channel: im.channel.id, ...approvalMessage(post), unfurl_links: false, unfurl_media: false });
    if (r.ok) sent.push({ channel: r.channel, ts: r.ts });
  }
  if (sent.length) await sb.from("dse_social_posts").update({ slack: { messages: sent } }).eq("id", post.id);
  return { ok: !!sent.length, sent: sent.length };
}
// Keep the Slack DMs in step when a post is decided in HQ (or by the other approver).
export async function refreshSlack(sb, post, done) {
  const msgs = post.slack?.messages || [];
  if (!msgs.length) return;
  const cfg = await slackCfg(sb);
  if (!cfg.bot_token) return;
  for (const m of msgs) await slackApi(cfg.bot_token, "chat.update", { channel: m.channel, ts: m.ts, ...approvalMessage(post, { done }) }).catch(() => {});
}

// ── deciding and publishing ─────────────────────────────────────────────────
// "HH:MM" Central on a given day, as an instant.
export function ctInstant(ymd, hhmm) {
  const [y, mo, d] = ymd.split("-").map(Number), [h, mi] = hhmm.split(":").map(Number);
  let t = Date.UTC(y, mo - 1, d, h, mi) + 6 * 3600e3;
  for (let k = 0; k < 2; k++) {
    const wall = new Date(new Date(t).toLocaleString("en-US", { timeZone: "America/Chicago" }));
    t += (Date.UTC(y, mo - 1, d, h, mi) - Date.UTC(wall.getFullYear(), wall.getMonth(), wall.getDate(), wall.getHours(), wall.getMinutes()));
  }
  return new Date(t);
}
// The next evening with nothing planned on it: one DS Elite post a day, at
// settings.intro_time (Central). Drafts hold their planned evening too, so a
// week of drafts lands on a week of evenings. Posts the club made by hand
// count, so HQ doesn't post on top of them the same day.
export async function nextSlot(sb, s, now = new Date(), { exceptId = null } = {}) {
  const { data } = await sb.from("dse_social_posts").select("id, status, scheduled_at, published_at").in("status", ["draft", "approved", "publishing", "published"]).gte("created_at", new Date(now.getTime() - 120 * 86400e3).toISOString());
  const taken = new Set((data || []).filter(p => p.id !== exceptId).map(p => p.status === "published" ? (p.published_at || p.scheduled_at) : p.scheduled_at).filter(Boolean).map(ctDay));
  for (let i = 0; i < 60; i++) {
    const day = ctDay(new Date(now.getTime() + i * 86400e3).toISOString());
    const at = ctInstant(day, s.intro_time);
    if (at.getTime() > now.getTime() + 10 * 60e3 && !taken.has(day)) return at;
  }
  return new Date(now.getTime() + 3600e3);
}
export const nextIntroSlot = nextSlot;

export async function getPost(sb, id) {
  const { data } = await sb.from("dse_social_posts").select("*").eq("id", Number(id)).maybeSingle();
  if (!data) throw fail(404, "That post no longer exists");
  return data;
}
// Approve: photo posts go out now; coach intros take the next free evening
// unless `now` is asked for.
export async function approvePost(sb, id, by, { now = false } = {}) {
  const post = await getPost(sb, id);
  if (["published", "publishing"].includes(post.status)) return { post, already: true };
  const s = await getSettings(sb);
  // Keep the planned evening if it's still ahead; "post now" overrides it. A
  // photo post whose evening has passed goes out now; an intro takes the next free one.
  const planned = post.scheduled_at && Date.parse(post.scheduled_at) > Date.now() + 5 * 60e3 ? new Date(post.scheduled_at) : null;
  const at = now ? new Date() : planned || (post.kind === "coach_intro" ? await nextSlot(sb, s, new Date(), { exceptId: post.id }) : new Date());
  const { data, error } = await sb.from("dse_social_posts").update({ status: "approved", approved_by: by, approved_at: new Date().toISOString(), scheduled_at: at.toISOString(), error: null, updated_at: new Date().toISOString() }).eq("id", post.id).select().single();
  if (error) throw fail(500, error.message);
  const when = at.getTime() - Date.now() > 5 * 60e3 ? `goes out ${ctWhen(at.toISOString())}` : "posting now";
  await refreshSlack(sb, data, `✓ Approved by ${by} - ${when}`);
  return { post: data, due: at.getTime() <= Date.now() + 60e3 };
}
export async function skipPost(sb, id, by) {
  const post = await getPost(sb, id);
  if (post.status === "published") throw fail(400, "It's already posted - remove it on Facebook / Instagram");
  const { data } = await sb.from("dse_social_posts").update({ status: "skipped", approved_by: by, updated_at: new Date().toISOString() }).eq("id", post.id).select().single();
  await refreshSlack(sb, data, `Skipped by ${by}`);
  if (data.intro_id) await sb.from("dse_coach_intros").update({ status: "answered", post_id: null }).eq("id", data.intro_id).eq("post_id", data.id);
  return { post: data };
}

// Post it. Each platform that succeeds is saved at once, so a retry only
// does the ones that didn't go out - nothing is posted twice.
export async function publishPost(sb, id) {
  const { data: locked } = await sb.from("dse_social_posts").update({ status: "publishing", updated_at: new Date().toISOString() }).eq("id", Number(id)).in("status", ["approved", "failed"]).select().maybeSingle();
  if (!locked) return { skipped: "not approved, or already posting" };
  const post = locked;
  const ext = { ...(post.external_ids || {}) };
  const caption = captionFor(post);
  const urls = post.format === "carousel" ? (post.photos || []).map(p => p.url).filter(Boolean) : [post.asset_url].filter(Boolean);
  const errors = [], notes = [];
  const meta = await dseMeta(sb);
  try {
    if (!urls.length) throw new Error("There's no image to post");
    if (!meta) throw new Error("Facebook isn't connected - HQ -> Social -> Settings");
    for (const platform of post.platforms || []) {
      if (ext[platform]) continue;
      if (platform === "instagram" && !meta.igId) { notes.push("No Instagram is linked to the Page, so it went to Facebook only"); continue; }
      try {
        ext[platform] = platform === "facebook"
          ? (urls.length > 1 ? await fbMultiPhoto(sb, urls, caption) : await fbPhoto(sb, urls[0], caption))
          : (urls.length > 1 ? await igCarousel(sb, urls, caption) : await igImage(sb, urls[0], caption));
        await sb.from("dse_social_posts").update({ external_ids: ext }).eq("id", post.id);
      } catch (e) { errors.push(`${platform === "facebook" ? "Facebook" : "Instagram"}: ${e.message}`); }
    }
  } catch (e) { errors.push(e.message); }
  const done = !errors.length;
  const links = done ? await permalinks(sb, ext).catch(() => ({})) : {};
  const { data: after } = await sb.from("dse_social_posts").update({
    status: done ? "published" : "failed", external_ids: { ...ext, ...(Object.keys(links).length ? { links } : {}) },
    published_at: done ? new Date().toISOString() : null, error: errors.join(" · ") || (notes.join(" · ") || null), updated_at: new Date().toISOString(),
  }).eq("id", post.id).select().single();
  if (done && post.intro_id) await sb.from("dse_coach_intros").update({ status: "posted" }).eq("id", post.intro_id);
  const linkText = [links.facebook && `<${links.facebook}|Facebook>`, links.instagram && `<${links.instagram}|Instagram>`].filter(Boolean).join(" · ");
  await refreshSlack(sb, after, done ? `🚀 Posted${linkText ? " - " + linkText : ""}${post.approved_by ? ` (approved by ${post.approved_by})` : ""}` : `⚠️ Couldn't post: ${errors.join(" · ")} - try again from HQ`);
  return { post: after, errors };
}

// ── coach intros ────────────────────────────────────────────────────────────
// Every DS Elite coach with their teams this season (teams.head_coach /
// assistant_coach are names, matched to coach_roster by first + last).
export async function coachList(sb) {
  const [{ data: roster }, { data: teams }, { data: intros }] = await Promise.all([
    sb.from("coach_roster").select("id, first_name, last_name, email, phone").order("first_name"),
    sb.from("teams").select("id, head_coach, assistant_coach, active, sort_order").eq("active", true).order("sort_order"),
    sb.from("dse_coach_intros").select("id, coach_roster_id, status, sent_at, answered_at, post_id, created_at").order("created_at", { ascending: false }),
  ]);
  const nrm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const latest = new Map();
  for (const i of intros || []) if (i.coach_roster_id && !latest.has(i.coach_roster_id)) latest.set(i.coach_roster_id, i);
  return (roster || []).map(c => {
    const name = `${c.first_name || ""} ${c.last_name || ""}`.trim();
    const mine = (teams || []).filter(t => [t.head_coach, t.assistant_coach].some(n => nrm(n) === nrm(name))).map(t => teamLabel(t.id));
    return { id: c.id, name, email: c.email || null, phone: c.phone || null, teams: mine, intro: latest.get(c.id) || null };
  }).filter(c => c.name);
}

async function sendEmail({ to, subject, html, text }) {
  const from = process.env.DSE_FROM_EMAIL;
  const key = resendKeyFor(from);
  if (!from || !key) throw new Error("Email isn't set up (DSE_FROM_EMAIL / RESEND_API_KEY)");
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [to], subject, html, text, reply_to: "drew@dselitevolleyball.com" }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Email: " + (j.message || r.status));
  return j.id;
}
export const introLink = (intro) => `${FORM_BASE}?t=${intro.token}`;
// Email and/or text the coach their survey link. via: ["email", "text"].
export async function sendIntro(sb, intro, { via = ["email", "text"], reminder = false, by = null } = {}) {
  const first = firstName(intro.name), link = introLink(intro);
  const used = [], errors = [];
  if (via.includes("email") && intro.email) {
    const subject = reminder ? `Reminder: your DS Elite coach intro (5 minutes)` : `Coach ${first}, you're in our "Meet the Coach" series`;
    const intro1 = reminder ? `Just a nudge - we'd love to feature you in DS Elite's "Meet the Coach" series.` : `We're introducing DS Elite's coaches to families on Instagram and Facebook, and we'd love to feature you.`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#111;max-width:560px">
<p>Hi Coach ${first},</p><p>${intro1} It's a few quick questions (answer as many as you like) and a photo or two - about 5 minutes.</p>
<p><a href="${link}" style="display:inline-block;background:#e91e8c;color:#fff;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:6px">Answer the questions</a></p>
<p>We'll turn your answers into a "Meet the Coach" post, and nothing goes out until you've said it's OK and we've checked it.</p><p>Thank you!<br>Drew<br>DS Elite Volleyball</p></div>`;
    try { await sendEmail({ to: intro.email, subject, html, text: `Hi Coach ${first},\n\n${intro1} A few quick questions and a photo or two (about 5 minutes):\n${link}\n\nNothing goes out until you've said it's OK and we've checked it.\n\nThanks!\nDrew\nDS Elite Volleyball` }); used.push("email"); }
    catch (e) { errors.push(e.message); }
  }
  if (via.includes("text") && intro.phone) {
    const to = normalizePhone(intro.phone);
    const body = reminder
      ? `Hi Coach {first}! Quick reminder from DS Elite: we'd love to feature you in our Meet the Coach posts. 5 minutes: ${link}`
      : `Hi Coach {first}! DS Elite is introducing our coaches on Instagram & Facebook and we'd love to feature you. A few quick questions + a photo (5 min): ${link}`;
    try { if (!to) throw new Error("no valid phone"); await sendOneSms(sb, { to, brand: "dse", name: intro.name, kind: "coach" }, body, { sent_by_label: "DS Elite Social" }); used.push("text"); }
    catch (e) { errors.push("Text: " + e.message); }
  }
  if (!used.length) throw fail(400, errors.join(" · ") || "No email or phone for this coach");
  const now = new Date().toISOString();
  const patch = reminder ? { reminded_at: now } : { status: intro.status === "draft" ? "sent" : intro.status, sent_at: now, sent_via: used, created_by: intro.created_by || by };
  await sb.from("dse_coach_intros").update({ ...patch, error: errors.join(" · ") || null }).eq("id", intro.id);
  return { via: used, errors };
}
// Start intros for these coaches (one open intro per coach at a time).
export async function startIntros(sb, coachIds, { via, by } = {}) {
  const s = await getSettings(sb);
  const coaches = (await coachList(sb)).filter(c => coachIds.map(Number).includes(c.id));
  const out = [];
  for (const c of coaches) {
    if (c.intro && ["draft", "sent", "answered", "drafted"].includes(c.intro.status)) { out.push({ coach: c.name, skipped: "already has an intro going" }); continue; }
    const { data: intro, error } = await sb.from("dse_coach_intros").insert({ coach_roster_id: c.id, name: c.name, email: c.email, phone: c.phone, teams: c.teams, questions: s.intro_questions.map(q => ({ q, a: "" })), created_by: by }).select().single();
    if (error) { out.push({ coach: c.name, error: error.message }); continue; }
    try { out.push({ coach: c.name, ...(await sendIntro(sb, intro, { via, by })) }); }
    catch (e) { out.push({ coach: c.name, error: e.message }); }
  }
  return out;
}

const POSTER_SCHEMA = {
  type: "object", additionalProperties: false, required: ["photo", "focus_x", "focus_y", "quote", "facts", "caption", "hashtags"],
  properties: {
    photo: { type: "integer" }, focus_x: { type: "number" }, focus_y: { type: "number" },
    quote: { type: "string" },
    facts: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "string" } } } },
    caption: { type: "string" }, hashtags: { type: "array", items: { type: "string" } },
  },
};
const POSTER_SYSTEM = `You write DS Elite Volleyball's "Meet the Coach" posts (girls' club volleyball, Dripping Springs, Texas) from a coach's own survey answers. A director approves before anything is posted.
- The quote must be the coach's own words, copied from one answer (you may cut it short, but don't change or add words). Pick the line that best shows who they are as a coach. Under 200 characters.
- facts: up to 3 short label/value pairs from their answers (e.g. "Played" / "Texas State, outside hitter", "Walk-up song" / "Eye of the Tiger"). Labels 1-3 words; values under 40 characters; only things they said.
- caption: 2-4 short sentences introducing Coach <first name> and their teams, in a warm, upbeat voice, using their answers - nothing invented. End inviting families to say hi at practice. At most 2 emoji. No links.
- hashtags: 2-3 (e.g. MeetTheCoach).
- photo: the index of the best photo of the coach for the poster (a clear, flattering photo where the coach is the subject), or -1 if none work. Never pick a photo with kids in swimwear or anything a parent wouldn't want public. focus_x/focus_y (0-1): the coach's face.`;
const nrmText = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// The quote has to be theirs: otherwise use their longest answer's first sentence.
export function checkQuote(quote, answers) {
  const all = nrmText(answers.join(" \n "));
  const q = String(quote || "").trim().replace(/^["“]|["”]$/g, "");
  if (q && all.includes(nrmText(q.replace(/(\.\.\.|…)$/, "")))) return q;
  const best = [...answers].sort((a, b) => b.length - a.length)[0] || "";
  const first = (best.match(/^[^.!?]+[.!?]?/) || [best])[0].trim();
  return first.length > 200 ? first.slice(0, 197).replace(/\s+\S*$/, "") + "…" : first;
}

export async function draftIntroPost(sb, intro, { by = "auto", notify = true } = {}) {
  const s = await getSettings(sb);
  const qa = (intro.questions || []).filter(x => String(x.a || "").trim());
  if (!qa.length) throw fail(400, "No answers yet");
  if (!intro.consent) throw fail(400, "The coach hasn't said it's OK to share");
  const photos = (intro.photos || []).slice(0, 6);
  const imgs = await Promise.all(photos.map(p => loadPhoto(p.url).catch(() => null)));
  const usable = photos.map((p, i) => ({ p, img: imgs[i] })).filter(x => x.img);
  const first = firstName(intro.name);
  const text = `Coach ${intro.name}${intro.teams?.length ? ` coaches ${intro.teams.join(" and ")}` : ""} this season. Their answers:\n\n${qa.map(x => `Q: ${x.q}\nA: ${x.a}`).join("\n\n")}\n\n${usable.length ? `They sent ${usable.length} photo(s), shown above (Photo 0...).` : "They sent no photos (use photo -1)."}`;
  const r = await askClaude({ system: POSTER_SYSTEM, text, images: await Promise.all(usable.map(x => thumbB64(x.img))), schema: POSTER_SCHEMA, feature: "dse-social-intro" }).catch(e => ({ error: e.message }));
  const ai = r.json || { photo: usable.length ? 0 : -1, focus_x: 0.5, focus_y: 0.3, quote: "", facts: [], caption: `Meet Coach ${first}${intro.teams?.length ? `, coaching ${intro.teams.join(" and ")} this season` : ""}! Say hi at practice 👋`, hashtags: ["MeetTheCoach"] };
  const answers = qa.map(x => String(x.a));
  const quote = checkQuote(ai.quote, answers);
  const pi = Number.isInteger(ai.photo) && ai.photo >= 0 && ai.photo < usable.length ? ai.photo : (usable.length ? 0 : -1);
  const design = { name: intro.name, headline: `Coach ${first}`, teams: intro.teams || [], quote, facts: (ai.facts || []).filter(f => f?.label && f?.value).slice(0, 3).map(f => ({ label: String(f.label).slice(0, 24), value: String(f.value).slice(0, 60) })), photo: pi >= 0 ? usable[pi].p.url : null, focus: { x: ai.focus_x ?? 0.5, y: ai.focus_y ?? 0.3 } };
  const buf = await renderPoster({ img: pi >= 0 ? usable[pi].img : null, ...design });
  const folder = randomUUID();
  const asset_url = await upload(sb, `intros/${intro.id}/poster-${folder.slice(0, 8)}.jpg`, buf);
  const { data: post, error } = await sb.from("dse_social_posts").insert({
    kind: "coach_intro", format: "poster", status: "draft", title: `Meet Coach ${first}`, intro_id: intro.id, caption: String(ai.caption || "").trim(),
    hashtags: [...(ai.hashtags || []).slice(0, 3), ...s.hashtags], design, asset_url, platforms: s.platforms, created_by: by,
    scheduled_at: (await nextSlot(sb, s)).toISOString(),
    photos: pi >= 0 ? [{ url: usable[pi].p.url, focus: design.focus }] : [], ai: { model: r.model || null, error: r.error || null, folder },
  }).select().single();
  if (error) throw fail(500, error.message);
  await sb.from("dse_coach_intros").update({ status: "drafted", post_id: post.id }).eq("id", intro.id);
  if (notify) await notifyApprovers(sb, post, s).catch(e => console.error("dse social slack", e.message));
  return { post };
}
// Redraw a poster after its words or photo were edited in HQ.
export async function rerenderPoster(sb, post) {
  const d = post.design || {};
  const img = d.photo ? await loadPhoto(d.photo).catch(() => null) : null;
  const buf = await renderPoster({ img, ...d });
  return upload(sb, `intros/${post.intro_id || "x"}/poster-${Date.now().toString(36)}.jpg`, buf);
}

// ── the cron ────────────────────────────────────────────────────────────────
export async function runCron(sb, { now = new Date(), dry = false, deadline = Date.now() + 240e3 } = {}) {
  const s = await getSettings(sb);
  const out = { published: [], failed: [], reminded: [], intro_drafts: [], photo_drafts: [], batches: [] };
  // 1. approved posts whose time has come (and any stuck mid-post for 10 minutes)
  const { data: due } = await sb.from("dse_social_posts").select("id, status, scheduled_at, updated_at")
    .or(`and(status.eq.approved,scheduled_at.lte."${now.toISOString()}"),and(status.eq.approved,scheduled_at.is.null),and(status.eq.publishing,updated_at.lt."${new Date(now - 10 * 60e3).toISOString()}")`);
  for (const p of due || []) {
    if (dry || Date.now() > deadline) { out.published.push({ id: p.id, dry: true }); continue; }
    if (p.status === "publishing") await sb.from("dse_social_posts").update({ status: "approved" }).eq("id", p.id).eq("status", "publishing");
    const r = await publishPost(sb, p.id).catch(e => ({ errors: [e.message] }));
    (r.errors?.length ? out.failed : out.published).push({ id: p.id, errors: r.errors });
  }
  // 2. one reminder, 3 days after the survey went out
  const { data: quiet } = await sb.from("dse_coach_intros").select("*").eq("status", "sent").is("reminded_at", null).lt("sent_at", new Date(now - 3 * 86400e3).toISOString());
  for (const i of quiet || []) {
    if (dry) { out.reminded.push({ id: i.id, dry: true }); continue; }
    const r = await sendIntro(sb, i, { via: i.sent_via?.length ? i.sent_via : ["email", "text"], reminder: true }).catch(e => ({ error: e.message }));
    out.reminded.push({ id: i.id, ...r });
  }
  // 3. answers in -> the poster draft (two a run)
  const { data: answered } = await sb.from("dse_coach_intros").select("*").eq("status", "answered").is("post_id", null).order("answered_at").limit(2);
  for (const i of answered || []) {
    if (dry || Date.now() > deadline - 60e3) { out.intro_drafts.push({ id: i.id, dry: true }); continue; }
    const r = await draftIntroPost(sb, i).catch(e => ({ error: e.message }));
    out.intro_drafts.push({ id: i.id, post: r.post?.id, error: r.error });
    if (r.error) await sb.from("dse_coach_intros").update({ error: r.error }).eq("id", i.id);
  }
  // 4. new family photos -> photo post drafts (every 30 minutes, two a run)
  if (s.auto_photos && (!s.last_scan_at || now - Date.parse(s.last_scan_at) > 25 * 60e3)) {
    const batches = groupBatches(await photoPool(sb), { min: s.min_photos, now: now.getTime() }).filter(b => b.ready);
    out.batches = batches.map(b => ({ key: b.key, count: b.count }));
    if (!dry) {
      for (const b of batches.slice(0, 2)) {
        if (Date.now() > deadline - 90e3) break;
        const r = await draftPhotoPost(sb, b.photos, { settings: s }).catch(e => ({ error: e.message }));
        out.photo_drafts.push({ key: b.key, post: r.post?.id, skipped: r.skipped || false, error: r.error });
      }
      await sb.from("dse_social_settings").update({ last_scan_at: now.toISOString() }).eq("id", 1);
    }
  }
  return out;
}
