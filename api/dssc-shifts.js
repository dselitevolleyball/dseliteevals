// Vercel Cron: keep DSSC clinic staffing moving without anyone chasing it.
//
// Three jobs, every morning:
//   1. Coaches get a reminder the day before a session they're approved on —
//      and a nudge to clock in for yesterday's if they forgot.
//   2. Hunter gets any shift pickups still waiting on his approval. An
//      unapproved pickup nobody looks at is the same as an unstaffed session.
//   3. Mondays only: hours logged last week that haven't been approved, so the
//      accountant run isn't the thing that discovers them.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; also ?token=.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (opt), APP_URL (opt),
//      RESEND_API_KEY (or resend_api_key), DSE_FROM_EMAIL,
//      DSSC_PLANNER_EMAILS (opt comma list — who approves).

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import crypto from "node:crypto";

// Same signing scheme as dssc-approve.js, so the digest's buttons are the same
// one-tap links as the instant notification. A digest that only says "go and
// look" is the thing that leaves pickups sitting for days.
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const signLink = (obj, secret) => { const p = b64url(JSON.stringify(obj)); return p + "." + b64url(crypto.createHmac("sha256", secret).update(p).digest()); };

const APPROVERS_DEFAULT = ["hunterhaleysc10@gmail.com", "hunter@drippingsportsclub.com", "drew@dselitevolleyball.com"];
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmtD = (iso) => { try { return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); } catch { return iso; } };
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const nrm = (s) => String(s || "").trim().toLowerCase();

