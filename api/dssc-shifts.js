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
import { appOrigin } from "../shared/app-origin.js";
import webpush from "web-push";
import crypto from "node:crypto";
import { resendKeyFor } from "./_lib/resend-key.js";

// Same signing scheme as dssc-approve.js, so the digest's buttons are the same
// one-tap links as the instant notification. A digest that only says "go and
// look" is the thing that leaves pickups sitting for days.
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const signLink = (obj, secret) => { const p = b64url(JSON.stringify(obj)); return p + "." + b64url(crypto.createHmac("sha256", secret).update(p).digest()); };

const APPROVERS_DEFAULT = ["hunterhaleysc10@gmail.com", "hunter@drippingsportsclub.com", "drew@dselitevolleyball.com"];
// Monday approvals by sport (Drew, 13 Oct 2026): Hunter volleyball, Adrian basketball;
// staff hours by department further down.
const BB_APPROVERS_DEFAULT = ["adrian@drippingsportsclub.com", "drew@dselitevolleyball.com"];
const DSSC_APP = "https://www.drippingsportsclub.com/hq";
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
  const origin = appOrigin(req);

  const [{ data: clinics }, { data: rosterDse }, { data: avail }, { data: checks }, { data: dsscPeople }] = await Promise.all([
    supabase.from("dssc_clinics").select("id, name, location, start_time, end_time, coaches_needed, sessions, sport"),
    supabase.from("coach_roster").select("first_name, last_name, email"),
    supabase.from("dssc_availability").select("coach_name, coach_email"),
    supabase.from("dssc_checkins").select("id, coach_name, clinic_id, session_id, session_date, hours, approved, rejected").gte("session_date", addDays(today, -14)),
    supabase.from("dssc_people").select("first_name, last_name, email").eq("active", true),
  ]);
  const roster = [...(rosterDse || []), ...(dsscPeople || [])];   // DSSC-only coaches (basketball) too

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
  // DSSC messages come from the club, never "DS Elite" (Drew, 13 Oct 2026).
  const FROM = process.env.DSSC_FROM_EMAIL || ("Dripping Springs Sports Club <" + ((DSE_FROM_EMAIL || "").match(/<([^>]+)>/)?.[1] || DSE_FROM_EMAIL) + ">");
  const mail = async (to, subject, text, html) => {
    if (!RESEND_API_KEY || !DSE_FROM_EMAIL || !to.length) return;
    await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${resendKeyFor(FROM)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, text, html }),
    }).catch(() => {});
  };

  // 1 — tomorrow's sessions
  let reminded = 0;
  for (const [coach, list] of Object.entries(remind)) {
    const em = emailFor(coach); if (!em) continue;
    const lines = list.map(x => `• ${x.clinic} — ${fmtD(x.date)} at ${x.start}${x.court ? " (" + x.court + ")" : ""}`);
    await push([em], "DSSC clinic tomorrow", `${list.length} session${list.length === 1 ? "" : "s"}. Tap for details.`, DSSC_APP + "/?view=dssctime");
    await mail([em], `DSSC clinic tomorrow — ${list.length} session${list.length === 1 ? "" : "s"}`,
      `You're coaching tomorrow:\n${lines.join("\n")}\n\nClock in from DSSC HQ (www.drippingsportsclub.com/hq) when you get there.`,
      `<div style="font-family:sans-serif;font-size:14px"><p>You're coaching tomorrow:</p><ul>${list.map(x => `<li>${esc(x.clinic)} — ${fmtD(x.date)} at ${esc(x.start)}${x.court ? " (" + esc(x.court) + ")" : ""}</li>`).join("")}</ul><p><a href="${DSSC_APP}/?view=dssctime" style="color:#0F8B76;font-weight:700">Clock in in DSSC HQ →</a></p></div>`);
    reminded++;
  }

  // 1b — forgot to clock in yesterday
  let nudged = 0;
  for (const [coach, list] of Object.entries(clockIn)) {
    const em = emailFor(coach); if (!em) continue;
    await push([em], "Clock in for yesterday's clinic", `${list.length} DSSC session${list.length === 1 ? "" : "s"} not logged. Tap to fix.`, DSSC_APP + "/?view=dssctime");
    await mail([em], "You haven't logged yesterday's DSSC hours",
      `These sessions have no clock-in yet:\n${list.map(x => `• ${x.clinic} — ${fmtD(x.date)}`).join("\n")}\n\nLog them in DSSC HQ (www.drippingsportsclub.com/hq) so they make this week's pay run.`);
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
    await push(approvers, "DSSC pickups need approval", `${pending.length} coach${pending.length === 1 ? "" : "es"} waiting. Tap to review.`, DSSC_APP + "/?view=dssccal");
    await mail(approvers, `${pending.length} DSSC shift pickup${pending.length === 1 ? "" : "s"} waiting on you`,
      `Coaches asked to pick these up and are waiting:\n${lines.join("\n")}\n\nApprove or decline in DSSC HQ → Coverage Calendar.`,
      `<div style="font-family:sans-serif;font-size:14px"><p><b>${pending.length}</b> shift pickup${pending.length === 1 ? "" : "s"} waiting on approval:</p><ul>${pending.map(p => `<li style="margin-bottom:10px"><b>${esc(p.coach)}</b> → ${esc(p.clinic)}, ${fmtD(p.date)} at ${esc(p.start)} <i>(as ${esc(p.role)})</i><br><a href="${link(p,'approve')}" style="display:inline-block;background:#22c55e;color:#06210f;font-weight:800;padding:7px 16px;border-radius:7px;text-decoration:none;margin-top:5px">Approve</a> <a href="${link(p,'decline')}" style="display:inline-block;border:1px solid #ef4444;color:#ef4444;font-weight:700;padding:6px 13px;border-radius:7px;text-decoration:none;margin-top:5px">Decline</a></li>`).join("")}</ul><p><a href="${DSSC_APP}/?view=dssccal" style="color:#0F8B76;font-weight:700">Review in DSSC HQ →</a></p></div>`);
  }

  // 3 — Monday: last week's hours still unapproved, each to whoever approves
  // them: volleyball -> Hunter, basketball -> Adrian, staff (interns) -> Adrian.
  const listFrom = (env, dflt) => (env ? env.split(",") : dflt).map(s => s.trim().toLowerCase()).filter(Boolean);
  const sportOf = (c) => ((clinics || []).find(x => x.id === c.clinic_id)?.sport || "volleyball");
  const askApproval = async (to, rows, what, view, hoursOf) => {
    if (!rows.length || !to.length) return;
    const hrs = Math.round(rows.reduce((s, c) => s + hoursOf(c), 0) * 100) / 100;
    const byWho = {};
    for (const c of rows) byWho[c.who] = (byWho[c.who] || 0) + hoursOf(c);
    const lines = Object.entries(byWho).sort().map(([k, v]) => `• ${k} — ${Math.round(v * 100) / 100}h`);
    await push(to, `Approve last week's ${what} hours`, `${hrs}h from ${Object.keys(byWho).length} ${Object.keys(byWho).length === 1 ? "person" : "people"}. Tap to approve.`, DSSC_APP + "/?view=" + view);
    await mail(to, `Approve last week's ${what} hours — ${hrs}h`,
      `${hrs}h of ${what} hours logged ${fmtD(lastMon)} – ${fmtD(lastSun)} are waiting on your approval:\n${lines.join("\n")}\n\nNothing goes to the accountant until you approve it. ${DSSC_APP}/?view=${view}`,
      `<div style="font-family:sans-serif;font-size:14px"><p><b>${hrs}h</b> of ${esc(what)} hours logged ${fmtD(lastMon)} – ${fmtD(lastSun)} are waiting on your approval:</p><ul>${lines.map(l => `<li>${esc(l.replace(/^• /, ""))}</li>`).join("")}</ul><p>Nothing goes to the accountant until you approve it.</p><p><a href="${DSSC_APP}/?view=${view}" style="color:#0F8B76;font-weight:700">Approve in DSSC HQ →</a></p></div>`);
  };
  const classHours = (c) => Number(c.hours || 0);
  if (unapproved.length) {
    const rows = unapproved.map(c => ({ ...c, who: c.coach_name }));
    await askApproval(approvers, rows.filter(c => sportOf(c) === "volleyball"), "DSSC volleyball", "dssctime", classHours);
    await askApproval(listFrom(process.env.DSSC_BB_APPROVER_EMAILS, BB_APPROVERS_DEFAULT), rows.filter(c => sportOf(c) === "basketball"), "DSSC basketball", "dssctime", classHours);
  }
  let staffWaiting = 0;
  if (isMonday) {
    const { data: shifts } = await supabase.from("dssc_staff_shifts").select("person_name, person_email, clock_in, clock_out, approved, rejected, department")
      .gte("clock_in", lastMon + "T05:00:00Z").lt("clock_in", today + "T05:00:00Z").eq("approved", false).eq("rejected", false).not("clock_out", "is", null);
    const rows = (shifts || []).map(s => ({ ...s, who: s.person_name || s.person_email }));
    staffWaiting = rows.length;
    // Each department's staff hours go to its lead (Drew, 14 Oct 2026).
    const STAFF_BY_DEPT = {
      volleyball: listFrom(process.env.DSSC_STAFF_VB_APPROVERS, ["hunter@drippingsportsclub.com"]),
      basketball: listFrom(process.env.DSSC_STAFF_BB_APPROVERS, ["adrian@drippingsportsclub.com"]),
      reach: listFrom(process.env.DSSC_STAFF_REACH_APPROVERS, ["brandon@drippingsportsclub.com"]),
      operations: listFrom(process.env.DSSC_STAFF_APPROVER_EMAILS, ["jonathan@drippingsportsclub.com", "deroald@drippingsportsclub.com", "drew@dselitevolleyball.com"]),
    };
    for (const [dept, to] of Object.entries(STAFF_BY_DEPT)) {
      await askApproval(to, rows.filter(s => (s.department || "operations") === dept), "DSSC " + dept + " staff", "staffadmin",
        (s) => Math.round(((new Date(s.clock_out) - new Date(s.clock_in)) / 3600000) * 4) / 4);
    }
  }

  return res.status(200).json({ ok: true, reminded, nudged, pending: pending.length, unapproved: unapproved.length, staffWaiting });
}
