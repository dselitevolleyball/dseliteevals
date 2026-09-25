// Coaches' companion to the Sunday-practices email: what Drew expects from
// these fall sessions and how they differ from in-season practice, plus a
// heads-up that the attendance message is going to every player and family.
//
// Audience: every coach on a real, non-Rise team (head, assistant, third),
// resolved to an email through the coaches table and the coach roster the
// same way the claims announcement did it. Rise and event teams (14 Crystal)
// have no Sunday practices, so their coaches are left off. Kristen is copied
// as assistant director.
//
// Attaches the Core Philosophy PDF and the letter for school coaches.
//
// DRY RUN BY DEFAULT.
//
// Usage:
//   node scripts/send-sunday-practices-coaches.mjs                 # dry run
//   node scripts/send-sunday-practices-coaches.mjs --test [email]  # one copy to Drew
//   node scripts/send-sunday-practices-coaches.mjs --send
//   node scripts/send-sunday-practices-coaches.mjs --send --at 2026-09-26T08:00:00-05:00
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isEventTeam } from "../shared/event-teams.js";

const APP_URL = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const KRISTEN = { name: "Kristen", email: "kristen@dselitevolleyball.com" };
const isRise = (t) => /\brise\b/i.test(String(t || ""));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEHOLDER = /^(tbd|tba|n\/a|na|none|pending|sub|open|needed|\?+|-+|—)$/i;
const isPlaceholder = (c) => { const s = String(c || "").trim(); return !s || PLACEHOLDER.test(s) || /new coach|floater coach|assistant coach$/i.test(s); };
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

function loadEnv() {
  const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const opt = (n) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null; };
const doSend = flag("send");
const testTo = flag("test") ? (opt("test") || SENDER.email) : null;
const scheduledAt = opt("at");

const DESK = join(homedir(), "OneDrive", "Desktop", "DS Elite");
const files = [
  { filename: "DS Elite Core Philosophy.pdf", path: join(DESK, "DS Elite- Core Philosophy_ Game-Like Training with High Efficiency.pdf") },
  { filename: "DS Elite letter for school coaches.pdf", path: opt("pdf") || join(homedir(), "Downloads", "DS_Elite_Coach_Letter.pdf") },
];
const attachments = files.map(f => ({ filename: f.filename, content: readFileSync(f.path).toString("base64"), contentType: "application/pdf" }));

const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [{ data: teams, error: tErr }, { data: roster }, { data: accounts }] = await Promise.all([
  sb.from("practice_teams").select("team_name, practices_per_week, head_coach, assistant_coach, third_coach"),
  sb.from("coach_roster").select("first_name, last_name, email"),
  sb.from("coaches").select("display_name, email"),
]);
if (tErr) { console.error("Load failed:", tErr.message); process.exit(1); }

const emailFor = new Map();
const put = (n, e) => { const k = norm(n), v = String(e || "").trim().toLowerCase(); if (k && EMAIL_RE.test(v) && !emailFor.has(k)) emailFor.set(k, v); };
(accounts || []).forEach(a => put(a.display_name, a.email));
(roster || []).forEach(r => put(`${r.first_name || ""} ${r.last_name || ""}`, r.email));

// coach → the teams they coach (real teams only)
const coaches = new Map();
for (const t of (teams || []).filter(t => !isRise(t.team_name) && !isEventTeam(t))) {
  for (const n of [t.head_coach, t.assistant_coach, t.third_coach]) {
    if (isPlaceholder(n)) continue;
    const k = norm(n);
    if (!coaches.has(k)) coaches.set(k, { name: String(n).trim(), teams: [] });
    coaches.get(k).teams.push(t.team_name);
  }
}
// One email per address: the same coach is spelled two ways across teams
// ("Kelli Hardge" / "Kelli R Hardge"), and Drew doesn't need his own copy.
const byEmail = new Map(), noEmail = [];
for (const c of coaches.values()) {
  const email = emailFor.get(norm(c.name));
  if (!email) { noEmail.push(c); continue; }
  if (email === SENDER.email) continue;
  const j = byEmail.get(email);
  if (j) j.teams.push(...c.teams); else byEmail.set(email, { ...c, email });
}
const jobs = [...byEmail.values()].sort((a, b) => a.name.localeCompare(b.name));
// Kristen is copied as assistant director unless she's already on the list as a coach.
const ccKristen = !jobs.some(j => /^kristen\b/i.test(j.name));