// Mirrors sessionStaff() in the app: sessions written before staffing existed
// carry only coach_name, and that person is the approved lead.
const staffOf = (s) => {
  if (Array.isArray(s?.staff)) return s.staff;
  const nm = String(s?.coach_name || "").trim();
  return nm ? [{ name: nm, role: "lead", status: "approved" }] : [];
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
  const tomorrow = addDays(today, 1), yesterday = addDays(today, -1);
  const origin = APP_URL || ("https://" + (req.headers["x-forwarded-host"] || req.headers.host));

  const [{ data: clinics }, { data: roster }, { data: avail }, { data: checks }] = await Promise.all([
    supabase.from("dssc_clinics").select("id, name, location, start_time, end_time, coaches_needed, sessions"),
    supabase.from("coach_roster").select("first_name, last_name, email"),
    supabase.from("dssc_availability").select("coach_name, coach_email"),
    supabase.from("dssc_checkins").select("id, coach_name, session_id, session_date, hours, approved, rejected").gte("session_date", addDays(today, -14)),
  ]);

  const emailFor = (nm) => {
    const a = (avail || []).find(x => x.coach_email && nrm(x.coach_name) === nrm(nm));
    if (a) return a.coach_email;
    const r = (roster || []).find(x => x.email && nrm(`${x.first_name || ""} ${x.last_name || ""}`.trim()) === nrm(nm));
    return r?.email || null;
  };

  // Walk every session once and bucket what needs saying.
  const remind = {};   // coach -> [{clinic, date, start, court}]  session tomorrow
  const clockIn = {};  // coach -> [{clinic, date}]                 yesterday, no check-in
  const pending = [];  // pickups waiting on approval
  const clocked = new Set((checks || []).map(c => nrm(c.coach_name) + "|" + c.session_id));

  for (const c of (clinics || [])) {
    for (const s of (Array.isArray(c.sessions) ? c.sessions : [])) {
      const date = s?.date && String(s.date).slice(0, 10);
      if (!date) continue;
      const start = s.start_time || c.start_time, court = s.court || c.location;
      for (const v of staffOf(s)) {
        if (v.status === "declined" || !v.name) continue;
        if (v.status === "pending") {
          pending.push({ coach: v.name, clinic: c.name, date, start, role: v.role || "assist", clinicId: c.id, sessionId: s.id });
          continue;
        }
        if (date === tomorrow) (remind[v.name] = remind[v.name] || []).push({ clinic: c.name, date, start, court });
        else if (date === yesterday && !clocked.has(nrm(v.name) + "|" + s.id)) {
          (clockIn[v.name] = clockIn[v.name] || []).push({ clinic: c.name, date });
        }
      }
    }
  }

  // Monday: last week's hours that Hunter hasn't ruled on yet.
  const isMonday = new Date(today + "T12:00:00Z").getUTCDay() === 1;
  const lastMon = addDays(today, -7), lastSun = addDays(today, -1);
  const unapproved = isMonday
    ? (checks || []).filter(c => c.session_date >= lastMon && c.session_date <= lastSun && !c.approved && !c.rejected)
    : [];

  const approvers = (DSSC_PLANNER_EMAILS ? DSSC_PLANNER_EMAILS.split(",") : APPROVERS_DEFAULT).map(s => s.trim().toLowerCase()).filter(Boolean);
  let subs = [];
  const canPush = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
  if (canPush) {
    webpush.setVapidDetails(VAPID_SUBJECT || "mailto:drew@dselitevolleyball.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    subs = (await supabase.from("push_subscriptions").select("endpoint, p256dh, auth, email")).data || [];
  }
  const push = async (emails, title, body, url) => {
    if (!canPush) return;
    const want = emails.map(nrm);
    const mine = subs.filter(s => want.includes(nrm(s.email)));
    const payload = JSON.stringify({ title, body, url });
    await Promise.all(mine.map(s => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload).catch(() => {})));
  };
  const mail = async (to, subject, text, html) => {
    if (!RESEND_API_KEY || !DSE_FROM_EMAIL || !to.length) return;
    await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: DSE_FROM_EMAIL, to, subject, text, html }),
    }).catch(() => {});
  };

  // 1 — tomorrow's sessions
  let reminded = 0;
  for (const [coach, list] of Object.entries(remind)) {
    const em = emailFor(coach); if (!em) continue;
    const lines = list.map(x => `• ${x.clinic} — ${fmtD(x.date)} at ${x.start}${x.court ? " (" + x.court + ")" : ""}`);
    await push([em], "DSSC clinic tomorrow", `${list.length} session${list.length === 1 ? "" : "s"}. Tap for details.`, origin + "/?view=dssctime");
    await mail([em], `DSSC clinic tomorrow — ${list.length} session${list.length === 1 ? "" : "s"}`,
      `You're coaching tomorrow:\n${lines.join("\n")}\n\nClock in from DS Elite HQ → DSSC Hours when you get there.`,
      `<div style="font-family:sans-serif;font-size:14px"><p>You're coaching tomorrow:</p><ul>${list.map(x => `<li>${esc(x.clinic)} — ${fmtD(x.date)} at ${esc(x.start)}${x.court ? " (" + esc(x.court) + ")" : ""}</li>`).join("")}</ul><p><a href="${origin}/?view=dssctime" style="color:#e91e8c;font-weight:700">Clock in in DS Elite HQ →</a></p></div>`);
    reminded++;
  }

  // 1b — forgot to clock in yesterday
  let nudged = 0;
  for (const [coach, list] of Object.entries(clockIn)) {
    const em = emailFor(coach); if (!em) continue;
    await push([em], "Clock in for yesterday's clinic", `${list.length} DSSC session${list.length === 1 ? "" : "s"} not logged. Tap to fix.`, origin + "/?view=dssctime");
    await mail([em], "You haven't logged yesterday's DSSC hours",
      `These sessions have no clock-in yet:\n${list.map(x => `• ${x.clinic} — ${fmtD(x.date)}`).join("\n")}\n\nLog them in DS Elite HQ → DSSC Hours so they make this week's pay run.`);
    nudged++;
  }

  // 2 — pickups awaiting approval
  if (pending.length) {
    const TTL = 30 * 24 * 3600 * 1000;
    const link = (p, a) => origin + "/api/dssc-approve?token=" +
      encodeURIComponent(signLink({ c: p.clinicId, s: p.sessionId, n: p.coach, a, exp: Date.now() + TTL }, SUPABASE_SERVICE_ROLE_KEY));
    const lines = pending.map(p => `• ${p.coach} → ${p.clinic}, ${fmtD(p.date)} at ${p.start} (as ${p.role})
    Approve: ${link(p,"approve")}
    Decline: ${link(p,"decline")}`);
    await push(approvers, "DSSC pickups need approval", `${pending.length} coach${pending.length === 1 ? "" : "es"} waiting. Tap to review.`, origin + "/?view=dssccal");
    await mail(approvers, `${pending.length} DSSC shift pickup${pending.length === 1 ? "" : "s"} waiting on you`,
      `Coaches asked to pick these up and are waiting:\n${lines.join("\n")}\n\nApprove or decline in DS Elite HQ → DSSC Coaches.`,
      `<div style="font-family:sans-serif;font-size:14px"><p><b>${pending.length}</b> shift pickup${pending.length === 1 ? "" : "s"} waiting on approval:</p><ul>${pending.map(p => `<li style="margin-bottom:10px"><b>${esc(p.coach)}</b> → ${esc(p.clinic)}, ${fmtD(p.date)} at ${esc(p.start)} <i>(as ${esc(p.role)})</i><br><a href="${link(p,'approve')}" style="display:inline-block;background:#22c55e;color:#06210f;font-weight:800;padding:7px 16px;border-radius:7px;text-decoration:none;margin-top:5px">Approve</a> <a href="${link(p,'decline')}" style="display:inline-block;border:1px solid #ef4444;color:#ef4444;font-weight:700;padding:6px 13px;border-radius:7px;text-decoration:none;margin-top:5px">Decline</a></li>`).join("")}</ul><p><a href="${origin}/?view=dssccal" style="color:#e91e8c;font-weight:700">Review in DS Elite HQ →</a></p></div>`);
  }

  // 3 — Monday: last week's hours still unapproved
  if (unapproved.length) {
    const hrs = unapproved.reduce((s, c) => s + Number(c.hours || 0), 0);
    const byCoach = {};
    for (const c of unapproved) byCoach[c.coach_name] = (byCoach[c.coach_name] || 0) + Number(c.hours || 0);
    const lines = Object.entries(byCoach).sort().map(([k, v]) => `• ${k} — ${v}h`);
    await push(approvers, "Approve last week's DSSC hours", `${hrs}h from ${Object.keys(byCoach).length} coach${Object.keys(byCoach).length === 1 ? "" : "es"}. Tap to approve.`, origin + "/?view=dssctime");
    await mail(approvers, `Approve last week's DSSC hours — ${hrs}h`,
      `${hrs}h logged ${fmtD(lastMon)} – ${fmtD(lastSun)} are waiting on your approval:\n${lines.join("\n")}\n\nNothing goes to the accountant until you approve it. DS Elite HQ → DSSC Hours.`,
      `<div style="font-family:sans-serif;font-size:14px"><p><b>${hrs}h</b> logged ${fmtD(lastMon)} – ${fmtD(lastSun)} are waiting on your approval:</p><ul>${lines.map(l => `<li>${esc(l.replace(/^• /, ""))}</li>`).join("")}</ul><p>Nothing goes to the accountant until you approve it.</p><p><a href="${origin}/?view=dssctime" style="color:#e91e8c;font-weight:700">Approve in DS Elite HQ →</a></p></div>`);
  }

  return res.status(200).json({ ok: true, reminded, nudged, pending: pending.length, unapproved: unapproved.length });
}
