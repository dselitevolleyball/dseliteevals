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
    if (!SPORTSYOU_OUTBOX_SECRET) return res.status(200).json({ configured: false });
    return res.status(200).json({ configured: true, secret: SPORTSYOU_OUTBOX_SECRET });
  }

  // ── Everything else is the bookmarklet, authenticated by the shared secret ──
  const token = url?.searchParams.get("token") || "";
  if (!SPORTSYOU_OUTBOX_SECRET) return res.status(500).json({ error: "SPORTSYOU_OUTBOX_SECRET is not set in Vercel." });
  if (!timingSafeEqual(token, SPORTSYOU_OUTBOX_SECRET)) return res.status(403).json({ error: "Forbidden" });

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

    let posted = 0, failed = 0;
    for (const r of results) {
      const id = Number(r?.id);
      if (!Number.isFinite(id)) continue;
      const ok = !!r.ok;
      const { error } = await supabase.from("sportsyou_outbox").update({
        status: ok ? "posted" : "failed",
        posted_at: ok ? new Date().toISOString() : null,
        sy_response: ok ? null : String(r.error || "unknown error").slice(0, 2000),
      }).eq("id", id);
      if (error) continue;
      ok ? posted++ : failed++;
    }
    return res.status(200).json({ ok: true, posted, failed });
  }

  res.setHeader("Allow", ["GET", "POST", "OPTIONS"]);
  return res.status(405).json({ error: "Method not allowed" });
}
