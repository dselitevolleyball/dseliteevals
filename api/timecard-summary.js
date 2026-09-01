// Vercel Cron: tell each coach what hours went through for them last week.
//
// Runs Monday, after the payroll report has gone to the bookkeeper, and covers
// the Monday–Sunday week just finished. One email per coach, with both clubs in
// it, because a coach who works DS Elite practices and DSSC clinics is one
// person with one week and should not have to reconcile two emails.
//
// WHAT "APPROVED" MEANS, WHICH DIFFERS BY CLUB
//
//   DSSC has a real approval step — dssc_checkins.approved, set by whoever
//   reviews the week — so only approved shifts are reported, and rejected ones
//   are never mentioned.
//
//   DS Elite has no approval flag. Hours are logged, the Monday payroll report
//   sends the week to the bookkeeper, and that IS the approval. So this reports
//   the shifts that went into that run. If DS Elite ever grows a real approval
//   gate, this is the one place that has to change.
//
// HOURS, NOT MONEY
//
// The email says how many hours, on which days, doing what — and deliberately
// not what it pays. DS Elite pay is resolvable here (shared/coach-pay.js), but
// DSSC pay depends on pod tiers and per-session attendance that only exist in
// the app, and attendance is sometimes entered after the fact. A confirmation
// carrying a number that later moves is worse than one that carries none, and
// half an email with money and half without reads like a bug.
//
// Every shift is stamped when reported, so running twice does not email twice,
// and a shift logged late still gets reported the following week.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; also ?token=.
// Query: ?dry=1 to see who would be emailed without sending.
//        ?week=YYYY-MM-DD to re-run a specific week (any date inside it).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//      RESEND_API_KEY (or resend_api_key), DSE_FROM_EMAIL, DSE_REPLY_TO (opt).

