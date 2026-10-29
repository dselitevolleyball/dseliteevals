// Where Google sends Drew back after "Connect" in HQ -> Product -> Settings ->
// Email assistant (api/_lib/mail-assistant.js). This address must be listed in
// the Google OAuth client's Authorized redirect URIs (MAIL_ASSISTANT_SETUP.md).
//
// GET ?code&state   swap the code for a lasting token for that mailbox
// The state is signed and lasts 30 minutes, so nobody else can finish it.

import { createClient } from "@supabase/supabase-js";
import { finishConnect } from "./_lib/mail-assistant.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const HQ = "https://dseliteevals.vercel.app/?view=product";
const page = (inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect Gmail · HQ</title>
<style>body{margin:0;background:#0a0a0a;color:#fff;font:16px/1.5 system-ui,sans-serif}.w{max-width:520px;margin:0 auto;padding:32px 18px}h1{font-size:26px;margin:0 0 10px}p{color:#bbb}
.b{display:block;text-align:left;margin:14px 0;padding:14px 16px;border-radius:10px;border:1px solid #333;background:#141414;color:#fff;text-decoration:none}.ok{color:#22c55e}.bad{color:#ff8a7a}</style></head><body><div class="w">${inner}</div></body></html>`;
const send = (res, status, html) => res.status(status).setHeader("Content-Type", "text/html; charset=utf-8").setHeader("Cache-Control", "no-store").send(page(html));

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const url = new URL(req.url, "https://x");
  if (url.searchParams.get("error")) return send(res, 400, `<h1>Gmail didn't connect</h1><p>${esc(url.searchParams.get("error_description") || url.searchParams.get("error"))}</p><a class="b" href="${HQ}">Back to HQ</a>`);
  try {
    const r = await finishConnect(sb, { code: url.searchParams.get("code"), state: url.searchParams.get("state") });
    const other = r.asked && r.asked !== r.email ? `<p class="bad">You asked to connect ${esc(r.asked)} but signed in as ${esc(r.email)} - that's the one connected.</p>` : "";
    return send(res, 200, `<h1 class="ok">✓ Connected</h1><p>The email assistant now reads <b>${esc(r.email)}</b>. New email that needs an answer shows up in your Slack DMs with a drafted reply - nothing is sent until you press Send.</p>${other}<a class="b" href="${HQ}">Back to HQ</a>`);
  } catch (e) {
    return send(res, e.status || 500, `<h1 class="bad">Didn't connect</h1><p>${esc(e.message)}</p><a class="b" href="${HQ}">Back to HQ</a>`);
  }
}
