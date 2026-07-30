// Vercel serverless function: the SportsYou posting queue.
//
// SportsYou's GraphQL API pins access-control-allow-origin to
// https://sportsyou.com and authenticates with HttpOnly cookies, so no server
// can post on our behalf — the postCreate call has to run in a logged-in
// browser tab. This endpoint is the handoff between DS HQ and that tab:
//
//   GET  /api/sportsyou-outbox?token=<secret>          → pending items to post
//   POST /api/sportsyou-outbox?token=<secret>          → mark items posted/failed
//        body: { results: [{ id, ok, error? }, ...] }
//   GET  /api/sportsyou-outbox?action=secret           → the secret itself,
//        Authorization: Bearer <supabase session>        admins only, so the app
//                                                        can build the bookmarklet
//
// The secret is a bearer token embedded in a bookmarklet, so it is NOT a
// user credential — it only grants access to messages we queued ourselves.
// It never touches the SportsYou session, which stays HttpOnly in the browser.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SPORTSYOU_OUTBOX_SECRET.

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const OWNER_EMAILS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];

const timingSafeEqual = (a, b) => {
  const ba = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (ba.length !== bb.length || !ba.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SPORTSYOU_OUTBOX_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  // Strip ALL whitespace from the secret on both sides. A value pasted into
  // Vercel with a stray newline percent-encodes as %0A in the bookmarklet URL,
  // which makes Chrome encode the surrounding quotes too and the bookmarklet
  // dies with "Invalid or unexpected token". Secrets never contain whitespace,
  // so normalising is safe and beats debugging it a second time.
  const SECRET = String(SPORTSYOU_OUTBOX_SECRET || "").replace(/\s+/g, "");

  // The bookmarklet runs on https://sportsyou.com, so it needs CORS to reach us.
  const origin = req.headers.origin || "";
  if (/^https:\/\/(www\.)?sportsyou\.com$/.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") return res.status(204).end();

  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const action = url?.searchParams.get("action") || "";

  // ── Admins fetch the secret so the app can render a working bookmarklet ──
  if (action === "secret") {
    const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!bearer) return res.status(401).json({ error: "Not signed in" });
    const { data: { user } = {} } = await supabase.auth.getUser(bearer).catch(() => ({ data: {} }));
    const email = (user?.email || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ error: "Not signed in" });
    let ok = OWNER_EMAILS.includes(email);
    if (!ok) {
      const { data: c } = await supabase.from("coaches").select("is_admin, is_approved").ilike("email", email).maybeSingle();
      ok = !!(c && c.is_approved && c.is_admin);
    }
    if (!ok) return res.status(403).json({ error: "Admins only" });
    if (!SECRET) return res.status(200).json({ configured: false });
    return res.status(200).json({ configured: true, secret: SECRET });
  }

  // ── Everything else is the bookmarklet, authenticated by the shared secret ──
  const token = url?.searchParams.get("token") || "";
  if (!SECRET) return res.status(500).json({ error: "SPORTSYOU_OUTBOX_SECRET is not set in Vercel." });
  if (!timingSafeEqual(String(token).replace(/\s+/g, ""), SECRET)) return res.status(403).json({ error: "Forbidden" });

  // The poster itself, served as source. Chrome mangles long javascript: URLs
  // when a bookmark is pasted rather than dragged, so the bookmark stays a tiny
  // loader and the real logic lives here — which also means fixing a bug never
  // requires re-dragging the bookmark.
  if (action === "script") {
    const self = "https://" + (req.headers["x-forwarded-host"] || req.headers.host) + "/api/sportsyou-outbox?token=" + encodeURIComponent(token);
    const js = `(async () => {
  const A = ${JSON.stringify(self)};
  if (!/sportsyou\\.com$/.test(location.hostname)) { alert('Open a sportsyou.com tab first.'); return; }
  const N = s => String(s || '').replace(/^DS Elite\\s+/i, '').replace(/[^\\x00-\\x7F]/g, '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const AL = { '11 rise': '11 rise 1', '12-1 rise': '12 rise 1', '12-2 rise': '12 rise 2', '13-1 rise': '13 rise 1' };
  let t; try { t = JSON.parse(localStorage.getItem('sy-web::teams')); } catch (e) {}
  const ar = Array.isArray(t) ? t : ((t && (t.teams || t.data)) || []);
  const BY = {}; ar.forEach(x => { let n = N(x.name || x.teamName); n = AL[n] || n; if (x.id) BY[n] = x.id; });
  if (!Object.keys(BY).length) { alert('Could not read your SportsYou teams - open the Teams page, then retry.'); return; }
  const o = await (await fetch(A)).json();
  const p = o.pending || [];
  if (!p.length) { alert('Nothing queued in DS HQ.'); return; }
  const G = {}; p.forEach(i => (G[i.message] = G[i.message] || []).push(i));
  const RS = [], MISS = [];
  for (const m of Object.keys(G)) {
    const ids = [], ok = [];
    for (const x of G[m]) {
      const id = BY[N(x.team_name)];
      if (id) { ids.push(id); ok.push(x); }
      else { MISS.push(x.team_name); RS.push({ id: x.id, ok: false, error: 'no SportsYou team match' }); }
    }
    if (!ids.length) continue;
    const q = 'mutation {postCreate(allowComments:true, message:' + JSON.stringify(m)
      + ', postTypes:[' + ids.map(() => '"team"').join(', ')
      + '], scheduledTime:"", targetIds:[' + ids.map(v => JSON.stringify(v)).join(', ') + '])}';
    try {
      const j = await (await fetch('https://api.prod.sportsyou.com/graphqlServices', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', 'sy-unique-id': localStorage.getItem('sy-unique-id') || '' },
        body: JSON.stringify({ query: q })
      })).json();
      const bad = j && j.errors ? JSON.stringify(j.errors).slice(0, 300) : null;
      ok.forEach(x => RS.push({ id: x.id, ok: !bad, error: bad }));
    } catch (e) { ok.forEach(x => RS.push({ id: x.id, ok: false, error: String(e) })); }
  }
  const r = await (await fetch(A, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results: RS }) })).json();
  alert('SportsYou \\u2713 posted ' + (r.posted || 0) + ', failed ' + (r.failed || 0)
    + (MISS.length ? '\\n\\nNo SportsYou team for: ' + MISS.join(', ') : ''));
})();`;
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(js);
  }

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("sportsyou_outbox")
      .select("id, team_name, subject, message, batch_id, queued_at")
      .eq("status", "pending")
      .order("queued_at", { ascending: true })
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, pending: data || [] });
  }

  if (req.method === "POST") {
    let body;
    try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
    catch { return res.status(400).json({ error: "Invalid JSON" }); }
    const results = Array.isArray(body?.results) ? body.results : [];
    if (!results.length) return res.status(400).json({ error: "results[] required" });

    let posted = 0, failed = 0; const skipped = [];
    for (const r of results) {
      const id = Number(r?.id);
      if (!Number.isFinite(id)) continue;
      const ok = !!r.ok;
      // .select() so we count rows ACTUALLY updated. Without it a no-match
      // update returns error:null and we'd report success while the row stayed
      // pending — which is exactly what happened on the first live run.
      const { data, error } = await supabase.from("sportsyou_outbox").update({
        status: ok ? "posted" : "failed",
        posted_at: ok ? new Date().toISOString() : null,
        sy_response: ok ? null : String(r.error || "unknown error").slice(0, 2000),
      }).eq("id", id).select("id");
      if (error) { skipped.push({ id, error: error.message }); continue; }
      if (!data || !data.length) { skipped.push({ id, error: "no such row" }); continue; }
      ok ? posted++ : failed++;
    }
    return res.status(200).json({ ok: true, posted, failed, skipped });
  }

  res.setHeader("Allow", ["GET", "POST", "OPTIONS"]);
  return res.status(405).json({ error: "Method not allowed" });
}
