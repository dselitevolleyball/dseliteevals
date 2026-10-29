// Where Facebook sends Drew back after "Connect Facebook" in HQ -> Social
// (api/_lib/dse-social-meta.js). This address must be listed in the Meta app
// under Facebook Login -> Settings -> Valid OAuth Redirect URIs.
//
// GET  ?code&state     swap the code for a long-lived token, then show the
//                      Pages it manages (DS Elite's first) to pick from
// POST state, page_id  save that Page's token - it never expires
// The state is signed and lasts 30 minutes, so nobody else can finish it.

import { createClient } from "@supabase/supabase-js";
import * as M from "./_lib/dse-social-meta.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const HQ = "https://dseliteevals.vercel.app/?view=social";
const page = (inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect Facebook · DS Elite HQ</title>
<style>body{margin:0;background:#0a0a0a;color:#fff;font:16px/1.5 system-ui,sans-serif}.w{max-width:520px;margin:0 auto;padding:32px 18px}h1{font-size:26px;margin:0 0 10px}p{color:#bbb}
button,.b{display:block;width:100%;box-sizing:border-box;text-align:left;margin:10px 0;padding:14px 16px;border-radius:10px;border:1px solid #333;background:#141414;color:#fff;font:inherit;cursor:pointer;text-decoration:none}
button.pick{border-color:#e91e8c}small{color:#999;display:block}.ok{color:#22c55e}.bad{color:#ff8a7a}</style></head><body><div class="w">${inner}</div></body></html>`;
const send = (res, status, html) => res.status(status).setHeader("Content-Type", "text/html; charset=utf-8").setHeader("Cache-Control", "no-store").send(page(html));

async function form(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const raw = typeof req.body === "string" ? req.body : await new Promise(r => { let d = ""; req.on("data", c => d += c); req.on("end", () => r(d)); });
  return Object.fromEntries(new URLSearchParams(raw));
}

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const url = new URL(req.url, "https://x");
  try {
    if (req.method === "POST") {
      const b = await form(req);
      const st = M.readState(b.state);
      if (!st) return send(res, 400, `<h1>That link has run out</h1><p>Start again from HQ → Social → Settings → Connect Facebook.</p><a class="b" href="${HQ}">Back to HQ</a>`);
      const saved = await M.pickPage(sb, b.page_id, st.e);
      return send(res, 200, `<h1 class="ok">✓ Connected</h1><p>DS Elite HQ will post to <b>${esc(saved.page.name)}</b>${saved.instagram ? ` and Instagram <b>@${esc(saved.instagram.username || saved.instagram.id)}</b>` : ""}. Nothing posts until a post is approved.</p>${saved.instagram ? "" : `<p class="bad">No Instagram is linked to this Page. To post there too, make the Instagram a professional account and link it to the Page (Meta Business Suite → Settings → Accounts), then connect again.</p>`}<a class="b" href="${HQ}">Back to HQ → Social</a>`);
    }
    if (url.searchParams.get("error")) return send(res, 400, `<h1>Facebook didn't connect</h1><p>${esc(url.searchParams.get("error_description") || url.searchParams.get("error"))}</p><a class="b" href="${HQ}">Back to HQ</a>`);
    const state = url.searchParams.get("state"), code = url.searchParams.get("code");
    // Opened directly (not on the way back from Facebook): say what this page is.
    if (!state && !code) return send(res, 200, `<h1>This is where Facebook sends you back</h1><p>Connecting starts in HQ: <b>Social → Settings → Connect Facebook</b>. Facebook asks you to sign in and pick DS Elite's Page, then brings you back here to finish.</p>${M.appReady() ? "" : `<p class="bad">The Connect button is off until <b>META_APP_ID</b> and <b>META_APP_SECRET</b> are added to the dseliteevals project in Vercel (Settings → Environment Variables) and it's redeployed. Until then you can paste a token instead (Settings → "Or paste a token").</p>`}<a class="b" href="${HQ}">Go to HQ → Social</a>`);
    const st = M.readState(state);
    if (!st || !code) return send(res, 400, `<h1>That link has run out</h1><p>Start again from HQ → Social → Settings → Connect Facebook.</p><a class="b" href="${HQ}">Back to HQ</a>`);
    const user = await M.codeToUserToken(code);
    const pages = await M.pagesFor(user);
    if (!pages.length) return send(res, 400, `<h1>No Pages came through</h1><p>When Facebook asks which Pages to allow, tick DS Elite's Page (and its Instagram). Then try again.</p><a class="b" href="${HQ}">Back to HQ</a>`);
    await M.holdUserToken(sb, user, st.e);
    const likely = M.likelyDse(pages);
    const sorted = likely ? [likely, ...pages.filter(p => p.id !== likely.id)] : pages;
    const buttons = sorted.map(p => `<form method="post"><input type="hidden" name="state" value="${esc(state)}"><input type="hidden" name="page_id" value="${esc(p.id)}"><button class="${p === likely ? "pick" : ""}">${esc(p.name)}<small>${p.ig_username ? "Instagram @" + esc(p.ig_username) : "No Instagram linked"}${p === likely ? " · looks like DS Elite's" : ""}</small></button></form>`).join("");
    return send(res, 200, `<h1>Which Page should DS Elite HQ post to?</h1><p>Pick DS Elite Volleyball's Page. Posts also go to the Instagram linked to it.</p>${buttons}`);
  } catch (e) {
    return send(res, e.status || 500, `<h1>Something went wrong</h1><p class="bad">${esc(e.message)}</p><a class="b" href="${HQ}">Back to HQ</a>`);
  }
}