import { createClient } from "@supabase/supabase-js";
import { makeRateResolver, makeNameResolver, lastPayWeek, norm } from "../shared/coach-pay.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtDay = (iso) => {
  try { return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); }
  catch { return iso; }
};
const hrs = (n) => {
  const v = Math.round(Number(n || 0) * 100) / 100;
  return (Number.isInteger(v) ? v : v.toFixed(2).replace(/0$/, "")) + "h";
};

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, DSE_FROM_EMAIL, DSE_REPLY_TO } = process.env;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;

  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const urlToken = url?.searchParams.get("token") || "";
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (bearer !== CRON_SECRET && urlToken !== CRON_SECRET)) return res.status(403).json({ error: "Forbidden" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });

  const dry = url?.searchParams.get("dry") === "1";
  if (!dry && (!RESEND_API_KEY || !DSE_FROM_EMAIL)) return res.status(500).json({ error: "Email not configured" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const today = url?.searchParams.get("week")
    || new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const { start, end } = lastPayWeek(today);

  const [{ data: dse }, { data: dssc }, { data: roster }, { data: accounts }, { data: rates }, { data: teams }] =
    await Promise.all([
      supabase.from("coach_checkins")
        .select("id, coach_name, coach_email, check_date, team_name, slot, hours, role, rate_override, notified_at")
        .gte("check_date", start).lte("check_date", end),
      supabase.from("dssc_checkins")
        .select("id, coach_name, coach_email, session_date, clinic_name, hours, approved, rejected, sent_at")
        .gte("session_date", start).lte("session_date", end),
      supabase.from("coach_roster").select("first_name, last_name, email"),
      supabase.from("coaches").select("display_name, email"),
      supabase.from("coach_rates").select("coach_name, hourly_rate, head_rate"),
      supabase.from("practice_teams").select("team_name, head_coach"),
    ]);

  // Rate resolver is built even though the email carries no money: it is what
  // tells us a coach has NO rate on file, which is worth surfacing to Drew in
  // the response even when the coach never sees it.
  const rateFor = makeRateResolver({ rates: rates || [], teams: teams || [] });

  // Address book. A coach may be on the roster, have an app account, or only
  // have whatever address was stamped on the check-in.
  const emailFor = new Map();
  const put = (name, email) => {
    const k = norm(name), e = String(email || "").trim().toLowerCase();
    if (!k || !EMAIL_RE.test(e) || emailFor.has(k)) return;
    emailFor.set(k, e);
  };
  (accounts || []).forEach(a => put(a.display_name, a.email));
  (roster || []).forEach(r => put(`${r.first_name || ""} ${r.last_name || ""}`, r.email));
  (dse || []).forEach(c => put(c.coach_name, c.coach_email));
  (dssc || []).forEach(c => put(c.coach_name, c.coach_email));

  // DSSC: only approved shifts are anybody's business. A rejected one is a
  // conversation the reviewer has already had, not news to re-break by email.
  const dsscOk = (dssc || []).filter(c => c.approved && !c.rejected);

  // Names on a check-in are whatever the entry point wrote. Resolved to the
  // real person before grouping, so one coach is one email and the greeting
  // is a name she recognises rather than her own email prefix.
  const canonicalName = makeNameResolver({ roster: roster || [], teams: teams || [], rates: rates || [] });

  const byCoach = new Map();
  const grab = (name) => {
    const k = norm(name);
    if (!k) return null;
    if (!byCoach.has(k)) byCoach.set(k, { name: String(name).trim(), dse: [], dssc: [] });
    return byCoach.get(k);
  };
  (dse || []).forEach(c => { const g = grab(canonicalName(c.coach_name, c.coach_email)); if (g) g.dse.push(c); });
  dsscOk.forEach(c => { const g = grab(canonicalName(c.coach_name, c.coach_email)); if (g) g.dssc.push(c); });

  const results = [];
  for (const g of byCoach.values()) {
    const fresh = g.dse.some(c => !c.notified_at) || g.dssc.some(c => !c.sent_at);
    const dseH = g.dse.reduce((n, c) => n + Number(c.hours || 0), 0);
    const dsscH = g.dssc.reduce((n, c) => n + Number(c.hours || 0), 0);
    const total = dseH + dsscH;
    const to = emailFor.get(norm(g.name));
    const noRate = g.dse.length > 0 && g.dse.every(c => rateFor(g.name, c.team_name, c.rate_override) == null);
    results.push({ ...g, dseH, dsscH, total, to, fresh, noRate });
  }
  // Nothing new to say, no email. A coach who worked nothing hears nothing
  // either — silence is the correct message for a week off.
  const sendable = results.filter(r => r.total > 0 && r.fresh && r.to);
  const unreachable = results.filter(r => r.total > 0 && r.fresh && !r.to).map(r => r.name);

  if (dry) {
    return res.status(200).json({
      ok: true, dry: true, week: { start, end },
      would_email: sendable.map(r => ({ coach: r.name, to: r.to, dse_hours: r.dseH, dssc_hours: r.dsscH })),
      unreachable,
      no_rate_on_file: results.filter(r => r.noRate).map(r => r.name),
    });
  }

  const replyTo = (DSE_REPLY_TO || String(DSE_FROM_EMAIL).match(/<([^>]+)>/)?.[1] || DSE_FROM_EMAIL || "").trim();
  let sent = 0, failed = 0;
  const dseDone = [], dsscDone = [];

  for (const r of sendable) {
    const first = r.name.split(/\s+/)[0];
    const dseRows = r.dse.slice().sort((a, b) => String(a.check_date).localeCompare(String(b.check_date)));
    const dsscRows = r.dssc.slice().sort((a, b) => String(a.session_date).localeCompare(String(b.session_date)));

    const dseText = dseRows.map(c =>
      `  ${fmtDay(c.check_date)}  ${hrs(c.hours)}  ${[c.team_name, c.slot].filter(Boolean).join(" ")}` +
      `${c.role && c.role !== "scheduled" ? " (" + c.role + ")" : ""}`).join("\n");
    const dsscText = dsscRows.map(c =>
      `  ${fmtDay(c.session_date)}  ${hrs(c.hours)}  ${c.clinic_name || "DSSC clinic"}`).join("\n");

    const text = `Hi ${first},

Your hours for ${fmtDay(start)} to ${fmtDay(end)} have been approved and sent to payroll.

${dseRows.length ? `DS ELITE — ${hrs(r.dseH)}\n${dseText}\n\n` : ""}${dsclLabel(dsscRows.length, r.dsscH)}${dsscRows.length ? dsscText + "\n\n" : ""}TOTAL: ${hrs(r.total)}

If anything above is wrong or missing, reply to this email this week — it is much easier to fix before payment than after.

Thanks for the work.

Drew Rose
DS Elite Volleyball`;

    const row = (a, b, c) =>
      `<tr><td style="padding:5px 12px 5px 0;white-space:nowrap;color:#666">${esc(a)}</td>` +
      `<td style="padding:5px 12px 5px 0;white-space:nowrap;font-weight:700">${esc(b)}</td>` +
      `<td style="padding:5px 0">${esc(c)}</td></tr>`;
    const section = (title, rows, total) => rows.length ? (
      `<p style="margin:22px 0 6px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">` +
      `${esc(title)} — ${esc(hrs(total))}</p>` +
      `<table style="border-collapse:collapse;font-size:14px">${rows.join("")}</table>`) : "";

    const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:560px">'
      + `<p style="margin:0 0 14px">Hi ${esc(first)},</p>`
      + `<p style="margin:0 0 14px">Your hours for <b>${esc(fmtDay(start))} to ${esc(fmtDay(end))}</b> have been approved and sent to payroll.</p>`
      + section("DS Elite", dseRows.map(c => row(fmtDay(c.check_date), hrs(c.hours),
          [c.team_name, c.slot].filter(Boolean).join(" ") + (c.role && c.role !== "scheduled" ? " (" + c.role + ")" : ""))), r.dseH)
      + section("DSSC", dsscRows.map(c => row(fmtDay(c.session_date), hrs(c.hours), c.clinic_name || "DSSC clinic")), r.dsscH)
      + `<p style="margin:20px 0 14px;font-size:17px"><b>Total: ${esc(hrs(r.total))}</b></p>`
      + `<p style="margin:0 0 14px">If anything above is wrong or missing, reply to this email this week — it&rsquo;s much easier to fix before payment than after.</p>`
      + `<p style="margin:0 0 14px">Thanks for the work.</p>`
      + '<p style="margin:0">Drew Rose<br>DS Elite Volleyball</p></div>';

    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: DSE_FROM_EMAIL, to: [r.to], reply_to: replyTo,
          subject: `Your hours: ${fmtDay(start)} – ${fmtDay(end)} (${hrs(r.total)})`,
          text, html,
        }),
      });
      if (!resp.ok) throw new Error("Resend " + resp.status);
      sent++;
      dseRows.forEach(c => dseDone.push(c.id));
      dsscRows.forEach(c => dsscDone.push(c.id));
    } catch (e) {
      failed++;
      console.error("Timecard summary failed for " + r.name + ": " + e.message);
    }
  }

  // Stamped only for the coaches actually emailed, so a failure is retried next
  // run rather than silently counted as told.
  const now = new Date().toISOString();
  if (dseDone.length) await supabase.from("coach_checkins").update({ notified_at: now }).in("id", dseDone);
  if (dsscDone.length) await supabase.from("dssc_checkins").update({ sent_at: now }).in("id", dsscDone);

  return res.status(200).json({
    ok: true, week: { start, end }, sent, failed,
    shifts_marked: { ds_elite: dseDone.length, dssc: dsscDone.length },
    unreachable,
  });
}

// Kept out of the template so the DSSC heading reads the same in text and HTML.
function dsclLabel(count, hours) {
  return count ? `DSSC — ${hrs(hours)}\n` : "";
}
