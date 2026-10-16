// Vercel Cron (hourly): send the emails queued in email_schedule whose
// send_at has passed (migrations/20261016_email_schedule.sql). Exists because
// /api/send-email can only schedule 72 hours out, and reminders like the
// gear-store ones (Oct 23 / Oct 30 / Nov 1, 2026) are a week or more away.
//
// Recipients for audience 'families' are worked out when the email goes, so a
// family that joins after it was queued still gets it: the parents of every
// current player (a team plus a live offer). Each send goes through
// /api/send-email, so it's logged in email_log like any other.
//
//   ?dry=1   list what is due and who it would go to; send nothing
// Auth: Vercel Cron (Authorization: Bearer <CRON_SECRET>) or the service-role key.

import { createClient } from "@supabase/supabase-js";
import { appOrigin } from "../shared/app-origin.js";

const TERMINAL = new Set(["declined", "opted_out", "not_invited"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const config = { maxDuration: 300 };

async function familyEmails(sb) {
  const { data, error } = await sb.from("players").select("team_assignment, offer_status, parent_email, parent_email2, parent_email3").not("team_assignment", "is", null);
  if (error) throw error;
  const out = new Set();
  for (const p of data || []) {
    if (!String(p.team_assignment || "").trim() || TERMINAL.has(String(p.offer_status || ""))) continue;
    for (const e of [p.parent_email, p.parent_email2, p.parent_email3]) { const x = String(e || "").trim().toLowerCase(); if (EMAIL_RE.test(x)) out.add(x); }
  }
  return [...out];
}

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET } = process.env;
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer || (bearer !== CRON_SECRET && bearer !== SUPABASE_SERVICE_ROLE_KEY)) return res.status(403).json({ error: "Forbidden" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const dry = new URL(req.url, "https://x").searchParams.get("dry") === "1";

  const { data: due, error } = await sb.from("email_schedule").select("*").eq("status", "pending").lte("send_at", new Date().toISOString()).order("send_at");
  if (error) return res.status(500).json({ error: error.message });
  const results = [];
  for (const row of due || []) {
    const to = row.audience === "families" ? await familyEmails(sb) : (row.recipients || []);
    if (dry) { results.push({ id: row.id, label: row.label, subject: row.subject, recipients: to.length }); continue; }
    // Claim it first so an overlapping run can't send it twice.
    const { data: claimed } = await sb.from("email_schedule").update({ status: "sending" }).eq("id", row.id).eq("status", "pending").select("id");
    if (!claimed?.length) continue;
    let result;
    try {
      const r = await fetch(appOrigin(req) + "/api/send-email", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY },
        body: JSON.stringify({ subject: row.subject, body: row.body, bodyHtml: row.body_html || undefined, recipients: to, skipPush: true, sentBy: row.created_by || "Scheduled email", source: "email_schedule:" + (row.label || row.id) }) });
      result = { status: r.status, ...(await r.json().catch(() => ({}))) };
    } catch (e) { result = { error: e.message }; }
    const ok = result.status === 200 && (result.sent || 0) > 0;
    await sb.from("email_schedule").update({ status: ok ? "sent" : "failed", sent_at: new Date().toISOString(), result: { ...result, recipients: to.length, failed: (result.failed || []).slice(0, 50) } }).eq("id", row.id);
    results.push({ id: row.id, label: row.label, ok, sent: result.sent, recipients: to.length });
  }
  return res.status(200).json({ ok: true, dry, due: (due || []).length, results });
}
