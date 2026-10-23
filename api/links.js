// GET /api/links - the club's "link in bio" page (public), for the Instagram
// profile: www.drippingsportsclub.com/hq/api/links. Instagram captions can't
// hold a tappable link, so posts say "link in bio" and this page shows what
// was just posted - each post's graphic and its own button (the same link
// the Facebook caption carries) - then every program page.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { serviceSb } from "./_lib/marketing-core.js";
import { LINE_LINKS, lineLabel } from "../shared/marketing-plan.js";
import { BRAND_URLS } from "../shared/marketing-graphics.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const PAGES = ["volleyball", "basketball", "reach", "camp_elevate", "parties", "rentals", "open_gym", "club"];

export default async function handler(req, res) {
  return handleLinks(serviceSb(), req, res);
}

// The posts on the page: published feed posts and reels from the last 45 days, newest first.
export async function latestPosts(sb, { now = new Date(), limit = 12 } = {}) {
  if (!sb) return [];
  const since = new Date(now.getTime() - 45 * 86400e3).toISOString();
  const { data } = await sb.from("mkt_items").select("id, kind, line, headline, cta_text, cta_url, asset_url, published_at, platforms")
    .eq("channel", "social").eq("status", "published").gte("published_at", since).order("published_at", { ascending: false }).limit(40);
  return (data || []).filter(i => i.asset_url && i.cta_url && (i.platforms || []).some(p => p === "instagram" || p === "facebook")).slice(0, limit);
}

export async function handleLinks(sb, req, res) {
  const posts = await latestPosts(sb).catch(() => []);
  const card = (i) => `<a class="post" href="${esc(i.cta_url)}"><img src="${esc(i.asset_url)}" alt="" loading="lazy"><span class="t"><b>${esc(i.headline)}</b><span class="l">${esc(lineLabel(i.line))}</span><span class="go">${esc(i.cta_text || "Details")} →</span></span></a>`;
  const page = (k) => `<a class="pg" href="${esc(LINE_LINKS[k].book || LINE_LINKS[k].page)}">${esc(k === "club" ? "Everything coming up" : lineLabel(k))}<span>${esc(LINE_LINKS[k].cta)} →</span></a>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dripping Springs Sports Club · Links</title><meta name="description" content="Sign up for what you saw on Instagram - volleyball, basketball, Reach Performance, Camp Elevate, birthday parties and more.">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@800;900&family=Schibsted+Grotesk:wght@400;600;700&display=swap">
<style>
:root{--ink:#061a18;--panel:#0C3A37;--line:rgba(255,255,255,.12);--lime:#B2D049;--orange:#FF7300;--mut:#A9C7C3}
*{box-sizing:border-box}body{margin:0;background:var(--ink);color:#fff;font:16px/1.45 "Schibsted Grotesk",-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
.w{max-width:560px;margin:0 auto;padding:28px 16px 48px}
header{text-align:center;margin-bottom:22px}header img{height:56px;width:auto}
header p{margin:10px 0 0;color:var(--mut);font-size:15px}
h2{font:900 26px/1 "Barlow Condensed","Arial Narrow",Impact,sans-serif;text-transform:uppercase;letter-spacing:.02em;margin:26px 0 12px;color:var(--lime)}
a{color:inherit;text-decoration:none}
.post{display:flex;gap:14px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px;margin-bottom:10px}
.post img{width:96px;height:120px;object-fit:cover;border-radius:8px;flex:none;background:#000}
.t{display:flex;flex-direction:column;gap:3px;min-width:0}.t b{font-size:17px;line-height:1.25}
.l{font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.08em;font-weight:700}
.go{display:inline-block;margin-top:6px;align-self:flex-start;background:var(--orange);color:var(--ink);font:900 17px/1 "Barlow Condensed","Arial Narrow",Impact,sans-serif;text-transform:uppercase;letter-spacing:.03em;padding:9px 14px;border-radius:6px}
.pg{display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:15px 16px;margin-bottom:8px;font-weight:700}
.pg span{color:var(--lime);font-size:14px;white-space:nowrap}
a:focus-visible{outline:3px solid var(--lime);outline-offset:2px}
footer{text-align:center;color:var(--mut);font-size:13px;margin-top:28px}
</style></head><body><div class="w">
<header><a href="https://www.drippingsportsclub.com"><img src="${esc(BRAND_URLS.logo)}" alt="Dripping Springs Sports Club"></a><p>Where Dripping Springs plays. Tap a post to sign up.</p></header>
${posts.length ? `<h2>Just posted</h2>${posts.map(card).join("")}` : ""}
<h2>Programs</h2>${PAGES.filter(k => LINE_LINKS[k]).map(page).join("")}
<footer>The Warehouse · Fitzhugh Rd at Trautwein Rd, Dripping Springs · <a href="https://www.drippingsportsclub.com" style="color:var(--lime)">drippingsportsclub.com</a></footer>
</div></body></html>`;
  res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(html);
}
