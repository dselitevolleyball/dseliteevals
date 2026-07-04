// Vercel Cron function: nudge about teams that have gone quiet on SportsYou.
//
// Runs daily (see vercel.json "crons"). Finds teams whose most-recent
// sportsyou_posts.posted_at is older than SPORTSYOU_SILENT_DAYS (or that have
// never posted) and:
//   - always emails an admin digest (SPORTSYOU_DIGEST_TO) listing them, and
//   - if SPORTSYOU_REMIND_COACHES=true, also emails each team's head coach a
//     gentle nudge (resolved by matching practice_teams.head_coach to
//     coaches.display_name), BCC'ing the admin.
//
// Coach-direct nudges default OFF so you can first confirm team↔coach matching
// looks right in the admin digest. Flip the env var when you trust it.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET
// is set; we also accept ?token=<CRON_SECRET>.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   - required.
//   RESEND_API_KEY (or resend_api_key)        - required to send.
//   DSE_FROM_EMAIL                            - required ("DS Elite <drew@dselitevolleyball.com>").
//   DSE_REPLY_TO                              - optional reply-to.
//   CRON_SECRET                               - required; protects the endpoint.
//   SPORTSYOU_DIGEST_TO                       - optional; admin digest recipient (defaults to reply-to).
//   SPORTSYOU_SILENT_DAYS                     - optional; default 7.
//   SPORTSYOU_REMIND_COACHES                  - optional; "true" to email coaches directly.

import { createClient } from "@supabase/supabase-js";

const RESEND_BATCH = "https://api.resend.com/emails/batch";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 86_400_000;

const extractAddress = (from) => {
  const m = String(from || "").match(/<([^>]+)>/);
  return (m ? m[1] : String(from || "")).trim();
};
const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const normName = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

async function resendSend(apiKey, messages) {
  const r = await fetch(RESEND_BATCH, {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data && (data.message || data.error)) || ("Resend error " + r.status));
  return data;
}