// ── The message ─────────────────────────────────────────────────────────────
const SUBJECT = "Sunday practices: what I'm asking of you this fall";
const teamList = (ts) => ts.length === 1 ? ts[0] : ts.slice(0, -1).join(", ") + " and " + ts[ts.length - 1];

const textFor = (c) => `Hi ${c.name.split(/\s+/)[0]},

Thanks for giving up your Sundays this fall. I want to be clear about what these practices are for, because they are not in-season practices and I don't want them run like one.

WHAT THESE PRACTICES ARE

The job between now and Thanksgiving is two things: build a real relationship with your players and with each other, and put in focused work on fundamentals. A team that does both arrives at the season and at our first tournaments with a head start. That's it. We are not installing a full system in September.

HOW THEY DIFFER FROM IN-SEASON

  • Intensity. Most of these girls are in the middle of a school season and playing more volleyball right now than at any point in the year. Bring the tempo — players moving, minimal balls on the floor, quick resets — but not the volume. They should leave better prepared for their school court, not more worn down for it. That is the promise I've made to their school coaches.
  • Reps. Fundamentals over everything. High touch counts on the basics, game-like from the first rep. This is where we get the reps in that we won't have time for in January.
  • Systems. Keep it simple. Basic serve receive and defensive shape are fine because they're fundamentals. Save the full offense, tempo attacks and match-specific systems for when the school season is over and we have the whole team every week.

WHAT I WANT THEM WORKING ON

How we play at DS Elite starts with first contact and serving, and these Sundays are the time to build it:

  • Serving — 15 to 25 minutes every practice, no exceptions. 90% consistency is the standard. Miss deep, never in the net. Get them serving under pressure early: everyone serves, everyone returns to line, count the misses.
  • Passing — first contact excellence. Platform to target, feet moving before the ball, free balls and serve receive treated as points we cannot waste.
  • Attacking — reach for the tag of your shirt, be patient on timing, and learn the smart options: tips, push tips and swipes alongside the full swing. Positions 4, 5 and 2 first.
  • Setting — finish your set: hands extended, wrists close, point to target. Consistent, hittable balls.

The attached Core Philosophy is the reference. If you're building a practice around it, you're doing it right.

RAPPORT COMES FIRST

Use these sessions to learn your players — how they take coaching, what they're playing at school, what they're carrying right now. Find your cues and use them constantly. Coach, don't dominate. A player who trusts you in October will run through a wall for you in March.

REACH PERFORMANCE

Every player moves through Reach for foundational speed and agility, either now or over the next four weeks. Plan around it; it's part of the session, not a competitor for it.

WHAT I'M TELLING THE PLAYERS

An email goes to every player and family on your team this week. In short:

  • These practices are optional, and school volleyball comes first. A school commitment, falling behind on schoolwork, or needing rest are all good reasons to miss one, no justification needed. They tell you and we see them next Sunday.
  • Once school season ends (late October), we expect every best effort to attend.
  • If they aren't playing a school sport or another competing sport, they should be there.
  • They must RSVP in SportsYou and tell you directly if they can't make it, so you can plan the session.
  • They have a letter for their school coach (attached here too) that explains we practice Sundays only, that it's optional, and what we're working on. If a school coach would rather a player not attend, that's the end of it — no pushback from us.

So when a player is missing, assume she's doing what we asked. When one shows up without a school commitment, that's a player choosing to be there. Coach her like it.

Please keep your team's SportsYou schedule current and the RSVPs open before each practice. If a player or parent asks something you're not sure how to answer, send them to me.

Thanks for what you're putting into ${teamList(c.teams)}. Call or text me anytime.

Drew
512-202-9099

Attached: DS Elite Core Philosophy · DS Elite letter for school coaches`;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const P = (s) => `<p style="margin:0 0 14px">${s}</p>`;
const H = (s) => `<p style="margin:22px 0 8px;font-weight:700;font-size:15px;color:#c2186f;text-transform:uppercase;letter-spacing:.03em">${s}</p>`;
const UL = (items) => '<ul style="margin:0 0 14px;padding-left:22px">' + items.map(i => `<li style="margin-bottom:7px">${i}</li>`).join("") + '</ul>';
const htmlFor = (c) => '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:640px">'
  + P(`Hi ${esc(c.name.split(/\s+/)[0])},`)
  + P("Thanks for giving up your Sundays this fall. I want to be clear about what these practices are for, because they are <b>not in-season practices</b> and I don&rsquo;t want them run like one.")
  + H("What these practices are")
  + P("The job between now and Thanksgiving is two things: <b>build a real relationship</b> with your players and with each other, and <b>put in focused work on fundamentals</b>. A team that does both arrives at the season and at our first tournaments with a head start. That&rsquo;s it. We are not installing a full system in September.")
  + H("How they differ from in-season")
  + UL([
    "<b>Intensity.</b> Most of these girls are in the middle of a school season and playing more volleyball right now than at any point in the year. Bring the tempo &mdash; players moving, minimal balls on the floor, quick resets &mdash; but not the volume. They should leave better prepared for their school court, not more worn down for it. That is the promise I&rsquo;ve made to their school coaches.",
    "<b>Reps.</b> Fundamentals over everything. High touch counts on the basics, game-like from the first rep. This is where we get the reps in that we won&rsquo;t have time for in January.",
    "<b>Systems.</b> Keep it simple. Basic serve receive and defensive shape are fine because they&rsquo;re fundamentals. Save the full offense, tempo attacks and match-specific systems for when the school season is over and we have the whole team every week.",
  ])
  + H("What I want them working on")
  + P("How we play at DS Elite starts with first contact and serving, and these Sundays are the time to build it:")
  + UL([
    "<b>Serving</b> &mdash; 15 to 25 minutes every practice, no exceptions. 90% consistency is the standard. Miss deep, never in the net. Get them serving under pressure early: everyone serves, everyone returns to line, count the misses.",
    "<b>Passing</b> &mdash; first contact excellence. Platform to target, feet moving before the ball, free balls and serve receive treated as points we cannot waste.",
    "<b>Attacking</b> &mdash; reach for the tag of your shirt, be patient on timing, and learn the smart options: tips, push tips and swipes alongside the full swing. Positions 4, 5 and 2 first.",
    "<b>Setting</b> &mdash; finish your set: hands extended, wrists close, point to target. Consistent, hittable balls.",
  ])
  + P("The attached <b>Core Philosophy</b> is the reference. If you&rsquo;re building a practice around it, you&rsquo;re doing it right.")
  + H("Rapport comes first")
  + P("Use these sessions to learn your players &mdash; how they take coaching, what they&rsquo;re playing at school, what they&rsquo;re carrying right now. Find your cues and use them constantly. Coach, don&rsquo;t dominate. A player who trusts you in October will run through a wall for you in March.")
  + H("Reach Performance")
  + P("Every player moves through Reach for foundational speed and agility, either now or over the next four weeks. Plan around it; it&rsquo;s part of the session, not a competitor for it.")
  + H("What I&rsquo;m telling the players")
  + P("An email goes to every player and family on your team this week. In short:")
  + UL([
    "These practices are <b>optional, and school volleyball comes first</b>. A school commitment, falling behind on schoolwork, or needing rest are all good reasons to miss one, no justification needed. They tell you and we see them next Sunday.",
    "Once school season ends (late October), we expect every best effort to attend.",
    "If they aren&rsquo;t playing a school sport or another competing sport, they should be there.",
    "They must <b>RSVP in SportsYou</b> and tell you directly if they can&rsquo;t make it, so you can plan the session.",
    "They have a letter for their school coach (attached here too) that explains we practice Sundays only, that it&rsquo;s optional, and what we&rsquo;re working on. If a school coach would rather a player not attend, that&rsquo;s the end of it &mdash; no pushback from us.",
  ])
  + P("So when a player is missing, assume she&rsquo;s doing what we asked. When one shows up without a school commitment, that&rsquo;s a player choosing to be there. Coach her like it.")
  + P("Please keep your team&rsquo;s SportsYou schedule current and the RSVPs open before each practice. If a player or parent asks something you&rsquo;re not sure how to answer, send them to me.")
  + P(`Thanks for what you&rsquo;re putting into ${esc(teamList(c.teams))}. Call or text me anytime.`)
  + '<p style="margin:18px 0 0"><b>Drew</b><br><a href="tel:5122029099" style="color:#c2186f">512-202-9099</a></p>'
  + '<p style="margin:18px 0 0;font-size:13px;color:#666">Attached: DS Elite Core Philosophy &middot; DS Elite letter for school coaches</p>'
  + '</div>';

