// The Marketing Machine's outbox: puts an APPROVED mkt_items row out into the
// world. Called by api/marketing-cron.js (due items) and api/marketing.js
// (publish_now, test). Never called for drafts.
//
//   social -> Meta Graph API: Facebook Page photo post (POST /{page}/photos
//             {url, caption}) and Instagram (POST /{ig}/media {image_url,
//             caption} -> /{ig}/media_publish {creation_id}); stories go to
//             Instagram (media_type STORIES) and the Page's stories
//             (photo_stories) from the 1080x1920 render. A platform that
//             already has an id in external_ids is skipped, so a retry after a
//             half-failure never double-posts.
//   email  -> Resend batch (/emails/batch, 100 per request) to dssc_contacts
//             with an email address, minus mkt_unsubscribes; every message
//             has its own unsubscribe link + List-Unsubscribe header. Progress
//             is saved after every batch (external_ids.email.cursor) so a run
//             cut short resumes where it stopped.
//   sms    -> an sms_campaigns row (brand dssc, status scheduled) that the
//             existing api/sms-campaigns.js cron sends - consent, STOP and
//             do-not-text are handled there.
//
// Env: META_PAGE_ACCESS_TOKEN, META_PAGE_ID, META_IG_USER_ID, META_GRAPH_VERSION
//      (default v26.0); RESEND_API_KEY, DSSC_FROM_EMAIL, MARKETING_UNSUB_SECRET
//      (falls back to CRON_SECRET), MARKETING_PUBLIC_BASE (default
//      https://www.drippingsportsclub.com/hq); TWILIO_* / DSSC_TWILIO_* (sms).

import { createHmac } from "node:crypto";
import { sendResend, dsscFrom, resendKey, nrm, isEmailish, safeEqual, inboxAddress, DSSC_DIRECTORS } from "./site-inbox.js";
import { twilioReady, notReadyMessage, sendOneSms } from "./sms.js";
import { EMPTY_FILTERS } from "../../shared/campaign-audience.js";
import { lineSite } from "../../shared/marketing-plan.js";
import { loadSegmentData, buildFamilies, resolveSegment } from "../../shared/crm-segments.js";
import { buildEmail, withHero, UNSUB_TOKEN } from "./marketing-ai.js";
import { resendKeyFor } from "./resend-key.js";

const env = () => process.env;
export const graphVersion = () => env().META_GRAPH_VERSION || "v26.0";
export const publicBase = () => String(env().MARKETING_PUBLIC_BASE || "https://www.drippingsportsclub.com/hq").replace(/\/+$/, "");

