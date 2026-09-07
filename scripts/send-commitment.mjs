// Send the orientation-night commitment link, one email per player.
//
// Timed to land BEFORE slide 24, not after it. The deck note is explicit about
// this: "The commitment email should already be sent before you reach slide 24
// — if it lands while they're in the parking lot you'll lose half of them." So
// run this at the start of the meeting, or a few minutes before the doors open.
//
// One personalised email to every address on the player's record, with the link
// that opens only her form. Both parents get it, because either can be the one
// holding a phone in the gym.
//
// DRY RUN BY DEFAULT. Nothing sends until --send. Getting the audience wrong
// here means emailing families who left the club, which has happened before:
// roster_status stays "active" after a family declines their offer, so the
// filter is a team assignment plus a non-terminal offer, never roster_status
// alone.
//
// Usage:
//   node scripts/send-commitment.mjs                       # dry run, everyone
//   node scripts/send-commitment.mjs --team "14 Diamond"   # dry run, one team
//   node scripts/send-commitment.mjs --age 13              # dry run, one age night
//   node scripts/send-commitment.mjs --unsigned            # only those not fully signed
//   node scripts/send-commitment.mjs --send                # actually send
//
// --unsigned is the chaser: run it a few days after orientation to catch the
// families who never finished, and again in October. Safe to re-run — a fully
// signed family is skipped either way.
//
// Sending goes through the deployed /api/send-email (the Resend key lives in
// Vercel, not here). That endpoint writes email_log itself.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP_URL = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const REPLY_TO = "kristen@dselitevolleyball.com";
const TERMINAL = ["declined", "not_invited", "opted_out"];

function loadEnv() {
  const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });

const args = process.argv.slice(2);
const doSend = args.includes("--send");
const onlyUnsigned = args.includes("--unsigned");
const argVal = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const onlyTeam = argVal("--team");
const onlyAge = argVal("--age");

const { data: players, error } = await sb.from("players")
  .select("id, first_name, last_name, age, team_assignment, offer_status, commitment_token, parent_name, parent2_name, parent_email, parent_email2, parent_email3")
  .order("team_assignment").order("last_name");
if (error) { console.error(error.message); process.exit(1); }

// The current-roster rule: a team assignment AND a non-terminal offer. Never
// roster_status, which stays "active" after a family declines.
let targets = players.filter(p =>
  String(p.team_assignment || "").trim() &&
  !TERMINAL.includes(String(p.offer_status || "").trim()));
if (onlyTeam) targets = targets.filter(p => p.team_assignment === onlyTeam);
if (onlyAge) targets = targets.filter(p => String(p.team_assignment || "").startsWith(String(onlyAge)));

const { data: signedRows } = await sb.from("player_commitments")
  .select("player_id, player_signed_at, parent_signed_at");
const byId = new Map((signedRows || []).map(r => [r.player_id, r]));
const fully = (p) => { const r = byId.get(p.id); return !!(r && r.player_signed_at && r.parent_signed_at); };
const partial = (p) => { const r = byId.get(p.id); return !!(r && (r.player_signed_at || r.parent_signed_at)) && !fully(p); };

const alreadyDone = targets.filter(fully).length;
if (onlyUnsigned) targets = targets.filter(p => !fully(p));

const emailsOf = (p) => [...new Set([p.parent_email, p.parent_email2, p.parent_email3]
  .map(e => String(e || "").trim()).filter(Boolean))];

const noToken = targets.filter(p => !p.commitment_token);

const bodyFor = (p) => `Hi${p.parent_name ? " " + String(p.parent_name).split(/\s+/)[0] : ""},

Here is the DS Elite commitment for ${p.first_name}${p.team_assignment ? ", " + p.team_assignment : ""}.

${APP_URL}/commitment?t=${p.commitment_token}

Nothing in it is new. Every line comes from what we walked through at orientation — the work outside practice, attendance and wall work, tournament days, how we treat officials and teammates, and what we're asking of parents in the stands and on the ride home.

There are two halves. ${p.first_name} reads and signs hers, and a parent reads and signs the other. Do it together rather than separately — that conversation is most of the point.

Every box has to be ticked to sign. That is deliberate. If there is a line in there you can't commit to, come talk to me instead of signing around it.

The link stays live all season, so if you only get one half done tonight you can open it again later and finish.

Thanks,

Drew Rose
Club Director, DS Elite Volleyball`;

const jobs = targets.map(p => ({
  player: p,
  recipients: emailsOf(p),
  subject: `The DS Elite commitment — ${p.first_name}${p.team_assignment ? " · " + p.team_assignment : ""}`,
  body: bodyFor(p),
})).filter(j => j.recipients.length && j.player.commitment_token);

const noEmail = targets.filter(p => !emailsOf(p).length);

console.log(`${targets.length} player${targets.length === 1 ? "" : "s"} in scope` +
  (onlyTeam ? ` on ${onlyTeam}` : "") + (onlyAge ? ` in the ${onlyAge}s` : "") +
  (onlyUnsigned ? " (unsigned only)" : "") +
  ` · ${alreadyDone} already fully signed`);
const partials = targets.filter(partial);
if (partials.length) {
  console.log(`\n${partials.length} half-signed — one side done, the other not:`);
  partials.forEach(p => {
    const r = byId.get(p.id);
    console.log("   " + (p.first_name + " " + p.last_name).padEnd(24) +
      (r.player_signed_at ? "player signed, parent missing" : "parent signed, player missing"));
  });
}
console.log(`\n${jobs.length} emails, ${new Set(jobs.flatMap(j => j.recipients)).size} distinct addresses`);
if (noEmail.length) {
  console.log(`\n! ${noEmail.length} with NO email on file — these families need a tablet at the back of the room:`);
  noEmail.forEach(p => console.log("   " + p.first_name + " " + p.last_name + " (" + p.team_assignment + ")"));
}
if (noToken.length) {
  console.log(`\n! ${noToken.length} with no commitment token — re-run migrations/20260907_commitment.sql`);
}

const byTeam = {};
jobs.forEach(j => { (byTeam[j.player.team_assignment] = byTeam[j.player.team_assignment] || []).push(j); });
console.log("");
Object.keys(byTeam).sort().forEach(t => console.log("   " + t.padEnd(14) + byTeam[t].length));

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
      replyTo: REPLY_TO,
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
  console.log("sent " + job.player.first_name + " " + job.player.last_name + " -> " + job.recipients.join(", "));
}
console.log(`\nDone. ${sent} sent, ${failed} failed.`);
