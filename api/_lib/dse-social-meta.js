// DS Elite's Facebook Page (and the Instagram linked to it): the connection
// and the posting calls for HQ -> Social (DSE_SOCIAL_SETUP.md).
//
// The club's one Meta app ("DSSC HQ") can post to any Page its admin manages,
// so DS Elite needs no app of its own - just its own Page token. That token
// lives in mkt_secrets ('dse_meta_page_token', meta {page_id, page_name,
// ig_id, ig_username}); DSE_META_PAGE_ACCESS_TOKEN / DSE_META_PAGE_ID /
// DSE_META_IG_USER_ID in Vercel work too. It's made by:
//   - Connect Facebook in HQ (OAuth): Facebook asks which Pages to allow, the
//     code comes back to /api/dse-social-connect, is swapped for a long-lived
//     user token (META_APP_ID + META_APP_SECRET) and the Page picked keeps a
//     Page token that never expires; or
//   - pasting a token from Graph API Explorer (user or Page token).
// The DSSC Page's connection (api/_lib/marketing-publish.js) is separate.

import { createHmac, timingSafeEqual } from "node:crypto";

const env = () => process.env;
export const graphVersion = () => env().META_GRAPH_VERSION || "v26.0";
const G = () => `https://graph.facebook.com/${graphVersion()}`;
export const SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish", "business_management"];
const SECRET_KEY = "dse_meta_page_token", PENDING_KEY = "dse_meta_user_token";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (status, msg) => Object.assign(new Error(msg), { status });