// ── what's connected ─────────────────────────────────────────────────────────
export function connections() {
  const e = env();
  const miss = (pairs) => pairs.filter(([ok]) => !ok).map(([, name]) => name);
  const missing = {
    ai: miss([[e.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY"]]),
    facebook: miss([[e.META_PAGE_ACCESS_TOKEN, "META_PAGE_ACCESS_TOKEN"], [e.META_PAGE_ID, "META_PAGE_ID"]]),
    instagram: miss([[e.META_PAGE_ACCESS_TOKEN, "META_PAGE_ACCESS_TOKEN"], [e.META_IG_USER_ID, "META_IG_USER_ID"]]),
    email: miss([[resendKey(), "RESEND_API_KEY"], [dsscFrom(), "DSSC_FROM_EMAIL"], [unsubSecret(), "MARKETING_UNSUB_SECRET"]]),
    sms: twilioReady("dssc") ? [] : miss([[e.TWILIO_ACCOUNT_SID, "TWILIO_ACCOUNT_SID"], [e.TWILIO_AUTH_TOKEN, "TWILIO_AUTH_TOKEN"], [e.DSSC_TWILIO_FROM_NUMBER || e.DSSC_TWILIO_MESSAGING_SERVICE_SID, "DSSC_TWILIO_FROM_NUMBER"]]),
  };
  const connections = Object.fromEntries(Object.entries(missing).map(([k, v]) => [k, !v.length]));
  return { connections, missing };
}

// ── unsubscribe links ────────────────────────────────────────────────────────
export const unsubSecret = () => env().MARKETING_UNSUB_SECRET || env().CRON_SECRET || "";
export const unsubToken = (email) => createHmac("sha256", unsubSecret()).update(nrm(email)).digest("base64url").slice(0, 32);
export const unsubUrl = (email) => `${publicBase()}/api/marketing-unsubscribe?e=${encodeURIComponent(nrm(email))}&t=${unsubToken(email)}`;
export const verifyUnsub = (email, t) => !!unsubSecret() && isEmailish(email) && safeEqual(unsubToken(email), String(t || ""));

// ── social ───────────────────────────────────────────────────────────────────
// The caption as posted: the approved text, the link line, the hashtags.
// Facebook makes a link in a caption tappable. Instagram doesn't (and its
// captions can't be copied), so there the call to action points to the link
// in the bio - the club's links page, api/links.js - and gives the address to type.
export function captionFor(item, platform = "facebook") {
  const body = String(item.body || "").trim();
  const link = !item.cta_url ? ""
    : /^instagram/.test(platform) ? `${item.cta_text || "Details"}: link in bio, or go to ${lineSite(item.line)}`
    : !body.includes(item.cta_url) ? `${item.cta_text || "Details"}: ${item.cta_url}` : "";
  const tags = (item.hashtags || []).map(h => "#" + String(h).replace(/^#/, "")).filter(h => h.length > 1).join(" ");
  // A reel's CC BY music needs its credit in the caption (set by publishItem).
  const credit = item.music_credit ? String(item.music_credit).slice(0, 200) : "";
  return [body, link, credit, tags].filter(Boolean).join("\n\n").slice(0, 2200);
}

async function graph(path, params, { method = "POST" } = {}) {
  const token = env().META_PAGE_ACCESS_TOKEN;
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: token });
  const r = method === "GET"
    ? await fetch(url + "?" + body.toString())
    : await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Meta ${path.split("/").pop()}: ${j.error?.message || "HTTP " + r.status}`);
  return j;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// What the Meta token in the env actually is and may do - when posting fails
// with a permissions error, this says which permission or which id is wrong.
// Never returns the token itself.
export const META_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish"];
export async function metaCheck() {
  const { META_PAGE_ACCESS_TOKEN: t, META_PAGE_ID: pageId, META_IG_USER_ID: igId } = env();
  if (!t) return { ok: false, problems: ["META_PAGE_ACCESS_TOKEN isn't set"] };
  const get = async (path, params = {}) => {
    const u = new URL(`https://graph.facebook.com/${graphVersion()}/${path}`);
    for (const [k, v] of Object.entries({ ...params, access_token: t })) u.searchParams.set(k, v);
    return fetch(u, { signal: AbortSignal.timeout(15000) }).then(r => r.json()).catch(e => ({ error: { message: e.message } }));
  };
  const [dbg, me, page] = await Promise.all([get("debug_token", { input_token: t }), get("me", { fields: "id,name" }), pageId ? get(pageId, { fields: "id,name,instagram_business_account" }) : null]);
  const d = dbg.data || {};
  const when = (s) => s ? new Date(s * 1000).toISOString().slice(0, 10) : "never";
  const scopes = d.scopes || [];
  const out = {
    valid: d.is_valid ?? null, type: d.type || null, app: d.application || null, expires: when(d.expires_at), data_access_expires: when(d.data_access_expires_at),
    scopes, missing: d.scopes ? META_SCOPES.filter(s => !scopes.includes(s)) : null,
    token_is_for: me.error ? null : { id: me.id, name: me.name }, page_id_set: pageId || null,
    page: page ? (page.error ? { error: page.error.message } : { id: page.id, name: page.name, instagram: page.instagram_business_account?.id || null }) : null, ig_id_set: igId || null,
    error: dbg.error?.message || d.error?.message || me.error?.message || null,
  };
  const problems = [];
  if (out.valid === false) problems.push(`The token is no longer valid${d.error?.message ? ": " + d.error.message : ""}`);
  if (out.type && out.type !== "PAGE") problems.push(`It's a ${out.type} token - HQ needs the Page token (from /me/accounts)`);
  if (out.token_is_for && pageId && out.token_is_for.id !== pageId) problems.push(`The token is for ${out.token_is_for.name} (${out.token_is_for.id}), not page ${pageId}`);
  if (out.missing?.length) problems.push("Missing permissions: " + out.missing.join(", "));
  if (out.page?.instagram && igId && out.page.instagram !== igId) problems.push(`META_IG_USER_ID is ${igId} but the page's Instagram is ${out.page.instagram}`);
  if (out.error && !problems.length) problems.push(out.error);
  return { ok: !problems.length, problems, ...out };
}

export async function postFacebook(item) {
  const { META_PAGE_ACCESS_TOKEN, META_PAGE_ID } = env();
  if (!META_PAGE_ACCESS_TOKEN || !META_PAGE_ID) throw new Error("Facebook isn't connected (META_PAGE_ACCESS_TOKEN, META_PAGE_ID)");
  const j = await graph(`${META_PAGE_ID}/photos`, { url: item.asset_url, caption: captionFor(item), published: "true" });
  return j.post_id || j.id;
}

export async function postInstagram(item, { story = false } = {}) {
  const { META_PAGE_ACCESS_TOKEN, META_IG_USER_ID } = env();
  if (!META_PAGE_ACCESS_TOKEN || !META_IG_USER_ID) throw new Error("Instagram isn't connected (META_PAGE_ACCESS_TOKEN, META_IG_USER_ID)");
  const params = story ? { image_url: item.asset_story_url, media_type: "STORIES" } : { image_url: item.asset_url, caption: captionFor(item, "instagram") };
  const c = await graph(`${META_IG_USER_ID}/media`, params);
  // The container is usually ready at once for a photo; give it up to ~20s.
  for (let i = 0; i < 10; i++) {
    const s = await graph(c.id, { fields: "status_code" }, { method: "GET" }).catch(() => ({}));
    if (!s.status_code || s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram couldn't process the image (${s.status_code})`);
    await sleep(2000);
  }
  const p = await graph(`${META_IG_USER_ID}/media_publish`, { creation_id: c.id });
  return p.id;
}

// A reel. Instagram: a REELS container from the rendered MP4 (cover = the
// intro card), then media_publish once Instagram has processed the video -
// which can take a few minutes, so a container still IN_PROGRESS after ~45 s
// is handed back as { pending } and the next cron run finishes it.
export async function postInstagramReel(item, { containerId = null, waitMs = 45000 } = {}) {
  const { META_PAGE_ACCESS_TOKEN, META_IG_USER_ID } = env();
  if (!META_PAGE_ACCESS_TOKEN || !META_IG_USER_ID) throw new Error("Instagram isn't connected (META_PAGE_ACCESS_TOKEN, META_IG_USER_ID)");
  if (!item.asset_video_url) throw new Error("The reel hasn't been rendered");
  let id = containerId;
  if (!id) {
    const params = { media_type: "REELS", video_url: item.asset_video_url, caption: captionFor(item, "instagram"), share_to_feed: "true" };
    if (item.asset_url) params.cover_url = item.asset_url;
    id = (await graph(`${META_IG_USER_ID}/media`, params)).id;
  }
  const until = Date.now() + waitMs;
  for (;;) {
    const s = await graph(id, { fields: "status_code" }, { method: "GET" }).catch(() => ({}));
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram couldn't process the video (${s.status_code})`);
    if (Date.now() > until) return { pending: id };
    await sleep(3000);
  }
  return { id: (await graph(`${META_IG_USER_ID}/media_publish`, { creation_id: id })).id };
}
// Facebook: the Page posts the MP4 by URL (vertical video shows as a reel).
export async function postFacebookVideo(item) {
  const { META_PAGE_ACCESS_TOKEN, META_PAGE_ID } = env();
  if (!META_PAGE_ACCESS_TOKEN || !META_PAGE_ID) throw new Error("Facebook isn't connected (META_PAGE_ACCESS_TOKEN, META_PAGE_ID)");
  if (!item.asset_video_url) throw new Error("The reel hasn't been rendered");
  const j = await graph(`${META_PAGE_ID}/videos`, { file_url: item.asset_video_url, description: captionFor(item), published: "true" });
  return j.id;
}

// A Facebook Page story: the story PNG goes up as an unpublished photo, then
// becomes the story (POST /{page}/photo_stories {photo_id}).
export async function postFacebookStory(item) {
  const { META_PAGE_ACCESS_TOKEN, META_PAGE_ID } = env();
  if (!META_PAGE_ACCESS_TOKEN || !META_PAGE_ID) throw new Error("Facebook isn't connected (META_PAGE_ACCESS_TOKEN, META_PAGE_ID)");
  const ph = await graph(`${META_PAGE_ID}/photos`, { url: item.asset_story_url, published: "false" });
  const st = await graph(`${META_PAGE_ID}/photo_stories`, { photo_id: ph.id });
  return st.post_id || st.id || ph.id;
}

// ── email ────────────────────────────────────────────────────────────────────
// Who the marketing email goes to:
//   { source: 'dssc_contacts' } (default) - every DSSC contact with an email
//   { source: 'directors' }               - the directors only (a soft launch)
//   { emails: [...] }                     - exactly these
//   { segment_id } / { segment: {...} }   - a saved People segment, or filters
//                                            inline (shared/crm-segments.js)
//   + cold_cap: N                          - at most N "cold" addresses (from an
//                                            old list, never bought, never
//                                            emailed) per send, to warm a list up
// Unsubscribed and bounced / complained addresses are never included.
export async function emailAudience(sb, audience, { coldUsed = 0 } = {}) {
  const a = audience && typeof audience === "object" ? audience : { source: "dssc_contacts" };
  let list = [];
  const badStatus = new Set();
  if (Array.isArray(a.emails) && a.emails.length) list = a.emails.map(e => ({ email: nrm(e), first_name: "" }));
  else if (a.source === "directors") list = DSSC_DIRECTORS.map(d => ({ email: d.email, first_name: d.name.split(" ")[0] }));
  else if (a.segment_id || (a.segment && typeof a.segment === "object")) {
    let seg = a.segment;
    if (a.segment_id) {
      const { data, error } = await sb.from("dssc_segments").select("id, name, filters").eq("id", a.segment_id).maybeSingle();
      if (error) throw new Error("dssc_segments: " + error.message);
      if (!data) throw new Error(`Segment ${a.segment_id} no longer exists - pick another audience`);
      seg = data.filters || {};
    }
    const index = buildFamilies(await loadSegmentData(sb), new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }));
    const { recipients } = resolveSegment(index, seg);
    list = recipients;
  } else {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("dssc_contacts").select("id, email, first_name, email_status").not("email", "is", null).order("id").range(from, from + 999);
      if (error) throw new Error("dssc_contacts: " + error.message);
      list.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
  }
  for (const r of list) if (r.email_status && r.email_status !== "ok") badStatus.add(nrm(r.email));
  const unsub = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("mkt_unsubscribes").select("email").order("email").range(from, from + 999);
    if (error) throw new Error("mkt_unsubscribes: " + error.message);
    (data || []).forEach(r => unsub.add(nrm(r.email)));
    if (!data || data.length < 1000) break;
  }
  const seen = new Set(), out = [];
  let skipped = 0, bounced = 0, held = 0;
  // A resumed send has already used some of the cap (those are warm now).
  const cap = Number.isFinite(+a.cold_cap) && a.cold_cap !== "" && a.cold_cap != null ? Math.max(0, +a.cold_cap - coldUsed) : null;
  let cold = 0;
  for (const r of list) {
    const e = nrm(r.email);
    if (!isEmailish(e) || seen.has(e)) continue;
    seen.add(e);
    if (unsub.has(e)) { skipped++; continue; }
    if (badStatus.has(e)) { bounced++; continue; }
    if (r.cold && cap != null) { if (cold >= cap) { held++; continue; } cold++; }
    out.push({ email: e, first_name: r.first_name || "", cold: !!r.cold });
  }
  out.sort((x, y) => x.email.localeCompare(y.email));
  return { recipients: out, unsubscribed: skipped, bounced, held_cold: held };
}

