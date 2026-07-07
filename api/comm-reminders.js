// Vercel Cron function: remind coaches about communication assignments they
// haven't completed yet. Runs daily; the per-team cadence (default every 2 days)
// is enforced via last_reminded_at, so daily runs still respect it.
//
// For each ACTIVE assignment, for each team still 'pending' whose coach has NOT
// posted anything to that team since the assignment was created (i.e. no
// candidate to confirm), if the cadence window has elapsed we email + web-push
// the head AND assistant coach, then bump last_reminded_at / reminder_count.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; also accepts ?token=.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//      RESEND_API_KEY (or resend_api_key), DSE_FROM_EMAIL, DSE_REPLY_TO (opt),
//      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (opt) — push is skipped if unset.

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const RESEND_BATCH = "https://api.resend.com/emails/batch";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 86_400_000;
const normName = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const extractAddress = (from) => { const m = String(from || "").match(/<([^>]+)>/); return (m ? m[1] : String(from || "")).trim(); };
const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export default async function handler(req, res) {
  const {
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
    DSE_FROM_EMAIL, DSE_REPLY_TO, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
  } = process.env;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;

  const urlToken = (() => { try { return new URL(req.url, "https://x").searchParams.get("token") || ""; } catch { return ""; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (bearer !== CRON_SECRET && urlToken !== CRON_SECRET)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  if (!RESEND_API_KEY || !DSE_FROM_EMAIL) return res.status(500).json({ error: "Email not configured" });

  const replyTo = (DSE_REPLY_TO || extractAddress(DSE_FROM_EMAIL)).trim();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const pushOn = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
  if (pushOn) webpush.setVapidDetails(VAPID_SUBJECT || "mailto:drew@dselitevolleyball.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const [asg, statuses, teams, roster, posts, subs] = await Promise.all([
    supabase.from("comm_assignments").select("*").eq("status", "active"),
    supabase.from("comm_assignment_status").select("*").eq("status", "pending"),
    supabase.from("practice_teams").select("team_name, head_coach, assistant_coach"),
    supabase.from("coach_roster").select("first_name, last_name, email"),
    supabase.from("sportsyou_posts").select("team_name, posted_at, author").not("team_name", "is", null),
    supabase.from("push_subscriptions").select("endpoint, p256dh, auth, email, teams"),
  ]).then(rs => rs.map(r => r.data || []));

  const assignmentById = new Map(asg.map(a => [a.id, a]));
  const teamByName = new Map(teams.map(t => [t.team_name, t]));
  // Resolve a team's head/assistant coach name → email via the coach roster.
  const emailByName = new Map();
  for (const c of roster) {
    const full = normName((c.first_name || "") + " " + (c.last_name || ""));
    if (full && c.email && EMAIL_RE.test(c.email)) emailByName.set(full, c.email.trim());
  }
  // A post only counts as "the coach did it" if it's from one of THAT team's
  // coaches — not an admin posting club-wide. Build each team's coach-name set.
  const teamCoachSet = new Map();
  for (const t of teams) {
    const set = new Set();
    for (const c of [t.head_coach, t.assistant_coach].filter(Boolean)) { const n = normName(c); set.add(n); set.add(n.split(" ")[0]); }
    teamCoachSet.set(t.team_name, set);
  }
  const isCoachPost = (p) => {
    const set = teamCoachSet.get(p.team_name); if (!set) return false;
    const a = normName(p.author); if (!a) return false;
    return set.has(a) || set.has(a.split(" ")[0]);
  };
  // Latest COACH post timestamp per team → tells us if the coach already posted.
  const maxPostByTeam = new Map();
  for (const p of posts) {
    if (!isCoachPost(p)) continue;
    const cur = maxPostByTeam.get(p.team_name);
    if (!cur || new Date(p.posted_at) > new Date(cur)) maxPostByTeam.set(p.team_name, p.posted_at);
  }

  const emailMessages = [];
  const pushJobs = [];
  const bump = []; // status ids to mark reminded
  const logRows = []; // reminder log rows to store (readable back in the app)
  const now = Date.now();

  for (const st of statuses) {
    const a = assignmentById.get(st.assignment_id);
    if (!a) continue; // assignment archived/deleted
    // Skip if a coach already posted since the assignment went out (candidate exists).
    const maxPosted = maxPostByTeam.get(st.team_name);
    if (maxPosted && new Date(maxPosted).getTime() >= new Date(a.created_at).getTime()) continue;
    // Cadence: only remind if the window has elapsed.
    const cadence = Math.max(1, a.reminder_cadence_days || 2);
    if (st.last_reminded_at && (now - Date.parse(st.last_reminded_at)) < cadence * DAY_MS) continue;

    const t = teamByName.get(st.team_name) || {};
    const names = [t.head_coach, t.assistant_coach].filter(Boolean);
    const emails = [...new Set(names.map(n => emailByName.get(normName(n))).filter(e => e && EMAIL_RE.test(e)))];

    const subject = `Reminder: send your ${st.team_name} team a message — "${a.title}"`;
    const text =
      `Hi,\n\nQuick reminder from DS Elite: please post an update to your ${st.team_name} team on SportsYou.\n\n` +
      `Assignment: ${a.title}\n` +
      (a.instructions ? `${a.instructions}\n` : "") +
      (a.due_date ? `Due: ${a.due_date}\n` : "") +
      `\nOnce you've posted, this reminder stops automatically.\n\nThanks!\nDS Elite`;
    const html =
      `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">` +
      `<p>Quick reminder from DS Elite: please post an update to your <b>${escapeHtml(st.team_name)}</b> team on SportsYou.</p>` +
      `<p><b>${escapeHtml(a.title)}</b><br>${a.instructions ? escapeHtml(a.instructions).replace(/\n/g, "<br>") : ""}</p>` +
      (a.due_date ? `<p>Due: ${escapeHtml(String(a.due_date))}</p>` : "") +
      `<p style="color:#888;font-size:12px">Once you've posted, this reminder stops automatically.</p></div>`;

    for (const email of emails) emailMessages.push({ from: DSE_FROM_EMAIL, to: [email], reply_to: replyTo, subject, html, text });

    if (pushOn) {
      const emailSet = new Set(emails.map(e => e.toLowerCase()));
      const targets = subs.filter(s => emailSet.has((s.email || "").toLowerCase()) || (Array.isArray(s.teams) && s.teams.includes(st.team_name)));
      const payload = JSON.stringify({ title: `Post to your ${st.team_name} team`, body: a.title, url: "/" });
      for (const s of targets) pushJobs.push({ s, payload });
    }
    logRows.push({ assignment_id: a.id, team_name: st.team_name, subject, body: text, recipients: emails, push_sent: pushOn, source: "auto", sent_by: "Automatic reminder" });
    bump.push(st);
  }

  // Send emails (Resend batches up to 100).
  let emailsSent = 0;
  for (let i = 0; i < emailMessages.length; i += 100) {
    const group = emailMessages.slice(i, i + 100);
    try {
      const r = await fetch(RESEND_BATCH, { method: "POST", headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify(group) });
      if (r.ok) emailsSent += group.length; else console.error("Resend error:", await r.text());
    } catch (e) { console.error("Resend send failed:", e.message); }
  }

  // Send push.
  let pushSent = 0; const stale = [];
  await Promise.all(pushJobs.map(async ({ s, payload }) => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); pushSent++; }
    catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) stale.push(s.endpoint); }
  }));
  if (stale.length) await supabase.from("push_subscriptions").delete().in("endpoint", stale);

  // Store the reminder log so admins can read exactly what went out.
  if (logRows.length) {
    const logIns = await supabase.from("comm_reminder_log").insert(logRows);
    if (logIns.error) console.error("reminder log insert failed:", logIns.error.message);
  }

  // Mark reminded.
  const nowIso = new Date().toISOString();
  for (const st of bump) {
    await supabase.from("comm_assignment_status").update({
      last_reminded_at: nowIso, reminder_count: (st.reminder_count || 0) + 1, updated_at: nowIso,
    }).eq("id", st.id);
  }

  return res.status(200).json({ ok: true, teamsReminded: bump.length, emailsSent, pushSent, pushRemoved: stale.length });
}
