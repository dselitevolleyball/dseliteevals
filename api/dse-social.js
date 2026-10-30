// HQ -> Social (DS Elite): the screen's API. POST { action, ... } with the
// signed-in admin's Supabase token (or the service role key, for scripts).
// The engine is api/_lib/dse-social.js; the Facebook connection is
// api/_lib/dse-social-meta.js. See DSE_SOCIAL_SETUP.md.
//
//   status                      settings, connection, counts
//   meta_check                  ask Facebook what the connection can do
//   connect_url                 the "Connect Facebook" login link
//   connect_token {token}       paste a token -> saved, or the Pages to pick from
//   pick_page {page_id}         save that Page after connect_token
//   disconnect
//   posts {status?}             drafts / queue / history
//   update_post {id, caption?, hashtags?, platforms?, format?, photos?, design?}
//   approve {id, now?} · skip {id} · publish_now {id} · unapprove {id}
//   photos {days?, team?}       the family photo pool, with thumbnails
//   hide_photo {id, hidden}     keep one photo off social
//   no_social {player_id, on}   keep a family's photos off social
//   make_post {photo_ids}       a draft from hand-picked photos
//   preview_post {photo_ids}    what Claude makes of them, nothing saved
//   scan                        look for new batches now
//   coaches                     every coach, their teams and intro status
//   intro_send {coach_ids, via} start + send surveys
//   intro_remind {id} · intro_cancel {id} · intro_draft {id} · intro_answers {id, answers}
//   ideas                       fun ideas: the data ones (birthdays, game weeks,
//                               posted schedules, holidays) + Claude's memes/trends
//   ideas_sync · ideas_brainstorm {count?, trends?} · idea_draft {id}
//   idea_custom {prompt, post_on?}  Drew's own idea, written by Claude from the club's facts -> draft post
//   idea_dismiss {id} · idea_restore {id} · idea_update {id, title?, caption?, card?, post_on?}
//   stock                       Drew's stock photos + the team list
//   stock_upload_urls {count} · stock_add {items} (Claude analyzes them after) · stock_delete {id}
//   stock_update {id, team_name?, note?, hidden?, website?} · stock_analyze {ids?, force?}  Claude's read (api/_lib/dse-stock-ai.js)
//   settings_save {...}

import { createClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";
import * as S from "./_lib/dse-social.js";
import * as M from "./_lib/dse-social-meta.js";
import * as I from "./_lib/dse-social-ideas.js";
import * as A from "./_lib/dse-stock-ai.js";

export const config = { maxDuration: 300 };
const OWNERS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const later = (p) => { try { waitUntil(p); } catch { /* local */ } return p; };
const fail = (status, msg) => Object.assign(new Error(msg), { status });

export async function verifyAdmin(sb, req) {
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return { error: "Sign in first", status: 401 };
  if (bearer === process.env.SUPABASE_SERVICE_ROLE_KEY) return { me: "drew@dselitevolleyball.com", name: "Drew" };
  const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
  const me = String(user?.email || "").trim().toLowerCase();
  if (!me) return { error: "Sign in first", status: 401 };
  if (OWNERS.includes(me)) return { me, name: "Drew" };
  const { data: c } = await sb.from("coaches").select("display_name, is_admin, is_approved").ilike("email", me).maybeSingle();
  if (!(c?.is_approved && c?.is_admin)) return { error: "Social is for DS Elite admins", status: 403 };
  return { me, name: c.display_name || me };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const who = await verifyAdmin(sb, req);
  if (who.error) return res.status(who.status).json({ error: who.error });
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  try { return res.status(200).json({ ok: true, ...(await run(sb, who, b || {})) }); }
  catch (e) { console.error("dse-social", b?.action, e); return res.status(e.status || 500).json({ error: e.message || String(e) }); }
}

const firstOf = (name) => String(name || "").split(/[\s@]/)[0];
export async function run(sb, { me, name }, b) {
  const by = firstOf(name) || me;
  switch (b.action) {
    case "status": {
      const [settings, meta, { data: counts }] = await Promise.all([
        S.getSettings(sb), M.metaStatus(sb),
        sb.from("dse_social_posts").select("status"),
      ]);
      const c = {}; for (const r of counts || []) c[r.status] = (c[r.status] || 0) + 1;
      return { settings, meta, counts: c, redirect_uri: M.redirectUri() };
    }
    case "meta_check": return { meta: await M.metaStatus(sb, { deep: true }) };
    case "connect_url": {
      if (!M.appReady()) throw fail(400, "Add META_APP_ID and META_APP_SECRET in Vercel first (DSE_SOCIAL_SETUP.md), or paste a token instead");
      return { url: M.loginUrl(me) };
    }
    case "connect_token": return await M.connectWithToken(sb, b.token, me);
    case "pick_page": return { saved: await M.pickPage(sb, b.page_id, me) };
    case "disconnect": await M.disconnect(sb); return {};

    case "posts": {
      let q = sb.from("dse_social_posts").select("*").order("created_at", { ascending: false }).limit(Math.min(200, Number(b.limit) || 80));
      if (b.status) q = q.in("status", [].concat(b.status));
      const { data, error } = await q;
      if (error) throw fail(500, error.message);
      return { posts: data || [] };
    }
    case "update_post": {
      const post = await S.getPost(sb, b.id);
      if (["published", "publishing"].includes(post.status)) throw fail(400, "It's already posted");
      const patch = { updated_at: new Date().toISOString() };
      if (typeof b.caption === "string") patch.caption = b.caption.slice(0, 2000);
      if (Array.isArray(b.hashtags)) patch.hashtags = b.hashtags.map(h => String(h).replace(/^#+/, "").trim()).filter(Boolean).slice(0, 15);
      if (Array.isArray(b.platforms)) patch.platforms = b.platforms.filter(p => ["facebook", "instagram"].includes(p));
      if (Array.isArray(b.platforms) && !patch.platforms.length) throw fail(400, "Pick Facebook, Instagram or both");
      if (b.scheduled_at !== undefined) { const t = b.scheduled_at ? Date.parse(b.scheduled_at) : null; if (t !== null && !Number.isFinite(t)) throw fail(400, "That time isn't a date"); patch.scheduled_at = t === null ? null : new Date(t).toISOString(); }
      let redraw = false;
      if (b.format && b.format !== post.format && post.kind === "photos") { if (!["collage", "carousel", "single"].includes(b.format)) throw fail(400, "Unknown format"); patch.format = b.format; redraw = true; }
      if (Array.isArray(b.photos) && post.kind === "photos") {
        // reorder / remove: only photos already in the post, with their focus
        const byId = new Map((post.photos || []).map(p => [p.photo_id, p]));
        patch.photos = b.photos.map(x => { const p = byId.get(Number(x.photo_id ?? x)); return p ? { ...p, ...(x.focus ? { focus: x.focus } : {}) } : null; }).filter(Boolean);
        if (!patch.photos.length) throw fail(400, "A post needs at least one photo");
        redraw = true;
      }
      if (b.design && typeof b.design === "object") { patch.design = { ...(post.design || {}), ...b.design }; redraw = true; }
      if (b.another_photo && post.kind === "idea") { patch.design = { ...(patch.design || post.design || {}), photo_url: null, photo_index: (Number((patch.design || post.design || {}).photo_index) || 0) + 1 }; redraw = true; }
      if (b.design?.photo_url && b.design.photo_url !== post.design?.photo_url) await I.markStockUsed(sb, b.design.photo_url);
      const next = { ...post, ...patch };
      if (next.kind === "photos" && next.format === "collage" && (next.photos || []).length > 6) throw fail(400, "A collage holds up to 6 photos - remove some, or make it a carousel");
      if (next.kind === "photos" && next.format === "single") next.photos = next.photos.slice(0, 1), patch.photos = next.photos;
      if (redraw) Object.assign(patch, next.kind === "coach_intro" ? { asset_url: await S.rerenderPoster(sb, next) } : next.kind === "idea" ? await I.rerenderIdea(sb, { ...next, design: patch.design || next.design }) : await S.renderPost(sb, next));
      // A change to an approved post needs approving again.
      // (A new planned time alone keeps the approval.)
      const onlyTime = Object.keys(patch).every(k => ["scheduled_at", "updated_at"].includes(k));
      if (post.status === "approved" && !onlyTime) Object.assign(patch, { status: "draft", approved_by: null, approved_at: null });
      const { data, error } = await sb.from("dse_social_posts").update(patch).eq("id", post.id).select().single();
      if (error) throw fail(500, error.message);
      return { post: data };
    }
    case "approve": {
      const r = await S.approvePost(sb, b.id, by, { now: !!b.now });
      if (r.due) return { ...(await S.publishPost(sb, b.id)), approved: true };
      return r;
    }
    case "publish_now": {
      const post = await S.getPost(sb, b.id);
      if (post.status === "draft") await S.approvePost(sb, b.id, by, { now: true });
      else await sb.from("dse_social_posts").update({ status: "approved", scheduled_at: new Date().toISOString() }).eq("id", post.id).in("status", ["approved", "failed"]);
      return await S.publishPost(sb, b.id);
    }
    case "unapprove": {
      const { data } = await sb.from("dse_social_posts").update({ status: "draft", approved_by: null, approved_at: null }).eq("id", Number(b.id)).in("status", ["approved", "failed", "skipped"]).select().maybeSingle();
      if (!data) throw fail(400, "Only an approved, failed or skipped post can go back to draft");
      return { post: data };
    }
    case "skip": return await S.skipPost(sb, b.id, by);

    case "photos": {
      const pool = await S.photoPool(sb, { days: Math.min(120, Number(b.days) || 30), team: b.team || null, includeUsed: true });
      const paths = pool.map(p => p.storage_path);
      const signed = new Map();
      for (let i = 0; i < paths.length; i += 100) {
        const chunk = paths.slice(i, i + 100);
        const { data } = await sb.storage.from(S.IN_BUCKET).createSignedUrls(chunk, 3600);
        (data || []).forEach(d => d.signedUrl && signed.set(d.path, d.signedUrl));
      }
      const { data: off } = await sb.from("players").select("id, first_name, last_name, team_assignment").eq("no_social", true);
      return { photos: pool.map(p => ({ ...p, url: signed.get(p.storage_path) || null })), no_social: off || [], batches: S.groupBatches(pool.filter(p => !p.social_post_id && !p.social_hidden && !p.blocked)).map(({ photos, ...x }) => ({ ...x, ids: photos.map(p => p.id) })) };
    }
    case "hide_photo": {
      await sb.from("player_photos").update({ social_hidden: !!b.hidden }).eq("id", Number(b.id));
      return {};
    }
    case "no_social": {
      const { error } = await sb.from("players").update({ no_social: !!b.on }).eq("id", b.player_id);
      if (error) throw fail(500, error.message);
      return {};
    }
    case "player_search": {
      const q = String(b.q || "").trim();
      if (q.length < 2) return { players: [] };
      const { data } = await sb.from("players").select("id, first_name, last_name, team_assignment, no_social").or(`first_name.ilike.%${q.replace(/[%,()]/g, "")}%,last_name.ilike.%${q.replace(/[%,()]/g, "")}%`).limit(12);
      return { players: data || [] };
    }
    case "make_post": {
      const ids = (b.photo_ids || []).map(Number).filter(Boolean).slice(0, 20);
      const { data: rows } = await sb.from("player_photos").select("*").in("id", ids);
      const ordered = ids.map(id => (rows || []).find(r => r.id === id)).filter(Boolean);
      const r = await S.draftPhotoPost(sb, ordered, { by, plannedAt: b.planned_at || null });
      if (r.skipped && !r.reasons) throw fail(400, r.error);
      if (r.skipped) throw fail(400, "Claude didn't find a photo it would post: " + ((r.reasons || []).filter(x => !x.usable).map(x => x.reason).slice(0, 3).join("; ") || r.error || "none usable"));
      return r;
    }
    case "preview_post": {   // what Claude would make of these photos - nothing saved or sent
      const ids = (b.photo_ids || []).map(Number).filter(Boolean).slice(0, 20);
      const { data: rows } = await sb.from("player_photos").select("*").in("id", ids);
      return await S.draftPhotoPost(sb, ids.map(id => (rows || []).find(r => r.id === id)).filter(Boolean), { by, dry: true });
    }
    case "scan": {
      const s = await S.getSettings(sb);
      const batches = S.groupBatches(await S.photoPool(sb), { min: s.min_photos }).filter(x => b.all ? x.count >= s.min_photos : x.ready);
      const made = [];
      for (const x of batches.slice(0, 2)) made.push({ key: x.key, ...(await S.draftPhotoPost(sb, x.photos, { by, settings: s }).then(r => ({ post: r.post?.id, skipped: !!r.skipped })).catch(e => ({ error: e.message }))) });
      return { made, waiting: Math.max(0, batches.length - 2) };
    }

    case "coaches": return { coaches: await S.coachList(sb) };
    case "intros": {
      const { data } = await sb.from("dse_coach_intros").select("*").order("created_at", { ascending: false }).limit(200);
      return { intros: (data || []).map(i => ({ ...i, link: S.introLink(i) })) };
    }
    case "intro_send": {
      const via = [].concat(b.via || ["email", "text"]).filter(v => ["email", "text"].includes(v));
      if (!via.length) throw fail(400, "Send by email, text or both");
      return { results: await S.startIntros(sb, [].concat(b.coach_ids || []), { via, by }) };
    }
    case "intro_remind": {
      const { data: i } = await sb.from("dse_coach_intros").select("*").eq("id", Number(b.id)).maybeSingle();
      if (!i || i.status !== "sent") throw fail(400, "Only a survey that's out and unanswered can be resent");
      return await S.sendIntro(sb, i, { via: [].concat(b.via || i.sent_via || ["email", "text"]), reminder: true, by });
    }
    case "intro_cancel": {
      await sb.from("dse_coach_intros").update({ status: "cancelled" }).eq("id", Number(b.id)).in("status", ["draft", "sent", "answered"]);
      return {};
    }
    case "intro_answers": {
      const { data: i } = await sb.from("dse_coach_intros").select("*").eq("id", Number(b.id)).maybeSingle();
      if (!i) throw fail(404, "No such intro");
      const answers = [].concat(b.answers || []).map(a => String(a ?? "").trim().slice(0, 1500));
      const questions = (i.questions || []).map((x, k) => ({ q: x.q, a: answers[k] ?? x.a ?? "" }));
      await sb.from("dse_coach_intros").update({ questions, consent: true, status: ["drafted", "posted"].includes(i.status) ? i.status : "answered", answered_at: i.answered_at || new Date().toISOString() }).eq("id", i.id);
      return {};
    }
    case "intro_draft": {
      const { data: i } = await sb.from("dse_coach_intros").select("*").eq("id", Number(b.id)).maybeSingle();
      if (!i) throw fail(404, "No such intro");
      if (i.post_id) { const { data: old } = await sb.from("dse_social_posts").select("status").eq("id", i.post_id).maybeSingle(); if (old && ["approved", "publishing", "published"].includes(old.status)) throw fail(400, "Its post is already approved"); if (old) await sb.from("dse_social_posts").update({ status: "skipped" }).eq("id", i.post_id); }
      return await S.draftIntroPost(sb, i, { by });
    }

    case "ideas": {
      const { data, error } = await sb.from("dse_social_ideas").select("*").gte("post_on", I.ctToday(new Date(Date.now() - 2 * 86400e3))).order("post_on").order("id").limit(200);
      if (error) throw fail(500, error.message);
      return { ideas: data || [] };
    }
    case "ideas_sync": return await I.syncIdeas(sb);
    case "ideas_brainstorm": return await I.brainstorm(sb, { count: Math.max(1, Math.min(10, Number(b.count) || 6)), by, trends: b.trends !== false });
    case "idea_draft": return await I.draftIdea(sb, b.id, { by });
    case "idea_custom": return await I.customIdea(sb, { prompt: String(b.prompt || "").slice(0, 2000), post_on: b.post_on || null, by });
    case "idea_dismiss": case "idea_restore": {
      const { data, error } = await sb.from("dse_social_ideas").update({ status: b.action === "idea_dismiss" ? "dismissed" : "new", updated_at: new Date().toISOString() }).eq("id", Number(b.id)).neq("status", "drafted").select().maybeSingle();
      if (error) throw fail(500, error.message);
      return { idea: data };
    }
    // Stock photos: the browser shrinks each picture, asks for signed upload
    // slots, uploads straight to storage (no 4.5 MB function limit), then adds them.
    case "stock": {
      const [{ data, error }, { data: teams }] = await Promise.all([
        sb.from("dse_social_stock").select("*").order("created_at", { ascending: false }).limit(2000),
        sb.from("practice_teams").select("team_name"),
      ]);
      if (error) throw fail(500, error.message);
      return { photos: data || [], teams: (teams || []).map(t => t.team_name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) };
    }
    case "stock_upload_urls": {
      const n = Math.max(1, Math.min(20, Number(b.count) || 1));
      const month = new Date().toISOString().slice(0, 7);
      const slots = [];
      for (let i = 0; i < n; i++) {
        const key = `stock/${month}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        const [full, thumb] = await Promise.all([`${key}.jpg`, `${key}-thumb.jpg`].map(p => sb.storage.from(S.OUT_BUCKET).createSignedUploadUrl(p)));
        if (full.error || thumb.error) throw fail(500, (full.error || thumb.error).message);
        slots.push({ path: full.data.path, token: full.data.token, thumb_path: thumb.data.path, thumb_token: thumb.data.token });
      }
      return { bucket: S.OUT_BUCKET, slots };
    }
    case "stock_add": {
      const pub = (p) => sb.storage.from(S.OUT_BUCKET).getPublicUrl(p).data.publicUrl;
      const rows = (b.items || []).slice(0, 20).filter(x => /^stock\/[\w./-]+\.jpg$/.test(String(x.path || ""))).map(x => ({
        storage_path: x.path, url: pub(x.path),
        thumb_path: /^stock\/[\w./-]+\.jpg$/.test(String(x.thumb_path || "")) ? x.thumb_path : null,
        thumb_url: /^stock\/[\w./-]+\.jpg$/.test(String(x.thumb_path || "")) ? pub(x.thumb_path) : null,
        width: Number(x.width) || null, height: Number(x.height) || null,
        team_name: x.team_name || null, note: String(x.note || "").trim().slice(0, 300) || null,
        original_name: String(x.original_name || "").slice(0, 200) || null, uploaded_by: by,
      }));
      if (!rows.length) throw fail(400, "Nothing to add");
      const { data, error } = await sb.from("dse_social_stock").upsert(rows, { onConflict: "storage_path" }).select();
      if (error) throw fail(500, error.message);
      later(A.analyzeStock(sb, { ids: data.map(r => r.id) }).catch(e => console.error("stock ai", e.message)));   // Claude reads them in the background
      return { photos: data };
    }
    case "stock_analyze": return await A.analyzeStock(sb, { ids: Array.isArray(b.ids) ? b.ids : null, force: !!b.force, limit: Math.min(24, Number(b.limit) || 12) });
    case "stock_update": {
      const patch = {};
      if (b.team_name !== undefined) patch.team_name = b.team_name || null;
      if (typeof b.note === "string") patch.note = b.note.trim().slice(0, 300) || null;
      if (typeof b.hidden === "boolean") patch.hidden = b.hidden;
      if (typeof b.website === "boolean") Object.assign(patch, { website: b.website, website_at: b.website ? new Date().toISOString() : null });
      const { data, error } = await sb.from("dse_social_stock").update(patch).eq("id", Number(b.id)).select().maybeSingle();
      if (error) throw fail(500, error.message);
      return { photo: data };
    }
    case "stock_delete": {
      const { data: s } = await sb.from("dse_social_stock").select("storage_path, thumb_path").eq("id", Number(b.id)).maybeSingle();
      if (!s) return {};
      await sb.storage.from(S.OUT_BUCKET).remove([s.storage_path, s.thumb_path].filter(Boolean));
      await sb.from("dse_social_stock").delete().eq("id", Number(b.id));
      return {};
    }
    case "idea_update": {
      const patch = { updated_at: new Date().toISOString() };
      if (typeof b.title === "string") patch.title = b.title.slice(0, 120);
      if (typeof b.caption === "string") patch.caption = b.caption.slice(0, 1500);
      if (typeof b.post_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.post_on)) patch.post_on = b.post_on;
      if (b.card && typeof b.card === "object") { const { data: cur } = await sb.from("dse_social_ideas").select("card").eq("id", Number(b.id)).maybeSingle(); patch.card = { ...(cur?.card || {}), ...b.card }; }
      const { data, error } = await sb.from("dse_social_ideas").update(patch).eq("id", Number(b.id)).select().maybeSingle();
      if (error) throw fail(500, error.message);
      return { idea: data };
    }
    case "settings_save": {
      const p = b.settings || {};
      const patch = { updated_at: new Date().toISOString() };
      if (typeof p.auto_photos === "boolean") patch.auto_photos = p.auto_photos;
      if (p.min_photos != null) patch.min_photos = Math.max(1, Math.min(10, Number(p.min_photos) || 3));
      if (Array.isArray(p.platforms)) patch.platforms = p.platforms.filter(x => ["facebook", "instagram"].includes(x));
      if (Array.isArray(p.approvers)) patch.approvers = p.approvers.map(e => String(e).trim().toLowerCase()).filter(e => /@/.test(e));
      if (Array.isArray(p.hashtags)) patch.hashtags = p.hashtags.map(h => String(h).replace(/^#+/, "").trim()).filter(Boolean).slice(0, 10);
      if (Array.isArray(p.intro_questions)) patch.intro_questions = p.intro_questions.map(q => String(q).trim()).filter(Boolean).slice(0, 10);
      if (typeof p.intro_time === "string" && /^\d{1,2}:\d{2}$/.test(p.intro_time)) patch.intro_time = p.intro_time;
      if (typeof p.auto_ideas === "boolean") patch.auto_ideas = p.auto_ideas;
      const { error } = await sb.from("dse_social_settings").update(patch).eq("id", 1);
      if (error) throw fail(500, error.message);
      return { settings: await S.getSettings(sb) };
    }
    default: throw fail(400, "Unknown action");
  }
}
void later;
