// Email 14/15 Diamond and Ruby families the Girls Global Challenge interest form.
//
// One email per player, to all of that player's parent addresses, with the
// link that opens only her form (/global?t=players.global_token). Families who
// already answered are skipped unless --all, so this doubles as the chaser.
// Replies go to Hunter, who is running the trip.
//
// DRY RUN BY DEFAULT: prints who would get it and the first email in full.
//
// Usage:
//   node scripts/send-global-challenge.mjs                      # dry run
//   node scripts/send-global-challenge.mjs --team "15 Ruby"     # dry run, one team
//   node scripts/send-global-challenge.mjs --test drew@dselitevolleyball.com --send
//                                  # the first family's email, sent only to that address
//   node scripts/send-global-challenge.mjs --send               # actually send
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { GC_TEAMS, GC_PRICE } from "../shared/global-challenge.js";

const APP_URL = "https://dseliteevals.vercel.app";
const SENDER = { name: "Hunter Haley", email: "hunter@drippingsportsclub.com" };
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
const flag = (name) => args.includes("--" + name);
const value = (name) => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : null; };
const doSend = flag("send");
const includeDone = flag("all");
const onlyTeam = value("team");
const testTo = value("test");

const env = loadEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: players, error: pErr } = await supabase
  .from("players")
  .select("id,first_name,last_name,team_assignment,offer_status,parent_name,parent2_name,parent_email,parent_email2,parent_email3,global_token")
  .in("team_assignment", GC_TEAMS)
  .order("team_assignment");
if (pErr) { console.error("Load players failed:", pErr.message); process.exit(1); }

const { data: answers, error: aErr } = await supabase.from("global_challenge_interest").select("player_id");
if (aErr) { console.error("Load answers failed:", aErr.message); process.exit(1); }
const answered = new Set((answers || []).map((a) => a.player_id));

// Current roster rule: on the team AND not a terminal offer. roster_status
// alone is not enough (see the Ask HQ notes).
const targets = players.filter((p) =>
  !TERMINAL_OFFER.includes(p.offer_status || "") &&
  (!onlyTeam || p.team_assignment === onlyTeam) &&
  (includeDone || !answered.has(p.id)) &&
  !!p.global_token);

const emailsOf = (p) => [...new Set([p.parent_email, p.parent_email2, p.parent_email3]
  .map((e) => String(e || "").trim().toLowerCase()).filter(Boolean))];

const greeting = (p) => {
  const names = [...new Set([p.parent_name, p.parent2_name]
    .map((x) => String(x || "").trim().split(/\s+/)[0]).filter(Boolean))];
  return names.length ? "Hi " + names.join(" and ") + "," : "Hi,";
};

const bodyFor = (p) => `${greeting(p)}

We've been invited to bring a DS Elite team to the Girls Global Challenge in Croatia next summer, July 7–18, 2027, and we're asking our 14 and 15 Diamond and Ruby players first to see if there's enough interest to take one.

The tournament has run for more than 20 years and draws teams from across Europe and beyond. Most of them speak English. My dad, Mick Haley, has been there every year for the last six.

How it works:

- We fly into one European city as a team and spend three days practicing, scrimmaging local clubs and sightseeing.
- Then we head to Pula, Croatia, for opening ceremonies and a four-day tournament. We'd play in the U17 division.
- We finish in Venice and fly home from there.

Think of it as a school trip more than a family vacation. The girls travel, eat, play and sightsee together as a team, and families are very welcome to come along too.

The cost is $${GC_PRICE.toLocaleString("en-US")} per player plus airfare. That covers hotels (players share rooms two or three to a room), meals, tournament entry and team sightseeing.

There's a short form for ${p.first_name}. It asks whether you're interested, which positions she'd be open to playing, and whether she'd travel on her own or with family:

${APP_URL}/global?t=${p.global_token}

It's interest only. Nothing is owed and nobody is signed up by answering. An answer helps even if it's a no.

Questions? Just reply to this email.

Thanks,

Hunter Haley
DS Elite Volleyball`;

const jobs = targets.map((p) => ({
  player: p,
  recipients: emailsOf(p),
  subject: `${p.first_name} and the Girls Global Challenge in Croatia, summer 2027`,
  body: bodyFor(p),
})).filter((j) => j.recipients.length);
const noEmail = targets.filter((p) => !emailsOf(p).length);

console.log(`${targets.length} players in scope` + (onlyTeam ? ` on ${onlyTeam}` : "") +
  (includeDone ? " (including families who already answered)" : " (families who haven't answered)"));
console.log(`${jobs.length} emails, ${new Set(jobs.flatMap((j) => j.recipients)).size} distinct addresses\n`);
const byTeam = {};
for (const j of jobs) (byTeam[j.player.team_assignment] ||= []).push(j);
for (const t of Object.keys(byTeam).sort()) {
  console.log(`${t} (${byTeam[t].length})`);
  for (const j of byTeam[t]) console.log(`   ${(j.player.first_name + " " + j.player.last_name).padEnd(24)} ${j.recipients.join(", ")}`);
}
if (noEmail.length) {
  console.log(`\n⚠ ${noEmail.length} with NO email on file:`);
  noEmail.forEach((p) => console.log("   " + p.first_name + " " + p.last_name + " (" + p.team_assignment + ")"));
}

if (!doSend) {
  if (jobs.length) {
    console.log("\n─── first email, in full ───────────────────────────────");
    console.log("To:       " + jobs[0].recipients.join(", "));
    console.log("Reply-To: " + SENDER.email);
    console.log("Subject:  " + jobs[0].subject + "\n");
    console.log(jobs[0].body);
    console.log("────────────────────────────────────────────────────────");
  }
  console.log("\nDRY RUN — nothing sent. Re-run with --send to actually send.");
  process.exit(0);
}

const list = testTo ? jobs.slice(0, 1).map((j) => ({ ...j, recipients: [testTo], subject: "[TEST] " + j.subject })) : jobs;
let sent = 0, failed = 0;
for (const job of list) {
  const res = await fetch(APP_URL + "/api/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: job.subject, body: job.body, recipients: job.recipients, replyTo: SENDER.email,
      sentBy: SENDER.name, sentByEmail: SENDER.email, source: testTo ? "script test" : "script",
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.error) {
    failed++;
    console.error("FAILED " + job.player.first_name + " " + job.player.last_name + ": " + (out.error || res.status));
    continue;
  }
  sent++;
  if (!testTo) {
    await supabase.from("player_nudges").insert({ player_id: job.player.id, need: "global", channel: "email",
      recipients: job.recipients, sent_by: SENDER.name });
  }
  console.log("sent " + job.player.first_name + " " + job.player.last_name + " → " + job.recipients.join(", "));
}
console.log(`\nDone. ${sent} sent, ${failed} failed.`);