export default async function handler(req, res) {
  const {
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
    DSE_FROM_EMAIL, DSE_REPLY_TO, CRON_SECRET,
    SPORTSYOU_DIGEST_TO, SPORTSYOU_SILENT_DAYS, SPORTSYOU_REMIND_COACHES,
  } = process.env;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;

  // Auth.
  const urlToken = (() => { try { return new URL(req.url, "https://x").searchParams.get("token") || ""; } catch { return ""; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (bearer !== CRON_SECRET && urlToken !== CRON_SECRET)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  if (!RESEND_API_KEY || !DSE_FROM_EMAIL) return res.status(500).json({ error: "Email not configured" });

  const silentDays = Math.max(1, parseInt(SPORTSYOU_SILENT_DAYS || "7", 10) || 7);
  const cutoffMs = Date.now() - silentDays * DAY_MS;
  const replyTo = (DSE_REPLY_TO || extractAddress(DSE_FROM_EMAIL)).trim();
  const digestTo = (SPORTSYOU_DIGEST_TO || replyTo).trim();

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Teams + coaches + latest post per team.
  const [{ data: teams }, { data: coaches }, { data: posts }] = await Promise.all([
    supabase.from("practice_teams").select("team_name, head_coach"),
    supabase.from("coaches").select("display_name, email"),
    supabase.from("sportsyou_posts").select("team_name, posted_at").not("team_name", "is", null).order("posted_at", { ascending: false }),
  ]);

  // Latest post timestamp per team (posts are desc, so first seen = latest).
  const latestByTeam = new Map();
  for (const p of (posts || [])) {
    if (!latestByTeam.has(p.team_name)) latestByTeam.set(p.team_name, p.posted_at);
  }
  // Coach display_name -> email.
  const emailByName = new Map();
  for (const c of (coaches || [])) {
    if (c.display_name && c.email && EMAIL_RE.test(c.email)) emailByName.set(normName(c.display_name), c.email.trim());
  }

  const silent = [];
  for (const t of (teams || [])) {
    const last = latestByTeam.get(t.team_name);
    const lastMs = last ? Date.parse(last) : null;
    if (lastMs && lastMs >= cutoffMs) continue; // recently active — skip
    const days = lastMs ? Math.floor((Date.now() - lastMs) / DAY_MS) : null;
    const coachEmail = emailByName.get(normName(t.head_coach)) || null;
    silent.push({ team: t.team_name, coach: t.head_coach || "—", coachEmail, days, last });
  }
  // Longest-silent first; never-posted (null days) at the very top.
  silent.sort((a, b) => (b.days == null ? 1e9 : b.days) - (a.days == null ? 1e9 : a.days));

  const remindCoaches = String(SPORTSYOU_REMIND_COACHES || "").toLowerCase() === "true";
  const coachEmailsSent = [];

  // Optional direct-to-coach nudges.
  if (remindCoaches && silent.length) {
    const withEmail = silent.filter(s => s.coachEmail);
    if (withEmail.length) {
      const messages = withEmail.map(s => ({
        from: DSE_FROM_EMAIL,
        to: [s.coachEmail],
        bcc: [digestTo],
        reply_to: replyTo,
        subject: `Reminder: post an update to your ${s.team} team on SportsYou`,
        text:
          `Hi ${s.coach},\n\n` +
          `Quick nudge from DS Elite — your ${s.team} team ` +
          (s.days == null ? `hasn't had a post on SportsYou yet.` : `hasn't had a SportsYou post in ${s.days} day${s.days === 1 ? "" : "s"}.`) +
          `\n\nWhen you get a chance, drop your team a quick update (schedule, reminders, encouragement) so families stay in the loop.\n\nThanks!\nDS Elite`,
      }));
      try { await resendSend(RESEND_API_KEY, messages); withEmail.forEach(s => coachEmailsSent.push(s.team)); }
      catch (err) { console.error("Coach reminder send failed:", err.message); }
    }
  }

  // Admin digest — always (even if nothing silent, so you know it ran).
  const rows = silent.map(s => {
    const when = s.days == null ? "never posted" : `${s.days} day${s.days === 1 ? "" : "s"} ago`;
    const notified = coachEmailsSent.includes(s.team) ? " · coach emailed" : (s.coachEmail ? "" : " · no coach email on file");
    return `<tr><td style="padding:4px 10px;border-bottom:1px solid #eee">${escapeHtml(s.team)}</td>` +
           `<td style="padding:4px 10px;border-bottom:1px solid #eee">${escapeHtml(s.coach)}</td>` +
           `<td style="padding:4px 10px;border-bottom:1px solid #eee">${escapeHtml(when)}${escapeHtml(notified)}</td></tr>`;
  }).join("");

  const digestHtml = silent.length
    ? `<div style="font-family:sans-serif;font-size:14px">` +
      `<p><b>${silent.length}</b> team${silent.length === 1 ? "" : "s"} ${silent.length === 1 ? "has" : "have"} gone quiet on SportsYou (no post in ${silentDays}+ days):</p>` +
      `<table style="border-collapse:collapse;font-size:13px"><thead><tr>` +
      `<th style="text-align:left;padding:4px 10px;border-bottom:2px solid #ccc">Team</th>` +
      `<th style="text-align:left;padding:4px 10px;border-bottom:2px solid #ccc">Head coach</th>` +
      `<th style="text-align:left;padding:4px 10px;border-bottom:2px solid #ccc">Last post</th>` +
      `</tr></thead><tbody>${rows}</tbody></table>` +
      `<p style="color:#888;font-size:12px">Coach-direct reminders are ${remindCoaches ? "ON" : "OFF"}.` +
      (remindCoaches ? "" : " Set SPORTSYOU_REMIND_COACHES=true in Vercel to email coaches automatically.") + `</p></div>`
    : `<div style="font-family:sans-serif;font-size:14px"><p>✅ All teams have posted to SportsYou within the last ${silentDays} days. Nothing to nudge.</p></div>`;

  try {
    if (digestTo && EMAIL_RE.test(extractAddress(digestTo))) {
      await resendSend(RESEND_API_KEY, [{
        from: DSE_FROM_EMAIL, to: [digestTo], reply_to: replyTo,
        subject: `SportsYou check: ${silent.length} team${silent.length === 1 ? "" : "s"} quiet`,
        html: digestHtml,
        text: silent.map(s => `${s.team} — ${s.coach} — ${s.days == null ? "never posted" : s.days + "d ago"}`).join("\n") || "All teams active.",
      }]);
    }
  } catch (err) { console.error("Digest send failed:", err.message); }

  return res.status(200).json({
    ok: true, silentDays, silentCount: silent.length,
    coachRemindersSent: coachEmailsSent.length, remindCoaches,
    teams: silent.map(s => ({ team: s.team, days: s.days, coachEmail: !!s.coachEmail })),
  });
}
