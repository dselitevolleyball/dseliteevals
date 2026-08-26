// Email every family their own jersey & gear order link.
//
// One personalised email per player, to all of that player's contact addresses,
// containing the link that only opens her order. Families who have already
// ordered are skipped unless --all is passed, so this doubles as the chaser.
//
// DRY RUN BY DEFAULT. It prints exactly who would be written to and what the
// first message looks like, and sends nothing until --send is passed. Getting
// this list wrong means emailing 200 families something that isn't theirs.
//
// Usage:
//   node scripts/send-gear-form.mjs                      # dry run, everyone without an order
//   node scripts/send-gear-form.mjs --team "14 Diamond"  # dry run, one team
//   node scripts/send-gear-form.mjs --all                # include families who already ordered
//   node scripts/send-gear-form.mjs --send               # actually send
//
// Sending goes through the deployed /api/send-email (the Resend key lives in
// Vercel, not here), and each send is written to email_log so the player card's
// message history stays complete.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
// The exact team list the form offers. Imported rather than repeated: a player
// whose team is missing from the dropdown cannot submit the form at all, so the
// send has to know the same list the page knows.
import { TEAMS as FORM_TEAMS } from "../api/gear-form.js";

const APP_URL = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
// Families who turned down a spot are not on a team and are not ordering gear.
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

const env = loadEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: players, error: pErr } = await supabase
  .from("players")
  .select("id,first_name,last_name,team_assignment,roster_status,season,offer_status,parent_name,parent_email,parent_email2,parent_email3,gear_form_token")
  .order("team_assignment");
if (pErr) { console.error("Load players failed:", pErr.message); process.exit(1); }

const { data: orders, error: oErr } = await supabase.from("player_gear_orders").select("player_id");
if (oErr) { console.error("Load orders failed:", oErr.message); process.exit(1); }
const hasOrdered = new Set((orders || []).map(o => o.player_id));

const targets = players.filter(p =>
  p.roster_status === "active" &&
  (p.season || "2026-27") === "2026-27" &&
  (p.team_assignment || "").trim() &&
  !TERMINAL_OFFER.includes(p.offer_status || "") &&
  (!onlyTeam || p.team_assignment === onlyTeam) &&
  (includeDone || !hasOrdered.has(p.id)) &&
  !!p.gear_form_token
);

// A player whose team isn't in the form's dropdown can't submit it at all —
// team is a required field — so she is held back and named instead of being
// sent to a dead end. Today that's the Rise teams, which the gear order list
// doesn't include.
const offForm = targets.filter(p => !FORM_TEAMS.includes(p.team_assignment));
const sendable = targets.filter(p => FORM_TEAMS.includes(p.team_assignment));

const emailsOf = (p) => [...new Set([p.parent_email, p.parent_email2, p.parent_email3]
  .map(e => String(e || "").trim()).filter(Boolean))];

// "Hi Paul," when we know a parent's name, "Hi," when we don't — never "Hi
// Saunders family," which reads like a mail merge because it is one.
const greeting = (p) => {
  const first = String(p.parent_name || "").trim().split(/\s+/)[0];
  return first ? "Hi " + first + "," : "Hi,";
};

const bodyFor = (p) => `${greeting(p)}

Gear try-ons are done, so here's ${p.first_name}'s order form. It should take a couple of minutes.

Use the worksheet you were given at try-ons. We order from exactly what you enter, so please check these three against it before you send:

  1. spelling of her last name
  2. her jersey number
  3. her team

Her name, number and team are already filled in from our roster — if any of it doesn't match your worksheet, change it on the form and we'll sort it out.

Here's her form. The link is hers, so there's nothing to log into:

${APP_URL}/gear?t=${p.gear_form_token}

A few notes:

- All gear is provided by DS Elite except shoes.
- We're ordering shoes as a group and getting a discount.
- Shoes are invoiced separately by email — nothing to pay on this form.

That link stays live until we place the order, so if a size turns out wrong, open it again and change it.

Questions about sizing? Coach Kristen — kristen@dselitevolleyball.com.

Thanks,

Drew Rose
DS Elite Volleyball`;

const jobs = sendable.map(p => ({
  player: p,
  recipients: emailsOf(p),
  subject: `${p.first_name}'s DS Elite jersey & gear order`,
  body: bodyFor(p),
})).filter(j => j.recipients.length);

const noEmail = sendable.filter(p => !emailsOf(p).length);

console.log(`${targets.length} player${targets.length === 1 ? "" : "s"} in scope` +
  (onlyTeam ? ` on ${onlyTeam}` : "") +
  (includeDone ? " (including families who already ordered)" : " (families who haven't ordered)"));
console.log(`${jobs.length} emails, ${new Set(jobs.flatMap(j => j.recipients)).size} distinct addresses`);
if (offForm.length) {
  const teams = [...new Set(offForm.map(p => p.team_assignment))].sort();
  console.log(`
⚠ ${offForm.length} held back — their team isn't on the form: ${teams.join(", ")}`);
  console.log("   Add the team to TEAMS in api/gear-form.js, or leave them out on purpose.");
}
if (noEmail.length) {
  console.log(`\n⚠ ${noEmail.length} with NO email on file — these need chasing another way:`);
  noEmail.forEach(p => console.log("   " + p.first_name + " " + p.last_name + " (" + p.team_assignment + ")"));
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
    body: JSON.stringify({ subject: job.subject, body: job.body, recipients: job.recipients }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.error) {
    failed++;
    console.error("FAILED " + job.player.first_name + " " + job.player.last_name + ": " + (out.error || res.status));
    continue;
  }
  sent++;
  // Logged the same way the app logs a send, so these show up in the player
  // card's message history alongside everything else.
  await supabase.from("email_log").insert({
    subject: job.subject,
    body: job.body,
    recipient_count: job.recipients.length,
    recipients: job.recipients,
    sent_count: out.sent ?? job.recipients.length,
    failed_count: Array.isArray(out.failed) ? out.failed.length : 0,
    sent_by: SENDER.name,
    sent_by_email: SENDER.email,
  });
  console.log("sent " + job.player.first_name + " " + job.player.last_name + " → " + job.recipients.join(", "));
}
console.log(`\nDone. ${sent} sent, ${failed} failed.`);
