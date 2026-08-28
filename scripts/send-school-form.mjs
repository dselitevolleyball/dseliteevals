// Chase the families who haven't told us about school volleyball.
//
// One personalised email per player, to all of her contact addresses, with the
// link that only opens her form. Anyone who has already answered is skipped, so
// this is safe to re-run as the chaser it is.
//
// DRY RUN BY DEFAULT. Nothing sends until --send. Getting the audience wrong
// here means emailing families who left the club, which has happened before:
// roster_status stays "active" after a family declines their offer, so the
// filter is a team assignment plus a non-terminal offer, never roster_status
// alone.
//
// Usage:
//   node scripts/send-school-form.mjs                    # dry run
//   node scripts/send-school-form.mjs --team "14 Ruby"   # dry run, one team
//   node scripts/send-school-form.mjs --send             # actually send
//
// Sending goes through the deployed /api/send-email (the Resend key lives in
// Vercel, not here). That endpoint logs every send itself, so the sender is
// passed through to it rather than logged again here — doing both put two rows
// in the history for one email.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP_URL = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
// Only the ages old enough to be on a school team — the same rule the board uses.
const SCHOOL_DIVS = ["U13", "U14", "U15", "U16"];
const TERMINAL_OFFER = ["declined", "not_invited", "opted_out"];

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
const doSend = args.includes("--send");
const onlyTeam = (() => { const i = args.indexOf("--team"); return i >= 0 ? args[i + 1] : null; })();

const env = loadEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: players, error: pErr } = await supabase
  .from("players")
  .select("id,first_name,last_name,team_assignment,roster_status,season,offer_status,usav_div,parent_name,parent_email,parent_email2,parent_email3,school_form_token")
  .order("team_assignment");
if (pErr) { console.error("Load players failed:", pErr.message); process.exit(1); }

const { data: reports, error: rErr } = await supabase.from("school_team_reports").select("player_id");
if (rErr) { console.error("Load reports failed:", rErr.message); process.exit(1); }
const answered = new Set((reports || []).map(r => r.player_id));

const targets = players.filter(p =>
  p.roster_status === "active" &&
  (p.season || "2026-27") === "2026-27" &&
  (p.team_assignment || "").trim() &&
  !TERMINAL_OFFER.includes(p.offer_status || "") &&
  SCHOOL_DIVS.includes(p.usav_div) &&
  !answered.has(p.id) &&
  (!onlyTeam || p.team_assignment === onlyTeam) &&
  !!p.school_form_token
);

const emailsOf = (p) => [...new Set([p.parent_email, p.parent_email2, p.parent_email3]
  .map(e => String(e || "").trim()).filter(Boolean))];

const greeting = (p) => {
  const first = String(p.parent_name || "").trim().split(/\s+/)[0];
  return first ? "Hi " + first + "," : "Hi,";
};

const bodyFor = (p) => `${greeting(p)}

We're still missing one answer for ${p.first_name}, and it takes about a minute.

School volleyball is underway and we'd like to know who's playing where. If ${p.first_name} made a school team, tell us the school, her grade, and which team she made.

If you have her schedule — even roughly, even just a link to the school's page — that's the part that helps us most. It's how we avoid putting a club practice or tournament on top of her school matches.

Here's her form. The link is hers, so there's nothing to log into:

${APP_URL}/school?t=${p.school_form_token}

If she didn't make a team this year, please tap it and tell us anyway. Knowing who isn't playing school ball matters just as much for how we plan the fall.

That link stays live all season, so if she moves up or the schedule comes out later, open it again and update it.

Thanks,

Drew Rose
DS Elite Volleyball`;

const jobs = targets.map(p => ({
  player: p,
  recipients: emailsOf(p),
  subject: `Did ${p.first_name} make a school team?`,
  body: bodyFor(p),
})).filter(j => j.recipients.length);

const noEmail = targets.filter(p => !emailsOf(p).length);

console.log(`${targets.length} player${targets.length === 1 ? "" : "s"} with no school answer` +
  (onlyTeam ? ` on ${onlyTeam}` : "") + ` · ${answered.size} have already answered`);
console.log(`${jobs.length} emails, ${new Set(jobs.flatMap(j => j.recipients)).size} distinct addresses`);
if (noEmail.length) {
  console.log(`\n⚠ ${noEmail.length} with NO email on file — chase another way:`);
  noEmail.forEach(p => console.log("   " + p.first_name + " " + p.last_name + " (" + p.team_assignment + ")"));
}

const byTeam = {};
jobs.forEach(j => { (byTeam[j.player.team_assignment] = byTeam[j.player.team_assignment] || []).push(j); });
console.log("");
Object.keys(byTeam).sort().forEach(t => console.log("   " + t.padEnd(14) +
  byTeam[t].map(j => j.player.first_name + " " + j.player.last_name).join(", ")));

if (!doSend) {
  if (jobs.length) {
    console.log("\n─── first email, in full ───────────────────────────────");
    console.log("To:      " + jobs[0].recipients.join(", "));
    console.log("Subject: " + jobs[0].subject + "\n");
    console.log(jobs[0].body);
    console.log("────────────────────────────────────────────────────────");
  }
  console.log("\nDRY RUN — nothing sent. Re-run with --send to actually send.");
  process.exit(0);
}

let sent = 0, failed = 0;
for (const job of jobs) {
  const res = await fetch(APP_URL + "/api/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: job.subject, body: job.body, recipients: job.recipients,
      // /api/send-email writes email_log itself. Passing the sender through
      // means one attributed row instead of two rows for one email.
      sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script",
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.error) {
    failed++;
    console.error("FAILED " + job.player.first_name + " " + job.player.last_name + ": " + (out.error || res.status));
    continue;
  }
  sent++;
  console.log("sent " + job.player.first_name + " " + job.player.last_name + " → " + job.recipients.join(", "));
}
console.log(`\nDone. ${sent} sent, ${failed} failed.`);
