// Vercel Cron: daily at noon Central. Compiles all changelog entries that
// haven't gone out yet into a digest, stages it as a PENDING broadcast, and
// notifies Drew to approve. Nothing goes to coaches until Drew approves in the
// app. Does nothing if there are no new entries, or if a digest is already
// pending awaiting approval.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; also ?token=.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//      RESEND_API_KEY (or resend_api_key), DSE_FROM_EMAIL,
//      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (opt),
//      CHANGELOG_APPROVER_EMAIL (default drew@dselitevolleyball.com), APP_URL (opt).

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const KIND_LABEL = { feature: "New", fix: "Fix", improvement: "Improved", other: "Update" };

export default async function handler(req, res) {
  const {
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, DSE_FROM_EMAIL,
    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, APP_URL, CHANGELOG_APPROVER_EMAIL,
  } = process.env;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;

  const urlToken = (() => { try { return new URL(req.url, "https://x").searchParams.get("token") || ""; } catch { return ""; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (bearer !== CRON_SECRET && urlToken !== CRON_SECRET)) return res.status(403).json({ error: "Forbidden" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  // Already a pending digest? Leave it for Drew — don't stack up.
  const { data: pend } = await supabase.from("changelog_broadcasts").select("id").eq("status", "pending").limit(1);
  if (pend && pend.length) return res.status(200).json({ ok: true, note: "a digest is already pending approval" });

  // Already staged today?
  const { data: todayBc } = await supabase.from("changelog_broadcasts").select("id").eq("created_for_date", today).limit(1);
  if (todayBc && todayBc.length) return res.status(200).json({ ok: true, note: "already staged today" });

  // Unsent entries.
  const { data: entries } = await supabase.from("changelog_entries").select("*").is("broadcast_id", null).order("created_at");
  if (!entries || !entries.length) return res.status(200).json({ ok: true, note: "nothing new to announce" });

  const lines = entries.map(e => `• ${KIND_LABEL[e.kind] || "Update"}: ${e.title}${e.detail ? " — " + e.detail : ""}`);
  const body = lines.join("\n");
  const title = "What's new in DS Elite HQ";

  const { data: bc, error: insErr } = await supabase.from("changelog_broadcasts").insert({
    title, body, entry_ids: entries.map(e => e.id), status: "pending", created_for_date: today,
  }).select().single();
  if (insErr) return res.status(500).json({ error: insErr.message });

  const url = APP_URL || ("https://" + (req.headers["x-forwarded-host"] || req.headers.host || "dseliteevals.vercel.app"));
  const approver = (CHANGELOG_APPROVER_EMAIL || "drew@dselitevolleyball.com").toLowerCase();

  // Push to Drew.
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT || "mailto:drew@dselitevolleyball.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    const { data: subs } = await supabase.from("push_subscriptions").select("endpoint, p256dh, auth, email");
    const mine = (subs || []).filter(s => (s.email || "").toLowerCase() === approver);
    const payload = JSON.stringify({ title: "Changelog ready to approve", body: `${entries.length} change${entries.length === 1 ? "" : "s"} — review and send to coaches.`, url: url + "/?view=notifications" });
    await Promise.all(mine.map(s => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload).catch(() => {})));
  }
  // Email Drew.
  if (RESEND_API_KEY && DSE_FROM_EMAIL) {
    const html = `<div style="font-family:sans-serif;font-size:14px"><p><b>${entries.length}</b> change${entries.length === 1 ? "" : "s"} are staged to announce to coaches. Review and approve in DS Elite HQ &rarr; Notifications.</p><pre style="white-space:pre-wrap;font-family:inherit;background:#f5f5f5;border-radius:8px;padding:10px 12px">${body.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</pre><p><a href="${url}" style="color:#e91e8c;font-weight:700">Open DS Elite HQ →</a></p></div>`;
    await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: DSE_FROM_EMAIL, to: [approver], subject: `Changelog ready to approve — ${entries.length} change${entries.length === 1 ? "" : "s"}`, html, text: body }),
    }).catch(() => {});
  }

  return res.status(200).json({ ok: true, staged: bc.id, entries: entries.length });
}
