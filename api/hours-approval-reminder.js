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
const norm = (s) => String(s || "").trim().toLowerCase();
const weekdayOf = (iso) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(iso + "T12:00:00Z").getUTCDay()];
// Practice phases (mirror of the app's PHASE_DATES).
const PHASE_DATES = [
  { id: "summer", from: "2026-07-12", to: "2026-09-12" },
  { id: "fall1", from: "2026-09-13", to: "2026-10-11" },
  { id: "fall2", from: "2026-10-18", to: "2026-11-15" },
  { id: "season", from: "2026-12-01", to: "2027-05-06" },
  { id: "postseason", from: "2027-05-07", to: "2027-06-15" },
];
const phaseForDate = (iso) => { const p = PHASE_DATES.find(p => iso >= p.from && iso <= p.to); return p ? p.id : null; };

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

  const [{ data: checks }, { data: teams }, { data: assigns }, { data: cancels }, { data: cover }, { data: reqs }, { data: roster }, { data: excl }] = await Promise.all([
    supabase.from("coach_checkins").select("coach_name, coach_email, check_date, hours, paid").gte("check_date", weekStart).lte("check_date", weekEnd),
    supabase.from("practice_teams").select("team_name, head_coach, assistant_coach"),
    supabase.from("practice_assignments").select("team_name, day, phase"),
    supabase.from("practice_cancellations").select("practice_date, team_name"),
    supabase.from("practice_coverage").select("practice_date, team_name, coach_out"),
    supabase.from("coach_requests").select("coach_name, request_date, team_name, status"),
    supabase.from("coach_roster").select("first_name, last_name, email"),
    supabase.from("hours_reminder_excludes").select("coach_name"),
  ]);
  const coaches = new Set((checks || []).map(c => c.coach_name)).size;
  const hours = (checks || []).reduce((s, c) => s + Number(c.hours || 0), 0);
  const unpaid = (checks || []).filter(c => !c.paid).reduce((s, c) => s + Number(c.hours || 0), 0);

  // Resolve coaches to canonical names (email → roster, else name tokens).
  const rosterByEmail = new Map();
  (roster || []).forEach(r => { if (r.email) rosterByEmail.set(norm(r.email), `${r.first_name || ""} ${r.last_name || ""}`.trim()); });
  const canonNames = new Map();
  (roster || []).forEach(r => { const f = `${r.first_name || ""} ${r.last_name || ""}`.trim(); if (f) canonNames.set(norm(f), f); });
  (teams || []).forEach(t => [t.head_coach, t.assistant_coach].forEach(n => { if (n && n.trim()) canonNames.set(norm(n), n.trim()); }));
  const canon = (raw, email) => {
    if (email) { const e = rosterByEmail.get(norm(email)); if (e) return e; }
    const base = String(raw || "").replace(/^\s*coach\s+/i, "").trim();
    const n = norm(base);
    if (canonNames.has(n)) return canonNames.get(n);
    const toks = n.split(/\s+/).filter(Boolean);
    if (toks.length) {
      const first = toks[0], last = toks[toks.length - 1];
      for (const [k, v] of canonNames) { const kt = k.split(/\s+/), kf = kt[0], kl = kt[kt.length - 1]; if (kl === last && (kf === first || kf.startsWith(first) || first.startsWith(kf))) return v; }
      const fo = [...canonNames.values()].filter(v => norm(v).split(/\s+/)[0] === first); if (fo.length === 1) return fo[0];
    }
    return base || raw;
  };

  // Expected-but-didn't-clock-in: HC/AC of teams that practiced last week,
  // minus coaches marked out/covered, minus muted coaches, who logged nothing.
  const excluded = new Set((excl || []).map(x => norm(x.coach_name)));
  const clockedByDate = {};
  (checks || []).forEach(c => { (clockedByDate[c.check_date] = clockedByDate[c.check_date] || new Set()).add(norm(canon(c.coach_name, c.coach_email))); });
  const isOut = (nm, date, team) => (cover || []).some(c => c.practice_date === date && (!team || c.team_name === team) && norm(c.coach_out) === norm(nm))
    || (reqs || []).some(r => r.request_date === date && !/denied|declined|rejected/i.test(r.status || "") && norm(r.coach_name) === norm(nm) && (!r.team_name || !team || r.team_name === team));
  const missSet = new Map();
  for (let off = 0; off < 7; off++) {
    const date = addDays(weekStart, off);
    const ph = phaseForDate(date); if (!ph) continue;
    if ((cancels || []).some(c => c.practice_date === date && !c.team_name)) continue;
    const wd = weekdayOf(date);
    const teamCanceled = tn => (cancels || []).some(c => c.practice_date === date && c.team_name === tn);
    const teamsToday = [...new Set((assigns || []).filter(a => (a.phase || "season") === ph && a.day === wd && !teamCanceled(a.team_name)).map(a => a.team_name))];
    teamsToday.forEach(tn => { const t = (teams || []).find(x => x.team_name === tn);
      [t?.head_coach, t?.assistant_coach].filter(Boolean).forEach(raw => {
        const cn = canon(raw, null), nk = norm(cn);
        if (excluded.has(nk) || excluded.has(norm(raw))) return;
        if (isOut(raw, date, tn)) return;
        if ((clockedByDate[date] || new Set()).has(nk)) return;
        missSet.set(nk, cn);
      });
    });
  }
  const missingNames = [...missSet.values()].sort();

  webpush.setVapidDetails(VAPID_SUBJECT || "mailto:drew@dselitevolleyball.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const approvers = (HOURS_APPROVER_EMAILS ? HOURS_APPROVER_EMAILS.split(",") : APPROVERS_DEFAULT).map(s => s.trim().toLowerCase()).filter(Boolean);
  const { data: subs } = await supabase.from("push_subscriptions").select("endpoint, p256dh, auth, email");
  const mine = (subs || []).filter(s => approvers.includes((s.email || "").toLowerCase()));

  const url = (APP_URL || ("https://" + (req.headers["x-forwarded-host"] || req.headers.host))) + "/?view=timecards";
  const missPart = missingNames.length
    ? ` · ⚠ ${missingNames.length} didn't clock in: ${missingNames.slice(0, 6).join(", ")}${missingNames.length > 6 ? " +" + (missingNames.length - 6) : ""}`
    : "";
  const payload = JSON.stringify({
    title: "Approve coach hours",
    body: `${coaches} coach${coaches === 1 ? "" : "es"} · ${hours}h last week (${weekStart} – ${weekEnd}).${missPart} Review in Time Cards and send to the bookkeeper.`,
    url,
  });
  await Promise.all(mine.map(s => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload).catch(() => {})));

  return res.status(200).json({ ok: true, weekStart, weekEnd, coaches, hours, unpaid, missing: missingNames, pushed: mine.length });
}
