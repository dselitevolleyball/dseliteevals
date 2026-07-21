// Vercel Cron: nudge the DSSC director (Hunter) to plan upcoming clinics.
// Runs daily; only fires when a clinic has a session in the next ~6 days and
// still has NO plan (no goals/focus/expectations and no plan blocks). Once a
// clinic is planned — lightly or in detail — it drops off, so this self-clears.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; also ?token=.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (opt), APP_URL (opt),
//      RESEND_API_KEY (or resend_api_key), DSE_FROM_EMAIL,
//      DSSC_PLANNER_EMAILS (opt comma list — who to remind).

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const PLANNERS_DEFAULT = ["hunterhaleysc10@gmail.com", "drew@dselitevolleyball.com"];
const LEAD_DAYS = 6;
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isPlanned = (c) => {
  const p = c.plan || {};
  const hasBlocks = Array.isArray(p.blocks) && p.blocks.some(b => (b.name || "").trim() || (b.desc || "").trim());
  return !!((c.goals || "").trim() || (c.focus || "").trim() || (c.expectations || "").trim() || hasBlocks);
};

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, APP_URL, DSE_FROM_EMAIL, DSSC_PLANNER_EMAILS } = process.env;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;

  const urlToken = (() => { try { return new URL(req.url, "https://x").searchParams.get("token") || ""; } catch { return ""; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (bearer !== CRON_SECRET && urlToken !== CRON_SECRET)) return res.status(403).json({ error: "Forbidden" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const horizon = addDays(today, LEAD_DAYS);

  const { data: clinics } = await supabase.from("dssc_clinics").select("*");
  // Upcoming (a session in [today, horizon]) and not yet planned.
  const need = (clinics || []).filter(c => {
    if (isPlanned(c)) return false;
    const ss = Array.isArray(c.sessions) ? c.sessions : [];
    const nextDate = ss.length ? ss.map(s => s.date).filter(Boolean).sort().find(d => d >= today) : c.clinic_date;
    return nextDate && nextDate >= today && nextDate <= horizon;
  }).map(c => {
    const ss = Array.isArray(c.sessions) ? c.sessions : [];
    const nextDate = ss.length ? ss.map(s => s.date).filter(Boolean).sort().find(d => d >= today) : c.clinic_date;
    return { name: c.name, nextDate };
  }).sort((a, b) => (a.nextDate || "").localeCompare(b.nextDate || ""));

  if (!need.length) return res.status(200).json({ ok: true, note: "all upcoming clinics are planned" });

  const url = (APP_URL || ("https://" + (req.headers["x-forwarded-host"] || req.headers.host))) + "/?view=clinics";
  const fmt = iso => { try { return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); } catch { return iso; } };
  const lines = need.map(n => `• ${n.name} — first session ${fmt(n.nextDate)}`);
  const bodyText = `${need.length} upcoming DSSC clinic${need.length === 1 ? "" : "s"} still need a plan & notes:\n${lines.join("\n")}\n\nOpen DS Elite HQ → DSSC to add goals, session focus and a plan (light or detailed).`;

  const planners = (DSSC_PLANNER_EMAILS ? DSSC_PLANNER_EMAILS.split(",") : PLANNERS_DEFAULT).map(s => s.trim().toLowerCase()).filter(Boolean);

  // Push
  let pushed = 0;
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT || "mailto:drew@dselitevolleyball.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    const { data: subs } = await supabase.from("push_subscriptions").select("endpoint, p256dh, auth, email");
    const mine = (subs || []).filter(s => planners.includes((s.email || "").toLowerCase()));
    const payload = JSON.stringify({ title: "Plan your DSSC clinics", body: `${need.length} clinic${need.length === 1 ? "" : "s"} coming up need a plan & notes. Tap to plan.`, url });
    await Promise.all(mine.map(s => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload).catch(() => {})));
    pushed = mine.length;
  }
  // Email
  if (RESEND_API_KEY && DSE_FROM_EMAIL) {
    const html = `<div style="font-family:sans-serif;font-size:14px"><p><b>${need.length}</b> upcoming DSSC clinic${need.length === 1 ? "" : "s"} still need a plan &amp; notes:</p><ul>${need.map(n => `<li>${n.name} — first session ${fmt(n.nextDate)}</li>`).join("")}</ul><p><a href="${url}" style="color:#e91e8c;font-weight:700">Plan them in DS Elite HQ → DSSC →</a> — goals, session focus, and a plan (light or detailed).</p></div>`;
    await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: DSE_FROM_EMAIL, to: planners, subject: `Plan your DSSC clinics — ${need.length} coming up`, html, text: bodyText }),
    }).catch(() => {});
  }

  return res.status(200).json({ ok: true, needCount: need.length, clinics: need.map(n => n.name), pushed });
}
