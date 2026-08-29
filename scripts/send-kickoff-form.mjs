// Ask every head coach to confirm their team parent and their kickoff party.
//
// One message per TEAM, not per coach: the link answers for one team, and two
// coaches share the staff list (Sam has 13 Diamond and 15 Emerald), so a coach
// with two teams gets two asks — which is right, because there are two answers.
//
// Both channels, every time. Each coach gets the DS Elite HQ notification and
// the email, and both carry the same per-team link. The notification is what
// they see standing in a gym; the email is what they can still find on Tuesday.
//
// DRY RUN BY DEFAULT. It prints who would be written to and what the first
// message says, and sends nothing until --send is passed.
//
// Usage:
//   node scripts/send-kickoff-form.mjs                     # dry run, teams that haven't answered
//   node scripts/send-kickoff-form.mjs --team "14 Diamond" # dry run, one team
//   node scripts/send-kickoff-form.mjs --all               # include teams that already answered
//   node scripts/send-kickoff-form.mjs --send              # actually send
//
// Sending goes through the deployed /api/send-email and /api/send-push (the
// Resend and VAPID keys live in Vercel, not here). send-email writes email_log
// itself, so the sender is passed through rather than logged again.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP_URL = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };

// Mirrors isPlaceholderCoach in src/App.jsx — these are gaps in the staff list,
// not people, and emailing them is how you find out an address bounces.
const PLACEHOLDER = /^(tbd|tba|n\/a|na|none|pending|sub|open|needed|\?+|-+|—)$/i;
const isPlaceholder = (c) => {
  const s = String(c || "").trim();
  return !s || PLACEHOLDER.test(s) || /new coach|floater coach|assistant coach$/i.test(s);
};
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function loadEnv() {
  let raw = "";
  try { raw = readFileSync(new URL("../.env", import.meta.url), "utf8"); }
  catch { console.error("Missing .env next to package.json."); process.exit(1); }
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const args = process.argv.slice(2);
const flag = (name) => args.includes("--" + name);
const value = (name) => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : null; };
const doSend = flag("send");
const includeDone = flag("all");
const onlyTeam = value("team");

const env = loadEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const [{ data: teams, error: tErr }, { data: roster }, { data: accounts }, { data: vols }, { data: answered }] =
  await Promise.all([
    supabase.from("practice_teams").select("team_name, head_coach, kickoff_form_token").order("team_name"),
    supabase.from("coach_roster").select("first_name, last_name, email"),
    supabase.from("coaches").select("display_name, email"),
    supabase.from("team_volunteers").select("team_name, name, role, confirmed"),
    supabase.from("team_kickoffs").select("team_name"),
  ]);
if (tErr) { console.error("Load practice_teams failed:", tErr.message); process.exit(1); }

// A coach's address can be on the roster, on their app account, or only one of
// the two. Looking in a single place silently drops whoever is missing there.
const emailByName = new Map();
const put = (name, email) => {
  const k = norm(name), e = String(email || "").trim().toLowerCase();
  if (!k || !EMAIL_RE.test(e)) return;
  if (!emailByName.has(k)) emailByName.set(k, e);
};
(accounts || []).forEach(a => put(a.display_name, a.email));
(roster || []).forEach(r => put(`${r.first_name || ""} ${r.last_name || ""}`, r.email));

const answeredTeams = new Set((answered || []).map(r => r.team_name));
const parentsByTeam = new Map();
for (const v of (vols || [])) {
  const cur = parentsByTeam.get(v.team_name) || { signups: 0, confirmed: 0 };
  if (v.role === "team_parent") cur.signups++;
  if (v.confirmed) cur.confirmed++;
  parentsByTeam.set(v.team_name, cur);
}

const inScope = (teams || []).filter(t =>
  (!onlyTeam || t.team_name === onlyTeam) &&
  (includeDone || !answeredTeams.has(t.team_name))
);
// Two things stop a team being asked, and they need different fixes: no head
// coach on the team, or a head coach we hold no address for. Both are named
// rather than skipped quietly.
const noCoach = inScope.filter(t => isPlaceholder(t.head_coach));
const noToken = inScope.filter(t => !isPlaceholder(t.head_coach) && !t.kickoff_form_token);
const noEmail = inScope.filter(t => !isPlaceholder(t.head_coach) && t.kickoff_form_token && !emailByName.get(norm(t.head_coach)));
const sendable = inScope.filter(t => !isPlaceholder(t.head_coach) && t.kickoff_form_token && emailByName.get(norm(t.head_coach)));

const firstNameOf = (c) => String(c || "").trim().split(/\s+/)[0];