async function getJson(path, params = {}) {
  const u = new URL(path.startsWith("http") ? path : `${G()}/${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  return fetch(u, { signal: AbortSignal.timeout(20000) }).then(r => r.json()).catch(e => ({ error: { message: e.message } }));
}
async function graph(token, path, params = {}, { method = "POST" } = {}) {
  if (method === "GET") {
    const j = await getJson(path, { ...params, access_token: token });
    if (j.error) throw new Error(`Facebook ${path.split("/").pop()}: ${j.error.message}`);
    return j;
  }
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, access_token: token })) if (v != null) body.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  const r = await fetch(`${G()}/${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Facebook ${path.split("/").pop()}: ${j.error?.message || "HTTP " + r.status}`);
  return j;
}

// ── the connection ──────────────────────────────────────────────────────────
export async function dseMeta(sb) {
  const { data } = await sb.from("mkt_secrets").select("value, meta, updated_at, updated_by").eq("key", SECRET_KEY).maybeSingle();
  const e = env();
  if (data?.value) return { token: data.value, pageId: data.meta?.page_id, pageName: data.meta?.page_name || null, igId: data.meta?.ig_id || null, igUsername: data.meta?.ig_username || null, since: data.updated_at, by: data.updated_by, source: "hq" };
  if (e.DSE_META_PAGE_ACCESS_TOKEN && e.DSE_META_PAGE_ID) return { token: e.DSE_META_PAGE_ACCESS_TOKEN, pageId: e.DSE_META_PAGE_ID, pageName: null, igId: e.DSE_META_IG_USER_ID || null, source: "env" };
  return null;
}
export const appReady = () => !!(env().META_APP_ID && env().META_APP_SECRET);

// DS Elite's own Instagram. The Page's linked Instagram is read live from
// Facebook (it can be relinked in Meta at any time) and DS Elite only ever
// posts to this one: on Oct 29 2026 the DS Elite Page was linked to the
// club's @drippingspringssportsclub and a team post landed there.
export const DSE_IG = String(env().DSE_IG_USERNAME || "dselitevb").replace(/^@/, "").toLowerCase();
export async function dseInstagram(sb, m) {
  m = m || await dseMeta(sb);
  if (!m) return { ok: false, reason: "Facebook isn't connected" };
  let id = m.igId, username = m.igUsername || null;
  const page = await getJson(m.pageId, { fields: "instagram_business_account{id,username}", access_token: m.token }).catch(() => ({}));
  if (page.id && !page.error) {   // read fine: trust it over what was saved
    id = page.instagram_business_account?.id || null; username = page.instagram_business_account?.username || null;
    if (m.source === "hq" && (id !== m.igId || username !== m.igUsername)) {
      const { data } = await sb.from("mkt_secrets").select("meta").eq("key", SECRET_KEY).maybeSingle();
      await sb.from("mkt_secrets").update({ meta: { ...(data?.meta || {}), ig_id: id, ig_username: username } }).eq("key", SECRET_KEY);
    }
  }
  if (!id) return { ok: false, id: null, username: null, reason: `No Instagram is linked to ${m.pageName || "the Page"}, so it went to Facebook only` };
  if (String(username || "").toLowerCase() !== DSE_IG) return { ok: false, id, username, reason: `The Instagram linked to ${m.pageName || "the Page"} is @${username}, not @${DSE_IG} - nothing went to Instagram. Link @${DSE_IG} to the Page in Meta Business Suite` };
  return { ok: true, id, username };
}

// What HQ shows under Settings: connected or not, to which Page, and what's
// wrong if it can't post. Never returns the token.
export async function metaStatus(sb, { deep = false } = {}) {
  const m = await dseMeta(sb);
  const base = { app_ready: appReady(), oauth: appReady() };
  if (!m) return { ...base, connected: false, problems: ["Not connected yet - press Connect Facebook"] };
  const out = { ...base, connected: true, page: { id: m.pageId, name: m.pageName }, instagram: m.igId ? { id: m.igId, username: m.igUsername } : null, since: m.since || null, by: m.by || null, source: m.source, problems: [] };
  if (!deep) return out;
  const dbg = (await getJson("debug_token", { input_token: m.token, access_token: m.token })).data || {};
  const page = await getJson(m.pageId, { fields: "id,name,instagram_business_account{id,username}", access_token: m.token });
  if (dbg.is_valid === false) out.problems.push("Facebook says the connection isn't valid any more (a password change or a removed app does that) - Connect Facebook again");
  const missing = (dbg.scopes || []).length ? ["pages_manage_posts", "pages_read_engagement"].filter(s => !dbg.scopes.includes(s)) : [];
  if (missing.length) out.problems.push("Missing permissions: " + missing.join(", "));
  if (page.error) out.problems.push("Can't read the Page: " + page.error.message);
  else {
    out.page = { id: page.id, name: page.name };
    const ig = await dseInstagram(sb, m);
    out.instagram = ig.id ? { id: ig.id, username: ig.username, ok: ig.ok } : null;
    if (ig.id && !ig.ok) out.problems.push(ig.reason);
  }
  out.expires = dbg.expires_at ? new Date(dbg.expires_at * 1000).toISOString().slice(0, 10) : "never";
  out.app = dbg.application || null;
  return out;
}

// The signed `state` for the Facebook login round trip: who started it, and
// when, so the callback can't be replayed or started by someone else.
const stateKey = () => env().CRON_SECRET || env().SUPABASE_SERVICE_ROLE_KEY || "";
export function signState(email, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ e: email, t: now })).toString("base64url");
  return body + "." + createHmac("sha256", stateKey()).update(body).digest("base64url").slice(0, 32);
}
export function readState(state, now = Date.now()) {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig || !stateKey()) return null;
  const want = createHmac("sha256", stateKey()).update(body).digest("base64url").slice(0, 32);
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try { const j = JSON.parse(Buffer.from(body, "base64url").toString()); return now - j.t < 30 * 60e3 ? j : null; } catch { return null; }
}
export const redirectUri = () => (env().DSE_SOCIAL_PUBLIC_BASE || "https://dseliteevals.vercel.app").replace(/\/+$/, "") + "/api/dse-social-connect";
// Facebook's login dialog. A Business app's "Facebook Login for Business"
// takes a configuration id (META_LOGIN_CONFIG_ID) instead of a scope list.
export function loginUrl(email) {
  const u = new URL(`https://www.facebook.com/${graphVersion()}/dialog/oauth`);
  u.searchParams.set("client_id", env().META_APP_ID || "");
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("state", signState(email));
  u.searchParams.set("response_type", "code");
  if (env().META_LOGIN_CONFIG_ID) u.searchParams.set("config_id", env().META_LOGIN_CONFIG_ID);
  else u.searchParams.set("scope", SCOPES.join(","));
  return u.toString();
}

// A short-lived user token -> a long-lived one (60 days), whose Page tokens
// never expire. Needs the app secret; without it the token is kept as is.
async function longLived(userToken) {
  const { META_APP_ID: id, META_APP_SECRET: secret } = env();
  if (!id || !secret) return { token: userToken, long: false };
  const j = await getJson("oauth/access_token", { grant_type: "fb_exchange_token", client_id: id, client_secret: secret, fb_exchange_token: userToken });
  return j.access_token ? { token: j.access_token, long: true } : { token: userToken, long: false, error: j.error?.message };
}
export async function codeToUserToken(code) {
  const { META_APP_ID: id, META_APP_SECRET: secret } = env();
  if (!id || !secret) throw fail(500, "META_APP_ID and META_APP_SECRET aren't set in Vercel");
  const j = await getJson("oauth/access_token", { client_id: id, client_secret: secret, redirect_uri: redirectUri(), code });
  if (!j.access_token) throw fail(400, "Facebook: " + (j.error?.message || "no token came back"));
  return (await longLived(j.access_token)).token;
}
export async function pagesFor(userToken) {
  const j = await getJson("me/accounts", { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100", access_token: userToken });
  if (j.error) throw fail(400, "Facebook: " + j.error.message);
  return (j.data || []).map(p => ({ id: p.id, name: p.name, token: p.access_token, ig_id: p.instagram_business_account?.id || null, ig_username: p.instagram_business_account?.username || null }));
}
// The Page most likely to be DS Elite's, for the picker's default.
export const likelyDse = (pages) => pages.find(p => /ds\s*elite|dselite/i.test(p.name)) || null;

export async function savePage(sb, page, by) {
  const { error } = await sb.from("mkt_secrets").upsert({ key: SECRET_KEY, value: page.token, meta: { page_id: page.id, page_name: page.name, ig_id: page.ig_id || null, ig_username: page.ig_username || null }, updated_at: new Date().toISOString(), updated_by: by || null });
  if (error) throw fail(500, "Saving the connection: " + error.message);
  await sb.from("mkt_secrets").delete().eq("key", PENDING_KEY);
  return { page: { id: page.id, name: page.name }, instagram: page.ig_id ? { id: page.ig_id, username: page.ig_username } : null };
}
// Between "Facebook said yes" and "this is the Page": the user token waits
// here (service role only) for the picker, at most 30 minutes.
export async function holdUserToken(sb, token, by) {
  await sb.from("mkt_secrets").upsert({ key: PENDING_KEY, value: token, meta: { at: Date.now() }, updated_at: new Date().toISOString(), updated_by: by || null });
}
export async function heldUserToken(sb) {
  const { data } = await sb.from("mkt_secrets").select("value, meta").eq("key", PENDING_KEY).maybeSingle();
  return data?.value && Date.now() - (data.meta?.at || 0) < 30 * 60e3 ? data.value : null;
}
export async function disconnect(sb) {
  await sb.from("mkt_secrets").delete().in("key", [SECRET_KEY, PENDING_KEY]);
}

// The paste route: a user token (the Pages it manages are listed) or a Page
// token (saved straight away).
export async function connectWithToken(sb, raw, by) {
  const token = String(raw || "").trim().replace(/^Bearer\s+/i, "");
  if (!/^[A-Za-z0-9_|-]{40,}$/.test(token)) throw fail(400, "That doesn't look like a Facebook access token");
  const dbg = (await getJson("debug_token", { input_token: token, access_token: token })).data || {};
  if (dbg.is_valid === false) throw fail(400, "Facebook says that token isn't valid any more - make a new one");
  if (dbg.type === "PAGE") {
    const p = await getJson("me", { fields: "id,name,instagram_business_account{id,username}", access_token: token });
    if (p.error) throw fail(400, "Facebook: " + p.error.message);
    return { saved: await savePage(sb, { id: p.id, name: p.name, token, ig_id: p.instagram_business_account?.id, ig_username: p.instagram_business_account?.username }, by), expires: dbg.expires_at ? new Date(dbg.expires_at * 1000).toISOString().slice(0, 10) : "never" };
  }
  const user = await longLived(token);
  const pages = await pagesFor(user.token);
  if (!pages.length) throw fail(400, "That login doesn't manage any Pages - tick DS Elite's Page when Facebook asks which Pages to allow");
  await holdUserToken(sb, user.token, by);
  return { pages: pages.map(({ token: _t, ...p }) => p), likely: likelyDse(pages)?.id || null, long_lived: user.long };
}
export async function pickPage(sb, pageId, by) {
  const user = await heldUserToken(sb);
  if (!user) throw fail(400, "That took too long - connect Facebook again");
  const page = (await pagesFor(user)).find(p => p.id === String(pageId));
  if (!page) throw fail(400, "That Page isn't one this login manages");
  return savePage(sb, page, by);
}

// ── posting ─────────────────────────────────────────────────────────────────
async function need(sb, platform) {
  const m = await dseMeta(sb);
  if (!m) throw new Error("Facebook isn't connected - HQ -> Social -> Settings -> Connect Facebook");
  if (platform === "instagram") {
    const ig = await dseInstagram(sb, m);
    if (!ig.ok) throw new Error(ig.reason);
    return { ...m, igId: ig.id, igUsername: ig.username };
  }
  return m;
}
// One image on the Page.
export async function fbPhoto(sb, url, caption) {
  const m = await need(sb, "facebook");
  const j = await graph(m.token, `${m.pageId}/photos`, { url, caption, published: "true" });
  return j.post_id || j.id;
}
// Several photos in one Page post: each goes up unpublished, then one post
// carries them all.
export async function fbMultiPhoto(sb, urls, caption) {
  const m = await need(sb, "facebook");
  if (urls.length === 1) return fbPhoto(sb, urls[0], caption);
  const ids = [];
  for (const url of urls.slice(0, 30)) ids.push((await graph(m.token, `${m.pageId}/photos`, { url, published: "false" })).id);
  const params = { message: caption };
  ids.forEach((id, i) => { params[`attached_media[${i}]`] = { media_fbid: id }; });
  return (await graph(m.token, `${m.pageId}/feed`, params)).id;
}
async function waitContainer(token, id, waitMs = 40000) {
  const until = Date.now() + waitMs;
  for (;;) {
    const s = await graph(token, id, { fields: "status_code" }, { method: "GET" }).catch(() => ({}));
    if (!s.status_code || s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram couldn't process the image (${s.status_code})`);
    if (Date.now() > until) throw new Error("Instagram is still processing - try again in a minute");
    await sleep(2000);
  }
}
// One image on Instagram. Feed images must be between 4:5 and 1.91:1 -
// everything HQ renders is 1080x1350 (4:5).
export async function igImage(sb, url, caption) {
  const m = await need(sb, "instagram");
  const c = await graph(m.token, `${m.igId}/media`, { image_url: url, caption });
  await waitContainer(m.token, c.id);
  return (await graph(m.token, `${m.igId}/media_publish`, { creation_id: c.id })).id;
}
// Up to 10 images as one Instagram carousel.
export async function igCarousel(sb, urls, caption) {
  const m = await need(sb, "instagram");
  if (urls.length === 1) return igImage(sb, urls[0], caption);
  const kids = [];
  for (const url of urls.slice(0, 10)) kids.push((await graph(m.token, `${m.igId}/media`, { image_url: url, is_carousel_item: "true" })).id);
  for (const k of kids) await waitContainer(m.token, k);
  const c = await graph(m.token, `${m.igId}/media`, { media_type: "CAROUSEL", children: kids.join(","), caption });
  await waitContainer(m.token, c.id);
  return (await graph(m.token, `${m.igId}/media_publish`, { creation_id: c.id })).id;
}
// Where a published post can be seen.
export async function permalinks(sb, ext = {}) {
  const m = await dseMeta(sb); if (!m) return {};
  const out = {};
  if (ext.facebook) out.facebook = (await getJson(ext.facebook, { fields: "permalink_url", access_token: m.token })).permalink_url || null;
  if (ext.instagram) out.instagram = (await getJson(ext.instagram, { fields: "permalink", access_token: m.token })).permalink || null;
  return out;
}
