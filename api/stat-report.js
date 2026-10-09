// POST /api/stat-report — send one player's performance testing report.
//   { player_id, test_to? }   test_to = send only to that address, subject [TEST]
// The email is rebuilt here from the saved template + the player's saved draft
// with shared/stat-report.js (the same builder as the app's preview), sent from
// DS Elite with replies going to the coach who sent it, and logged in
// stat_report_sends + email_log.
//
// Who may send: owners/admins, or a coach listed in REPORT_SENDERS (Brandon).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, DSE_FROM_EMAIL.

import { createClient } from "@supabase/supabase-js";
import { buildReport } from "../shared/stat-report.js";

const OWNER_EMAILS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
// The DSSC performance coach (the new Brandon at DSSC - not Brandon Blahnik).
export const REPORT_SENDERS = ["brandon@drippingsportsclub.com"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nrm = (v) => String(v || "").trim().toLowerCase();

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DSE_FROM_EMAIL } = process.env;
  const RESEND = process.env.RESEND_API_KEY || process.env.resend_api_key;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND || !DSE_FROM_EMAIL) return res.status(500).json({ error: "Server not configured" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
  const email = nrm(user?.email);
  if (!email) return res.status(401).json({ error: "Sign in first" });
  const { data: me } = await sb.from("coaches").select("display_name, is_admin, is_approved").ilike("email", email).maybeSingle();
  const allowed = OWNER_EMAILS.includes(email) || REPORT_SENDERS.includes(email) || !!(me?.is_approved && me?.is_admin);
  if (!allowed) return res.status(403).json({ error: "Only admins and the performance coach can send testing reports." });
  const senderName = me?.display_name || email;

  let b = req.body; try { b = typeof b === "string" ? JSON.parse(b) : (b || {}); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  const playerId = Number(b.player_id);
  if (!playerId) return res.status(400).json({ error: "player_id required" });
  const testTo = b.test_to ? nrm(b.test_to) : null;
  if (testTo && !EMAIL_RE.test(testTo)) return res.status(400).json({ error: "Bad test address" });

  const [{ data: player }, { data: tests }, { data: set }, { data: draft }] = await Promise.all([
    sb.from("players").select("id, first_name, last_name, team_assignment, parent_name, parent2_name, parent_email, parent_email2, parent_email3, stand_reach, approach_touch, jump_touch, sprint_10y").eq("id", playerId).maybeSingle(),
    sb.from("player_stat_tests").select("*").eq("player_id", playerId).order("test_date"),
    sb.from("stat_report_settings").select("data").eq("id", "main").maybeSingle(),
    sb.from("stat_report_drafts").select("*").eq("player_id", playerId).maybeSingle(),
  ]);
  if (!player) return res.status(404).json({ error: "Player not found" });
  const firsts = [...new Set([player.parent_name, player.parent2_name].map(x => String(x || "").trim().split(/\s+/)[0]).filter(Boolean))];
  const parentFirst = firsts.length <= 1 ? (firsts[0] || "") : firsts.slice(0, -1).join(", ") + " and " + firsts[firsts.length - 1];
  const rep = buildReport({ player, tests: tests || [], settings: set?.data || {}, draft: draft || {}, parentFirst });
  if (!rep.picked.length) return res.status(400).json({ error: "No testing numbers on file for " + player.first_name + " yet." });

  const to = testTo ? [testTo] : [...new Set([player.parent_email, player.parent_email2, player.parent_email3].map(nrm).filter(e => EMAIL_RE.test(e)))];
  if (!to.length) return res.status(400).json({ error: "No parent email on file for " + player.first_name + "." });
  const addr = (/<([^>]+)>/.exec(DSE_FROM_EMAIL) || [, DSE_FROM_EMAIL])[1].trim();
  const subject = (testTo ? "[TEST] " : "") + rep.subject;

  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + RESEND, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `${senderName.replace(/[<>"]/g, "")} · DS Elite <${addr}>`, to, reply_to: email, subject, html: rep.html, text: rep.text }) });
  if (!r.ok) return res.status(502).json({ error: "Email failed: " + r.status + " " + (await r.text()).slice(0, 200) });

  await Promise.all([
    sb.from("stat_report_sends").insert({ player_id: playerId, recipients: to, subject, body: rep.text, test: !!testTo, sent_by: senderName }),
    sb.from("email_log").insert({ subject, body: rep.text, recipient_count: to.length, recipients: to, sent_count: to.length, failed_count: 0, sent_by: senderName, sent_by_email: email }),
  ]);
  return res.status(200).json({ ok: true, to, test: !!testTo });
}
