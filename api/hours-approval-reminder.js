// Vercel Cron: Monday 10am Central — push Drew + Kristen to approve last
// week's coach hours. They review in Time Cards and hit "Approve & email
// hours", which sends the payroll report + CSV to the bookkeeper, Drew, and
// Kristen (api/payroll-report). Nothing emails automatically — approval-gated.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; also ?token=.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (opt), APP_URL (opt),
//      HOURS_APPROVER_EMAILS (opt comma list — who gets the push).

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

// Push whichever of these each person is subscribed under (work + personal).
const APPROVERS_DEFAULT = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com", "kristen@dselitevolleyball.com", "kristen.alexandrov@gmail.com"];
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (iso) => { const d = new Date(iso + "T12:00:00Z"); return addDays(iso, -((d.getUTCDay() + 6) % 7)); };

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, APP_URL, HOURS_APPROVER_EMAILS } = process.env;

  const urlToken = (() => { try { return new URL(req.url, "https://x").searchParams.get("token") || ""; } catch { return ""; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (bearer !== CRON_SECRET && urlToken !== CRON_SECRET)) return res.status(403).json({ error: "Forbidden" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return res.status(500).json({ error: "Push not configured" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // The completed Mon–Sun week that just ended (Central).
  const chicagoToday = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const weekStart = addDays(mondayOf(chicagoToday), -7);
  const weekEnd = addDays(weekStart, 6);

  const { data: checks } = await supabase.from("coach_checkins").select("coach_name, hours, paid").gte("check_date", weekStart).lte("check_date", weekEnd);
  const coaches = new Set((checks || []).map(c => c.coach_name)).size;
  const hours = (checks || []).reduce((s, c) => s + Number(c.hours || 0), 0);
  const unpaid = (checks || []).filter(c => !c.paid).reduce((s, c) => s + Number(c.hours || 0), 0);

  webpush.setVapidDetails(VAPID_SUBJECT || "mailto:drew@dselitevolleyball.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const approvers = (HOURS_APPROVER_EMAILS ? HOURS_APPROVER_EMAILS.split(",") : APPROVERS_DEFAULT).map(s => s.trim().toLowerCase()).filter(Boolean);
  const { data: subs } = await supabase.from("push_subscriptions").select("endpoint, p256dh, auth, email");
  const mine = (subs || []).filter(s => approvers.includes((s.email || "").toLowerCase()));

  const url = (APP_URL || ("https://" + (req.headers["x-forwarded-host"] || req.headers.host))) + "/?view=timecards";
  const payload = JSON.stringify({
    title: "Approve coach hours",
    body: `${coaches} coach${coaches === 1 ? "" : "es"} · ${hours}h last week (${weekStart} – ${weekEnd}). Review in Time Cards and send to the bookkeeper.`,
    url,
  });
  await Promise.all(mine.map(s => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload).catch(() => {})));

  return res.status(200).json({ ok: true, weekStart, weekEnd, coaches, hours, unpaid, pushed: mine.length });
}
