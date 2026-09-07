// Email a tournament-only roster — the girls flying to an event, not a club team.
//
// "13 Diamond Hawaii" is the case this exists for. Nine players fly to SPAM
// Slam: five of 13 Diamond, one from 13 Ruby, three from 14 Ruby. Mailing
// "13 Diamond" reaches five families who are not going and misses four who are,
// which is exactly the thing that makes parents stop reading club email.
//
// Membership comes from hawaii_interest.hawaii_team, not players.team_assignment
// — nobody's home team changes to go on a trip.
//
// DRY RUN BY DEFAULT. Nothing sends until --send.
//
// Usage:
//   node scripts/send-event-team.mjs --team "13 Diamond Hawaii"
//   node scripts/send-event-team.mjs --team "13 Diamond Hawaii" --roster
//   node scripts/send-event-team.mjs --team "13 Diamond Hawaii" \
//        --subject "Hawaii travel details" --body-file notes.txt --send
//   ... --to drew@dselitevolleyball.com --send      # test to yourself first
//
// --roster just prints who is on it and stops, which is the check to run before
// writing anything.
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
const argVal = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const doSend = args.includes("--send");
const rosterOnly = args.includes("--roster");
const team = argVal("--team");
const overrideTo = argVal("--to");
const subject = argVal("--subject");
const bodyFile = argVal("--body-file");
if (!team) { console.error('Need --team "<event team name>".'); process.exit(1); }

const { data: rows, error } = await sb.from("hawaii_interest")
  .select("player_id, status, hawaii_team")
  .eq("hawaii_team", team);
if (error) { console.error(error.message); process.exit(1); }
if (!rows.length) { console.error(`No players on "${team}".`); process.exit(1); }

const { data: players, error: e2 } = await sb.from("players")
  .select("id, first_name, last_name, team_assignment, offer_status, parent_name, parent_email, parent_email2, parent_email3")
  .in("id", rows.map(r => r.player_id));
if (e2) { console.error(e2.message); process.exit(1); }

// The roster rule still applies on top: a girl who left the club since being
// flagged for the trip is not on this list either.
const live = players.filter(p => !TERMINAL.includes(String(p.offer_status || "").trim()));
const dropped = players.filter(p => TERMINAL.includes(String(p.offer_status || "").trim()));

const emailsOf = (p) => [...new Set([p.parent_email, p.parent_email2, p.parent_email3]
  .map(e => String(e || "").trim()).filter(Boolean))];
const recipients = overrideTo
  ? [overrideTo.trim()]
  : [...new Set(live.flatMap(emailsOf))];
const noEmail = live.filter(p => !emailsOf(p).length);

const byHome = {};
live.forEach(p => { (byHome[p.team_assignment || "(no team)"] ||= []).push(p); });

console.log(`${team} — ${live.length} player${live.length === 1 ? "" : "s"}, ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}` +
  (overrideTo ? " (redirected)" : ""));
Object.keys(byHome).sort().forEach(t => console.log(
  "   " + t.padEnd(14) + byHome[t].map(p => p.first_name + " " + p.last_name).join(", ")));
if (dropped.length) console.log(`\n! ${dropped.length} on this roster have since left the club, excluded: ` +
  dropped.map(p => p.first_name + " " + p.last_name).join(", "));
if (noEmail.length) console.log(`\n! ${noEmail.length} with no email on file: ` +
  noEmail.map(p => p.first_name + " " + p.last_name).join(", "));

if (rosterOnly) process.exit(0);
if (!subject || !bodyFile) {
  console.log('\nTo send, add --subject "..." and --body-file <path>. Add --roster to only list the team.');
  process.exit(0);
}
const body = readFileSync(bodyFile, "utf8");

console.log("\n─── the email ──────────────────────────────────────────");
console.log("To:      " + recipients.join(", "));
console.log("Subject: " + subject + "\n");
console.log(body);
console.log("────────────────────────────────────────────────────────");

if (!doSend) { console.log("\nDRY RUN — nothing sent. Re-run with --send."); process.exit(0); }

const res = await fetch(APP_URL + "/api/send-email", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    subject, body, recipients, replyTo: REPLY_TO,
    sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script",
  }),
});
const out = await res.json().catch(() => ({}));
console.log(out.error ? ("FAILED: " + out.error)
  : `Sent ${out.sent} of ${recipients.length}${out.failed?.length ? ", " + out.failed.length + " failed" : ""}.`);
