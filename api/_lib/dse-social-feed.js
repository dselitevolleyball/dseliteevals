// "Has this already been posted?" for DS Elite Social (Drew, Oct 29 2026:
// "check feed automatically"). The club also posts family photos by hand, so
// before a batch becomes a draft every photo is compared with what's on DS
// Elite's Facebook Page and Instagram; a photo that's already there is
// recorded as used (an imported "already on Facebook" post in Posted, linked
// to the photo) and left out.
//
// The comparison is a 256-bit difference hash (16x16 brightness gradients) of
// the whole photo and of a few centre crops, against each feed image. On the
// first 151 uploads every true repeat scored <= 71 bits apart and every
// different photo >= 85, except near-blank images (screenshots of text, flat
// graphics), which look alike to the hash - those are never matched - and a
// phone screenshot that came within 64 of a wide text slide. So past 40 bits
// the two must also be the same shape (every real repeat was, to the pixel:
// Facebook keeps a photo's proportions).

import { createCanvas } from "@napi-rs/canvas";
import { dseMeta } from "./dse-social-meta.js";
import { photo as loadPhoto } from "./dse-social-render.js";

export const MATCH_MAX = 72;
const CROPS = [[0, 0.1, 1, 0.8], [0.1, 0, 0.8, 1], [0.125, 0, 0.75, 1], [0, 0.125, 1, 0.75], [0.2, 0, 0.6, 1], [0, 0.2, 1, 0.6], [0, 0, 1, 0.75], [0, 0.25, 1, 0.75]];

export function dhash(img, box = [0, 0, 1, 1]) {
  const W = 17, H = 16, c = createCanvas(W, H), x = c.getContext("2d");
  const [bx, by, bw, bh] = box;
  x.drawImage(img, bx * img.width, by * img.height, bw * img.width, bh * img.height, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data, g = (i, j) => { const k = (j * W + i) * 4; return d[k] * 0.299 + d[k + 1] * 0.587 + d[k + 2] * 0.114; };
  let s = "";
  for (let j = 0; j < H; j++) for (let i = 0; i < 16; i++) s += g(i, j) > g(i + 1, j) ? "1" : "0";
  return s;
}
export const photoHashes = (img) => [dhash(img), ...CROPS.map(c => dhash(img, c))];
const ham = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };
// Near-blank: too few or too many brightness steps to tell images apart.
export const isFlat = (h) => { const n = [...h].reduce((s, c) => s + (c === "1"), 0); return n < 40 || n > 216; };

// The closest feed image to a photo, if it's the same photo. aspect: the
// photo's width / height (when known).
const sameShape = (a, b) => !a || !b || Math.abs(Math.log(a / b)) < 0.1;
export function matchFeed(hashes, feed, aspect = null) {
  if (!hashes?.length || isFlat(hashes[0])) return null;
  let best = null;
  for (const f of feed) {
    if (!f.hash || isFlat(f.hash)) continue;
    const d = Math.min(...hashes.map(h => ham(h, f.hash)));
    if (d > 40 && !sameShape(aspect, f.aspect)) continue;
    if (!best || d < best.d) best = { ...f, d };
  }
  return best && best.d <= MATCH_MAX ? best : null;
}

