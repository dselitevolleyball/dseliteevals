// Vercel serverless function: inbound SportsYou notification email → DB.
//
// Optional push-based ingestion. The primary path is the IMAP poller
// (api/sportsyou-poll.js), but this endpoint still works if you'd rather have
// an inbound-email provider (Resend Inbound, Cloudflare Email Worker, etc.)
// POST emails here in real time.
//
// Auth (either):
//   - URL token:  POST /api/sportsyou-inbox?token=<SPORTSYOU_INBOX_TOKEN>
//   - Bearer:     Authorization: Bearer <SPORTSYOU_INBOX_TOKEN>
//
// Accepts JSON in either shape:
//   - Resend Inbound:  { type, data: { from, to, subject, text, html, headers } }
//   - Generic:         { from, subject, text, html, headers, date, messageId }
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SPORTSYOU_INBOX_TOKEN.

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { parseSportsYouEmail } from "./_lib/sportsyou-parse.js";

const MAX_RAW = 100_000; // cap stored raw payload so a giant email can't bloat a row

const timingSafeEq = (a, b) => {
  const ba = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SPORTSYOU_INBOX_TOKEN } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  if (!SPORTSYOU_INBOX_TOKEN) return res.status(500).json({ error: "SPORTSYOU_INBOX_TOKEN is not set" });

  // Auth: ?token= or Authorization: Bearer.
  const urlToken = (() => { try { return new URL(req.url, "https://x").searchParams.get("token") || ""; } catch { return ""; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!timingSafeEq(urlToken || bearer, SPORTSYOU_INBOX_TOKEN)) {
    return res.status(403).json({ error: "Invalid token" });
  }

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}); }
  catch { return res.status(400).json({ error: "Invalid JSON body" }); }

  const data = body.data && typeof body.data === "object" ? body.data : body;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Real team names to match against (also normalizes to canonical spelling).
  let teamNames = [];
  try {
    const { data: teams } = await supabase.from("practice_teams").select("team_name");
    teamNames = (teams || []).map(t => t.team_name).filter(Boolean);
  } catch { /* fall through — team stays null, parsed_ok false */ }

  const parsed = parseSportsYouEmail({
    from: data.from, subject: data.subject, text: data.text, html: data.html,
    headers: data.headers, date: data.date, messageId: data.messageId,
  }, teamNames);

  // Team invitations / system notices aren't coach posts — acknowledge (so the
  // sender marks the email done) but don't store them in the comms log.
  if (parsed.isInvitation) {
    return res.status(200).json({ ok: true, skipped: "invitation" });
  }

  const row = {
    source: "sportsyou",
    team_name: parsed.team,
    raw_team_label: parsed.subject || null,
    author: parsed.author,
    author_role: parsed.authorRole,
    subject: parsed.subject || null,
    body: parsed.body || null,
    from_email: parsed.fromEmail || null,
    posted_at: parsed.postedAt || new Date().toISOString(),
    message_id: parsed.messageId,
    raw_email: JSON.stringify(body).slice(0, MAX_RAW),
    parsed_ok: !!parsed.team,
  };

  const ins = await supabase.from("sportsyou_posts").insert(row).select("id").single();
  if (ins.error) {
    if (/duplicate key/i.test(ins.error.message || "")) return res.status(200).json({ ok: true, duplicate: true });
    console.error("sportsyou_posts insert failed:", ins.error);
    return res.status(500).json({ error: "DB error" });
  }

  return res.status(200).json({ ok: true, id: ins.data.id, matchedTeam: parsed.team, parsed_ok: !!parsed.team });
}
