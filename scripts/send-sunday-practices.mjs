// Optional Sunday practices — what we're asking of families this fall, with
// the letter for school coaches attached.
//
// Audience: every rostered 2026-27 player on a real, non-Rise team. Rise plays
// the in-house season and has no Sunday practices; event teams (14 Crystal)
// have no practices at all and their girls hear from their home team. Parent
// addresses plus the player's own, because the email is addressed to players.
//
// The audience filter is a team assignment plus a non-terminal offer, never
// roster_status alone — that stays "active" after a family declines.
//
// DRY RUN BY DEFAULT.
//
// Usage:
//   node scripts/send-sunday-practices.mjs                          # dry run
//   node scripts/send-sunday-practices.mjs --test [email]           # one copy to Drew
//   node scripts/send-sunday-practices.mjs --send                   # send now
//   node scripts/send-sunday-practices.mjs --send --at 2026-09-26T13:00:00-05:00
//                                                                   # queue with Resend
//   node scripts/send-sunday-practices.mjs --parents-only           # skip player addresses
//   --pdf <path>  letter to attach (default: Downloads/DS_Elite_Coach_Letter.pdf)
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isEventTeam } from "../shared/event-teams.js";

const APP_URL = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const TERMINAL = ["declined", "not_invited", "opted_out"];
const isRise = (t) => /\brise\b/i.test(String(t || ""));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
const parentsOnly = flag("parents-only");
const scheduledAt = opt("at");
const pdfPath = opt("pdf") || join(homedir(), "Downloads", "DS_Elite_Coach_Letter.pdf");

const pdf = readFileSync(pdfPath);
const attachments = [{ filename: "DS Elite letter for school coaches.pdf", content: pdf.toString("base64"), contentType: "application/pdf" }];

const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const [{ data: players, error: pErr }, { data: teams, error: tErr }] = await Promise.all([
  sb.from("players").select("id, first_name, last_name, team_assignment, roster_status, season, offer_status, parent_email, parent_email2, parent_email3, player_email"),
  sb.from("practice_teams").select("team_name, practices_per_week"),
]);
if (pErr || tErr) { console.error("Load failed:", (pErr || tErr).message); process.exit(1); }
const eventTeams = new Set((teams || []).filter(isEventTeam).map(t => t.team_name));

const roster = (players || []).filter(p =>
  p.roster_status === "active" && (p.season || "2026-27") === "2026-27" &&
  String(p.team_assignment || "").trim() && !isRise(p.team_assignment) &&
  !eventTeams.has(p.team_assignment) && !TERMINAL.includes(p.offer_status || ""));

const addrs = (p) => [p.parent_email, p.parent_email2, p.parent_email3, ...(parentsOnly ? [] : [p.player_email])]
  .map(e => String(e || "").trim().toLowerCase()).filter(e => EMAIL_RE.test(e));
const recipients = [...new Set(roster.flatMap(addrs))];
const noEmail = roster.filter(p => !addrs(p).length);
const playerAddrs = parentsOnly ? 0 : new Set(roster.map(p => String(p.player_email || "").trim().toLowerCase()).filter(e => EMAIL_RE.test(e))).size;

// ── The message ─────────────────────────────────────────────────────────────
const SUBJECT = "Optional Sunday Practices — what we're asking of you this fall";

const text = `Players and families,

Club volleyball is a significant investment of time, money and energy, and we want every team to reach the highest level of success it can. These optional Sunday practices exist so we don't start from zero at Thanksgiving. Two things happen between now and then: your team builds a relationship with each other and with your coach, and we put in focused work on fundamental skills. Teams that do that arrive at the season and at our first tournaments with a real head start.

SCHOOL VOLLEYBALL COMES FIRST

We know there's a lot competing for your time right now, and school volleyball is at the top of that list. That's where it should be. Being there for your school team and competing at the best of your ability is the priority right now — not club.

These practices are optional for a reason. Good reasons to miss one:

  • A school team commitment
  • You're falling behind on schoolwork
  • You need rest

None of those require a justification. Tell your coach and we'll see you next Sunday.

WHAT WE EXPECT AS THE SCHOOL SEASON WINDS DOWN

School volleyball wraps up toward the end of October. Once your season ends, we expect you to make every best effort to attend your scheduled Sunday practices.

HOW WE'RE STRUCTURING THESE PRACTICES

Your coaches know how much volleyball you're playing right now, and they're building practices around that. This is not a second full season stacked on top of your first. We're working on fundamentals and on foundational speed and agility work — every player will move through Reach Performance either now or over the next four weeks. That work benefits your school team as much as it benefits us.

PLEASE RSVP

Our coaches are at every one of these practices. They need to know who's coming so they can plan the session — a drill built for ten doesn't work for four. Update your RSVP in SportsYou and tell your coach directly if you can't make it.

IF YOUR SCHOOL COACH HAS QUESTIONS

Some school coaches aren't comfortable with their players practicing outside the school season, and we understand where that's coming from. We've attached a letter you can print or forward to your coach. It explains that we practice Sundays only, that these sessions are optional, that we've told you their season comes first, and what we're actually working on. Hand it to them and let them decide. If your coach would rather you not attend, tell us and that's the end of it — no issue on our side.

AND TO BE DIRECT ABOUT IT

If you aren't playing a school sport or another competing sport right now, you should be at these Sunday practices.

Practice times are in SportsYou.

Questions, call or text me anytime.

Drew Rose
Director, DS Elite
512-202-9099

Attached: DS Elite letter for school coaches`;