const bodyFor = (t) => {
  const link = `${APP_URL}/kickoff?t=${t.kickoff_form_token}`;
  const p = parentsByTeam.get(t.team_name) || { signups: 0 };
  // What we already think we know, said out loud. A coach who is told there
  // are five names on file understands they're picking one, not writing a list.
  const known = p.signups === 0
    ? `We have nobody on file for ${t.team_name} — nobody from your team signed up at the season kickoff meeting — so if you have a team parent, add them.`
    : p.signups === 1
      ? `We have one name on file for ${t.team_name} from the season kickoff meeting. Confirm it's still them, or correct it.`
      : `We have ${p.signups} parents on file for ${t.team_name} who signed up at the season kickoff meeting. That's a list of people who offered, not the person doing the job — tick whoever it actually turned out to be.`;

  return `Hi ${firstNameOf(t.head_coach)},

Two quick questions about ${t.team_name}, and a link that answers both. It takes about a minute on your phone.

1. Who is your team parent?

${known}

2. Have you had your kickoff party?

If you've had it, tell us the date. If it's on the calendar, tell us when. If it isn't scheduled yet, that's what this is really about — get hold of your team parent and pick a date. The form will ask when you'll have it booked by, and we'll check back then rather than chasing you in between.

Here's your link. It's for ${t.team_name} only, so there's nothing to log into:

${link}

The kickoff is how the families on your team get to know each other, and the teams that have one early are the ones that stop feeling like a group of strangers by December. It doesn't need to be at the gym — a house, a pizza place, a park, whatever your team parent wants to host.

Thanks,

Drew Rose
DS Elite Volleyball`;
};

const jobs = sendable.map(t => ({
  team: t,
  email: emailByName.get(norm(t.head_coach)),
  subject: `${t.team_name}: confirm your team parent + kickoff party`,
  body: bodyFor(t),
  push: {
    title: `${t.team_name} — kickoff check-in`,
    body: `Who's your team parent, and have you had your kickoff party? About a minute.`,
    url: `${APP_URL}/kickoff?t=${t.kickoff_form_token}`,
  },
}));

console.log(`${inScope.length} team${inScope.length === 1 ? "" : "s"} in scope` +
  (onlyTeam ? ` (${onlyTeam})` : "") +
  (includeDone ? " (including teams that already answered)" : " (teams that haven't answered)"));
console.log(`${jobs.length} to send — notification + email to each head coach`);
if (noCoach.length) {
  console.log(`\n⚠ ${noCoach.length} with NO head coach — nobody to ask until one is assigned:`);
  noCoach.forEach(t => console.log("   " + t.team_name));
}
if (noEmail.length) {
  console.log(`\n⚠ ${noEmail.length} whose head coach has no email on file — needs chasing another way:`);
  noEmail.forEach(t => console.log("   " + t.team_name.padEnd(14) + t.head_coach));
}
if (noToken.length) {
  console.log(`\n⚠ ${noToken.length} with no form link yet — run migrations/20260829_team_kickoff_checkin.sql:`);
  noToken.forEach(t => console.log("   " + t.team_name));
}

if (jobs.length) {
  console.log("");
  jobs.forEach(j => console.log("   " + j.team.team_name.padEnd(14) + String(j.team.head_coach).padEnd(22) + j.email));
}

if (!doSend) {
  if (jobs.length) {
    console.log("\n─── first message, in full ─────────────────────────────");
    console.log("To:      " + jobs[0].email);
    console.log("Subject: " + jobs[0].subject + "\n");
    console.log(jobs[0].body);
    console.log("\nPush:    " + jobs[0].push.title + " — " + jobs[0].push.body);
    console.log("────────────────────────────────────────────────────────");
  }
  console.log("\nDRY RUN — nothing sent. Re-run with --send to actually send.");
}

let sent = 0, failed = 0, pushed = 0;
for (const job of (doSend ? jobs : [])) {
  // The notification first, because it's the one that reaches a coach standing
  // on a court. skipEmail because we send our own below — the mirror in
  // /api/send-push would send the same coach a copy with no link in it.
  try {
    const pr = await fetch(APP_URL + "/api/send-push", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...job.push, skipEmail: true, sentBy: SENDER.name,
        audience: { type: "email", email: job.email },
      }),
    });
    const pout = await pr.json().catch(() => ({}));
    if (pr.ok && pout.sent) pushed += pout.sent;
  } catch { /* a coach with no device subscribed still gets the email */ }

  const res = await fetch(APP_URL + "/api/send-email", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: job.subject, body: job.body, recipients: [job.email],
      sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script",
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.error) {
    failed++;
    console.error("FAILED " + job.team.team_name + ": " + (out.error || res.status));
    continue;
  }
  sent++;
  console.log("sent " + job.team.team_name.padEnd(14) + "→ " + job.email);
}

// Logged so the board can say "asked 6 days ago, still nothing" — without it,
// a team that never answered is indistinguishable from one we never asked.
if (sent) {
  await supabase.from("team_kickoff_requests").insert(
    jobs.slice(0, sent).map(j => ({ team_name: j.team.team_name, coach_name: j.team.head_coach, channel: "email" }))
  );
}

if (doSend) console.log(`\nDone. ${sent} emailed, ${pushed} device${pushed === 1 ? "" : "s"} notified, ${failed} failed.`);