// ── Report ──────────────────────────────────────────────────────────────────
console.log(`${jobs.length} coaches on ${new Set(jobs.flatMap(j => j.teams)).size} teams (Rise + event teams excluded)${ccKristen ? " + " + KRISTEN.name : ""}`);
jobs.forEach(j => console.log("   " + j.name.padEnd(22) + j.email.padEnd(36) + j.teams.join(", ")));
if (noEmail.length) {
  console.log(`\n⚠ ${noEmail.length} coach${noEmail.length === 1 ? "" : "es"} with NO email on file:`);
  noEmail.forEach(c => console.log("   " + c.name + " (" + c.teams.join(", ") + ")"));
}
console.log("\nAttachments: " + files.map(f => f.filename).join(" · "));

const post = async (job, to) => {
  const res = await fetch(APP_URL + "/api/send-email", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: SUBJECT, body: textFor(job), bodyHtml: htmlFor(job), recipients: [to], attachments,
      ...(scheduledAt ? { scheduledAt } : {}),
      sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script",
    }),
  });
  return res.json().catch(() => ({ error: "HTTP " + res.status }));
};

if (testTo) {
  const sample = jobs[0] || { name: "Coach", teams: ["14 Ruby"] };
  const out = await post(sample, testTo);
  console.log(out.error ? ("Test FAILED: " + out.error) : `Test sent to ${testTo} (rendered as ${sample.name}'s copy).`);
} else if (doSend) {
  let sent = 0, failed = 0;
  const all = [...jobs, ...(ccKristen ? [{ name: KRISTEN.name, email: KRISTEN.email, teams: ["every team"] }] : [])];
  for (const j of all) {
    const out = await post(j, j.email);
    if (out.error || out.failed?.length) { failed++; console.error("FAILED " + j.name + ": " + (out.error || out.failed[0].error)); }
    else { sent++; console.log((scheduledAt ? "queued " : "sent ") + j.name + " → " + j.email); }
  }
  console.log(`\nDone. ${sent} ${scheduledAt ? "queued" : "sent"}, ${failed} failed${scheduledAt ? " — releases at " + scheduledAt : ""}.`);
} else {
  console.log("\n─── the email (first coach shown) ──────────────────────");
  console.log("Subject: " + SUBJECT + "\n");
  console.log(textFor(jobs[0] || { name: "Coach", teams: ["14 Ruby"] }));
  console.log("\nDRY RUN — nothing sent. --test for a copy to Drew, --send for every coach.");
}