// Every image on the Page and its Instagram from the last `days` days, hashed.
// Hashes are kept per image for the life of the function, so the cron's
// second batch (or the next run on a warm function) doesn't fetch them again.
const hashCache = new Map();
let indexCache = { at: 0, days: 0, list: null };
export async function feedIndex(sb, { days = 75 } = {}) {
  if (indexCache.list && Date.now() - indexCache.at < 10 * 60e3 && indexCache.days >= days) return indexCache.list;
  const m = await dseMeta(sb);
  if (!m) return [];
  const G = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v26.0"}/`;
  const since = Math.floor((Date.now() - days * 86400e3) / 1000);
  const pages = async (url, keep) => { const out = []; for (let i = 0; url && i < 10; i++) { const j = await fetch(url, { signal: AbortSignal.timeout(20000) }).then(r => r.json()).catch(() => ({})); if (j.error || !j.data) break; const rows = j.data.filter(keep); out.push(...rows); if (rows.length < j.data.length) break; url = j.paging?.next; } return out; };
  const items = [];
  const fb = await pages(`${G}${m.pageId}/published_posts?fields=id,created_time,message,permalink_url,full_picture,attachments{media{image{src}},subattachments.limit(50){media{image{src}}}}&since=${since}&limit=50&access_token=${m.token}`, () => true);
  for (const p of fb) {
    const a = p.attachments?.data?.[0], subs = a?.subattachments?.data || [];
    const srcs = subs.length ? subs.map(s => s.media?.image?.src) : [a?.media?.image?.src || p.full_picture];
    srcs.filter(Boolean).forEach(src => items.push({ where: "facebook", post: p.id, at: p.created_time, link: p.permalink_url, text: p.message || "", count: srcs.length, cover: p.full_picture || src, src }));
  }
  if (m.igId) {
    const ig = await pages(`${G}${m.igId}/media?fields=id,timestamp,caption,permalink,media_type,media_url,children{media_type,media_url}&limit=50&access_token=${m.token}`, x => Date.parse(x.timestamp) >= since * 1000);
    for (const p of ig) {
      const kids = p.children?.data?.length ? p.children.data : [p];
      const imgs = kids.filter(k => k.media_type === "IMAGE");
      imgs.forEach(k => items.push({ where: "instagram", post: p.id, at: p.timestamp, link: p.permalink, text: p.caption || "", count: imgs.length, cover: imgs[0].media_url, src: k.media_url }));
    }
  }
  const todo = items.filter(f => !hashCache.has(f.src));
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < todo.length) {
      const f = todo[i++];
      try { const img = await loadPhoto(f.src); hashCache.set(f.src, { hash: dhash(img), aspect: img.width / img.height }); } catch { hashCache.set(f.src, null); }
    }
  }));
  const list = items.map(f => ({ ...f, hash: hashCache.get(f.src)?.hash || null, aspect: hashCache.get(f.src)?.aspect || null }));
  indexCache = { at: Date.now(), days, list };
  return list;
}

// Record photos found in the feed: one imported, already-published post per
// feed post (added to if it exists), and each photo marked with it.
// hits: [{ photo: player_photos row, item: feed item }]
export async function recordFeedMatches(sb, hits) {
  const byPost = new Map();
  for (const h of hits) { const k = h.item.where + ":" + h.item.post; if (!byPost.has(k)) byPost.set(k, []); byPost.get(k).push(h); }
  const out = [];
  for (const list of byPost.values()) {
    const it = list[0].item, key = it.where === "facebook" ? "facebook" : "instagram";
    const { data: existing } = await sb.from("dse_social_posts").select("id, photo_ids, photos").eq(`external_ids->>${key}`, it.post).limit(1);
    let id = existing?.[0]?.id;
    const add = list.map(h => ({ photo_id: h.photo.id, url: h.item.src, note: `matched in the ${key === "facebook" ? "Facebook" : "Instagram"} feed` }));
    if (id) {
      const have = new Set((existing[0].photo_ids || []).map(Number));
      const fresh = add.filter(a => !have.has(Number(a.photo_id)));
      if (fresh.length) await sb.from("dse_social_posts").update({ photo_ids: [...have, ...fresh.map(a => a.photo_id)], photos: [...(existing[0].photos || []), ...fresh] }).eq("id", id);
    } else {
      const teams = [...new Set(list.map(h => h.photo.team_name).filter(Boolean))];
      const { data: row, error } = await sb.from("dse_social_posts").insert({
        kind: "photos", format: it.count > 1 ? "carousel" : "single", status: "published", created_by: "feed check",
        title: `${teams.join(", ")} · already on ${key === "facebook" ? "Facebook" : "Instagram"}`, team_name: teams[0] || null,
        photo_ids: add.map(a => a.photo_id), photos: add, caption: it.text || "", platforms: [key], published_at: it.at, asset_url: it.cover,
        external_ids: { [key]: it.post, links: { [key]: it.link } }, ai: { imported: true, matched: list.map(h => ({ photo_id: h.photo.id, distance: h.item.d })) },
      }).select("id").single();
      if (error) continue;
      id = row.id;
    }
    await sb.from("player_photos").update({ social_post_id: id }).in("id", list.map(h => h.photo.id)).is("social_post_id", null);
    out.push({ post: id, photos: list.map(h => h.photo.id), link: it.link });
  }
  return out;
}