export function emailParts(item) {
  const built = buildEmail({ ...item });
  const html = withHero(item.email_html || built.html, item.asset_url);
  return { html, text: built.text, subject: item.email_subject || item.headline || "News from DSSC" };
}
const personalize = (s, email) => String(s).split(UNSUB_TOKEN).join(unsubUrl(email));

async function resendBatch(payload, idem) {
  const r = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKeyFor(payload[0]?.from)}`, "Content-Type": "application/json", "Idempotency-Key": idem },
    body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: d, error: r.ok ? null : (d?.message || d?.error || "Resend " + r.status) };
}

// Sends (or resumes) the email. -> { done, sent, failed, total, error }
export async function sendEmailItem(sb, item, { deadline = Date.now() + 60000, dry = false } = {}) {
  if (!resendKey() || !dsscFrom()) throw new Error("Email isn't connected (RESEND_API_KEY, DSSC_FROM_EMAIL)");
  if (!unsubSecret()) throw new Error("Set MARKETING_UNSUB_SECRET (or CRON_SECRET) so every email can carry an unsubscribe link");
  const prog = { ...(item.external_ids?.email || {}) };
  const { recipients, unsubscribed, bounced, held_cold } = await emailAudience(sb, item.audience, { coldUsed: prog.cold_sent || 0 });
  const cursor = prog.cursor || "";
  const todo = recipients.filter(r => r.email > cursor);
  if (dry) return { done: false, dry: true, total: recipients.length, remaining: todo.length, unsubscribed, bounced, held_cold };
  const { html, text, subject } = emailParts(item);
  const from = dsscFrom(), reply_to = inboxAddress();
  prog.total = recipients.length; prog.sent = prog.sent || 0; prog.failed = prog.failed || 0; prog.unsubscribed = unsubscribed; prog.bounced = bounced; prog.held_cold = held_cold; prog.cold_sent = prog.cold_sent || 0;
  let error = null;
  for (let i = 0; i < todo.length; i += 100) {
    if (Date.now() > deadline) break;
    const chunk = todo.slice(i, i + 100);
    const payload = chunk.map(r => {
      const u = unsubUrl(r.email);
      return { from, to: [r.email], reply_to, subject, html: personalize(html, r.email), text: personalize(text, r.email), headers: { "List-Unsubscribe": `<${u}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }, tags: [{ name: "mkt_item", value: String(item.id) }] };
    });
    let res = await resendBatch(payload, `mkt-${item.id}-${chunk[0].email}`.slice(0, 250));
    if (res.status === 429) { await sleep(1500); res = await resendBatch(payload, `mkt-${item.id}-${chunk[0].email}`.slice(0, 250)); }
    if (!res.ok) {
      if ([401, 403, 422].includes(res.status)) { error = res.error; break; }   // the whole send is wrong - stop
      prog.failed += chunk.length; prog.last_error = res.error;
    } else {
      prog.sent += chunk.length; prog.cold_sent += chunk.filter(r => r.cold).length;
      // When each family last got a marketing email (People, "never opened", warm-up).
      await sb.from("dssc_contacts").update({ last_emailed_at: new Date().toISOString() }).in("email", chunk.map(r => r.email)).then(() => {}, () => {});
    }
    prog.cursor = chunk[chunk.length - 1].email;
    await sb.from("mkt_items").update({ external_ids: { ...(item.external_ids || {}), email: prog } }).eq("id", item.id);
    item.external_ids = { ...(item.external_ids || {}), email: prog };
    await sleep(550);   // Resend: 2 requests a second
  }
  const done = !error && (!todo.length || prog.cursor === recipients[recipients.length - 1]?.email);
  return { done, sent: prog.sent, failed: prog.failed, total: prog.total, error: error || null };
}