const P = (s) => `<p style="margin:0 0 14px">${s}</p>`;
const H = (s) => `<p style="margin:22px 0 8px;font-weight:700;font-size:15px;color:#c2186f;text-transform:uppercase;letter-spacing:.03em">${s}</p>`;
const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:620px">'
  + P("Players and families,")
  + P("Club volleyball is a significant investment of time, money and energy, and we want every team to reach the highest level of success it can. These <b>optional Sunday practices</b> exist so we don&rsquo;t start from zero at Thanksgiving. Two things happen between now and then: your team builds a relationship with each other and with your coach, and we put in focused work on fundamental skills. Teams that do that arrive at the season and at our first tournaments with a real head start.")
  + H("School volleyball comes first")
  + P("We know there&rsquo;s a lot competing for your time right now, and school volleyball is at the top of that list. That&rsquo;s where it should be. Being there for your school team and competing at the best of your ability is the priority right now &mdash; not club.")
  + P("These practices are optional for a reason. Good reasons to miss one:")
  + '<ul style="margin:0 0 14px;padding-left:22px"><li>A school team commitment</li><li>You&rsquo;re falling behind on schoolwork</li><li>You need rest</li></ul>'
  + P("None of those require a justification. Tell your coach and we&rsquo;ll see you next Sunday.")
  + H("What we expect as the school season winds down")
  + P("School volleyball wraps up toward the end of October. Once your season ends, we expect you to make every best effort to attend your scheduled Sunday practices.")
  + H("How we&rsquo;re structuring these practices")
  + P("Your coaches know how much volleyball you&rsquo;re playing right now, and they&rsquo;re building practices around that. This is not a second full season stacked on top of your first. We&rsquo;re working on fundamentals and on foundational speed and agility work &mdash; every player will move through Reach Performance either now or over the next four weeks. That work benefits your school team as much as it benefits us.")
  + H("Please RSVP")
  + P("Our coaches are at every one of these practices. They need to know who&rsquo;s coming so they can plan the session &mdash; a drill built for ten doesn&rsquo;t work for four. <b>Update your RSVP in SportsYou</b> and tell your coach directly if you can&rsquo;t make it.")
  + H("If your school coach has questions")
  + P("Some school coaches aren&rsquo;t comfortable with their players practicing outside the school season, and we understand where that&rsquo;s coming from. <b>We&rsquo;ve attached a letter you can print or forward to your coach.</b> It explains that we practice Sundays only, that these sessions are optional, that we&rsquo;ve told you their season comes first, and what we&rsquo;re actually working on. Hand it to them and let them decide. If your coach would rather you not attend, tell us and that&rsquo;s the end of it &mdash; no issue on our side.")
  + H("And to be direct about it")
  + P("If you aren&rsquo;t playing a school sport or another competing sport right now, you should be at these Sunday practices.")
  + P("Practice times are in SportsYou.")
  + P("Questions, call or text me anytime.")
  + '<p style="margin:18px 0 0"><b>Drew Rose</b><br>Director, DS Elite<br><a href="tel:5122029099" style="color:#c2186f">512-202-9099</a></p>'
  + '<p style="margin:18px 0 0;font-size:13px;color:#666">Attached: DS Elite letter for school coaches (PDF)</p>'
  + '</div>';

// ── Report ──────────────────────────────────────────────────────────────────
const byTeam = {};
roster.forEach(p => { (byTeam[p.team_assignment] = byTeam[p.team_assignment] || []).push(p); });
console.log(`${roster.length} players on ${Object.keys(byTeam).length} teams (Rise + ${[...eventTeams].join(", ") || "event teams"} excluded)`);
console.log(`${recipients.length} distinct addresses (${playerAddrs} of them players' own)`);
Object.keys(byTeam).sort().forEach(t => console.log("   " + t.padEnd(14) + String(byTeam[t].length).padEnd(4) + byTeam[t].map(p => p.first_name + " " + p.last_name).join(", ")));
if (noEmail.length) {
  console.log(`\n⚠ ${noEmail.length} with NO email on file:`);
  noEmail.forEach(p => console.log("   " + p.first_name + " " + p.last_name + " (" + p.team_assignment + ")"));
}
console.log(`\nAttachment: ${pdfPath} (${(pdf.length / 1024).toFixed(0)} KB)`);

const post = async (to) => {
  const res = await fetch(APP_URL + "/api/send-email", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: SUBJECT, body: text, bodyHtml: html, recipients: to, attachments,
      ...(scheduledAt ? { scheduledAt } : {}),
      sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script",
    }),
  });
  return res.json().catch(() => ({ error: "HTTP " + res.status }));
};

if (testTo) {
  const out = await post([testTo]);
  console.log(out.error ? ("Test FAILED: " + out.error) : `Test sent to ${testTo}.`);
} else if (doSend) {
  const out = await post(recipients);
  console.log(out.error ? ("Send FAILED: " + out.error)
    : `${scheduledAt ? "Queued" : "Sent"} ${out.sent} of ${recipients.length}${out.failed?.length ? ", " + out.failed.length + " failed: " + out.failed.map(f => f.email).join(", ") : ""}${scheduledAt ? " — releases at " + scheduledAt : ""}.`);
} else {
  console.log("\n─── the email ──────────────────────────────────────────");
  console.log("Subject: " + SUBJECT + "\n");
  console.log(text);
  console.log("\nDRY RUN — nothing sent. --test for a copy to Drew, --send for everyone.");
}