// ── text ─────────────────────────────────────────────────────────────────────
export function smsCampaignRow(item, settings = {}) {
  const now = new Date().toISOString();
  const filters = { ...EMPTY_FILTERS, ...(settings.sms_filters || {}), ...(item.audience && typeof item.audience === "object" ? item.audience : {}) };
  return {
    brand: "dssc", name: `Marketing: ${item.headline || item.line || "text"} (${item.week_of})`.slice(0, 120), status: "scheduled",
    filters, body: String(item.body || "").trim(), media_urls: [],
    scheduled_at: item.scheduled_at && item.scheduled_at > now ? item.scheduled_at : now,
    created_by: item.approved_by || "marketing",
  };
}

// ── one item ─────────────────────────────────────────────────────────────────
const log = (sb, item_id, kind, detail) => sb.from("mkt_log").insert({ item_id, kind, detail }).then(() => {}, () => {});

// Claim an approved (or resumable) item and publish it.
// opts.resume: also take an email item stuck in 'publishing' (a cut-short run).
// -> { id, channel, status, external_ids, error, dry? , plan? }
export async function publishItem(sb, item, { settings = {}, dry = false, deadline = Date.now() + 60000, resume = false, allowFailed = false } = {}) {
  const from = ["approved", ...(allowFailed ? ["failed"] : []), ...(resume ? ["publishing"] : [])];
  if (!from.includes(item.status)) return { id: item.id, channel: item.channel, status: item.status, error: `Not approved (${item.status})` };
  if (dry) {
    const plan = item.channel === "social"
      ? { platforms: (item.platforms || []).filter(p => !(item.external_ids || {})[p]), image: item.asset_url, caption: captionFor(item), instagram_caption: captionFor(item, "instagram") }
      : item.channel === "email" ? await sendEmailItem(sb, item, { dry: true }).catch(e => ({ error: e.message }))
      : { sms_campaign: smsCampaignRow(item, settings) };
    return { id: item.id, channel: item.channel, status: item.status, dry: true, plan };
  }
  const { data: claimed } = await sb.from("mkt_items").update({ status: "publishing", error: null }).eq("id", item.id).in("status", from).select("*");
  if (!claimed?.length) return { id: item.id, channel: item.channel, status: "skipped", error: "Someone else is publishing it" };
  item = claimed[0];
  const ext = { ...(item.external_ids || {}) };
  const errors = [];
  let status = "published";
  try {
    if (item.channel === "social" && item.kind === "reel") {
      if (!item.asset_video_url) throw new Error("The reel hasn't been rendered - open it in HQ and approve again");
      if (item.video?.music_id && Number(item.video.music_volume) > 0) {
        const { data: mu } = await sb.from("mkt_music").select("attribution").eq("id", item.video.music_id).maybeSingle();
        if (mu?.attribution) item = { ...item, music_credit: mu.attribution };
      }
      for (const p of item.platforms || []) {
        if (ext[p]) continue;
        try {
          if (p === "instagram") {
            const r = await postInstagramReel(item, { containerId: ext.instagram_container || null, waitMs: Math.max(5000, Math.min(45000, deadline - Date.now() - 10000)) });
            if (r.pending) { ext.instagram_container = r.pending; status = "publishing"; }
            else { ext.instagram = r.id; delete ext.instagram_container; }
          } else if (p === "facebook") ext.facebook = await postFacebookVideo(item);
        } catch (e) { errors.push(e.message); }
      }
      if (errors.length) status = "failed";
    } else if (item.channel === "social") {
      if (!item.asset_url) throw new Error("No graphic - open it in HQ and approve again so the graphic is rendered");
      for (const p of item.platforms || []) {
        if (ext[p]) continue;
        try {
          if (p === "facebook") ext.facebook = await postFacebook(item);
          else if (p === "instagram") ext.instagram = await postInstagram(item);
          else if (p === "instagram_story" && item.asset_story_url) ext.instagram_story = await postInstagram(item, { story: true });
          else if (p === "facebook_story" && item.asset_story_url) ext.facebook_story = await postFacebookStory(item);
        } catch (e) { errors.push(e.message); }
      }
      if (errors.length) status = "failed";
    } else if (item.channel === "email") {
      const r = await sendEmailItem(sb, item, { deadline });
      ext.email = item.external_ids?.email || ext.email;
      if (r.error) { status = "failed"; errors.push(r.error); }
      else if (!r.done) status = "publishing";      // picked up again by the next cron run
    } else if (item.channel === "sms") {
      if (!twilioReady("dssc")) throw new Error(notReadyMessage("dssc"));
      if (!item.sms_campaign_id) {
        const { data: camp, error } = await sb.from("sms_campaigns").insert(smsCampaignRow(item, settings)).select("id").single();
        if (error) throw new Error("Couldn't create the text campaign: " + error.message);
        item.sms_campaign_id = camp.id;
      }
      ext.sms = { campaign_id: item.sms_campaign_id };
    }
  } catch (e) { errors.push(e.message); status = "failed"; }
  const patch = { status, external_ids: ext, error: errors.length ? errors.join(" · ").slice(0, 1000) : null };
  if (item.channel === "sms" && item.sms_campaign_id) patch.sms_campaign_id = item.sms_campaign_id;
  if (status === "published") patch.published_at = new Date().toISOString();
  await sb.from("mkt_items").update(patch).eq("id", item.id);
  await log(sb, item.id, status === "failed" ? "publish_error" : "publish", { channel: item.channel, status, external_ids: ext, error: patch.error });
  return { id: item.id, channel: item.channel, status, external_ids: ext, error: patch.error };
}

// ── tests (to the director, never the audience) ──────────────────────────────
export async function testEmail(item, to) {
  const { html, text, subject } = emailParts(item);
  return sendResend({ from: dsscFrom(), to, reply_to: inboxAddress(), subject: "[TEST] " + subject, html: personalize(html, to), text: personalize(text, to) });
}
export async function testSms(sb, item, to, who) {
  if (!twilioReady("dssc")) throw new Error(notReadyMessage("dssc"));
  const out = await sendOneSms(sb, { to, name: who, kind: "coach", brand: "dssc" }, "[TEST] " + String(item.body || ""), { sent_by_label: `${who} (marketing test)` });
  return { ok: true, to, message_id: out?.message_id || null };
}
