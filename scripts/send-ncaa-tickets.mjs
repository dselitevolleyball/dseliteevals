// Email every DS Elite family the NCAA Championship group tickets form.
//
// One email per FAMILY (players who share a parent email), to every parent
// address in it, with the link that opens their family's form
// (/ncaa?t=players.global_token of the first player). Families who already
// answered are skipped unless --all, so this doubles as the chaser.
// Comes from and replies go to Drew. Wording: shared/ncaa-tickets.js.
//
// DRY RUN BY DEFAULT: prints who would get it and the first email in full.
//
// Usage:
//   node scripts/send-ncaa-tickets.mjs                      # dry run
//   node scripts/send-ncaa-tickets.mjs --team "15 Diamond"  # dry run, one team
//   node scripts/send-ncaa-tickets.mjs --test drew@dselitevolleyball.com --send
//                                  # the first family's email, sent only to that address
//   node scripts/send-ncaa-tickets.mjs --send               # actually send
//
// Texts: add --text (texts only) or --both (email and text). A text goes to
// each parent mobile on file from the club number, "{first}" filled in per
// parent by /api/send-sms; numbers that replied STOP are skipped there.
//   node scripts/send-ncaa-tickets.mjs --text --test-phone 5125551234 --send
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env (or the environment).

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { families, ncaaEmail, ncaaText, NCAA_SUBJECT } from "../shared/ncaa-tickets.js";
import { isEventTeam } from "../shared/event-teams.js";

const APP_URL = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const TERMINAL_OFFER = ["declined", "not_invited", "opted_out"];

function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env: use the environment */ }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
  return env;
}

const args = process.argv.slice(2);
const flag = (name) => args.includes("--" + name);
const value = (name) => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : null; };
const doSend = flag("send");
const includeDone = flag("all");
const onlyTeam = value("team");
const testTo = value("test");
const testPhone = value("test-phone");
const doText = flag("text") || flag("both");
const doEmail = !flag("text") || flag("both");

const env = loadEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const [{ data: players, error: pErr }, { data: teams }, { data: answers, error: aErr }] = await Promise.all([
  supabase.from("players")
    .select("id,first_name,last_name,team_assignment,roster_status,offer_status,parent_name,parent2_name,parent_email,parent_email2,parent_email3,parent_phone,parent2_phone,global_token")
    .not("team_assignment", "is", null).order("team_assignment"),
  supabase.from("practice_teams").select("team_name,practices_per_week"),
  supabase.from("ncaa_tickets").select("player_id"),
]);
if (pErr || aErr) { console.error("Load failed:", (pErr || aErr).message); process.exit(1); }
const eventTeams = new Set((teams || []).filter(isEventTeam).map((t) => t.team_name));
const answered = new Set((answers || []).map((a) => a.player_id));

// Current roster: on a real team, active, and not a terminal offer.
const rostered = players.filter((p) => String(p.team_assignment || "").trim() && (p.roster_status || "active") === "active"
  && !TERMINAL_OFFER.includes(p.offer_status || "") && !eventTeams.has(p.team_assignment));
const fams = families(rostered)
  .filter((f) => !onlyTeam || f.some((p) => p.team_assignment === onlyTeam))
  .filter((f) => includeDone || !f.some((p) => answered.has(p.id)))
  .filter((f) => f.some((p) => p.global_token));

const emailsOf = (fam) => [...new Set(fam.flatMap((p) => [p.parent_email, p.parent_email2, p.parent_email3])
  .map((e) => String(e || "").trim().toLowerCase()).filter(Boolean))];
const greeting = (fam) => {
  const names = [...new Set(fam.flatMap((p) => [p.parent_name, p.parent2_name])
    .map((x) => String(x || "").trim().split(/\s+/)[0]).filter(Boolean))];
  return names.length ? "Hi " + (names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]) + "," : "Hi,";
};

const phonesOf = (fam) => {
  const seen = new Set(), out = [];
  for (const p of fam) for (const [ph, nm] of [[p.parent_phone, p.parent_name], [p.parent2_phone, p.parent2_name]]) {
    const k = String(ph || "").replace(/\D/g, "").slice(-10);
    if (k.length === 10 && !seen.has(k)) { seen.add(k); out.push({ to: String(ph).trim(), name: String(nm || "").trim() || null, player_id: p.id, team_name: p.team_assignment }); }
  }
  return out;
};
const linkOf = (lead) => APP_URL + "/ncaa?t=" + lead.global_token;
const allJobs = fams.map((fam) => {
  const lead = fam.find((p) => p.global_token);
  return {
    fam, lead, recipients: emailsOf(fam), phones: phonesOf(fam), subject: NCAA_SUBJECT,
    body: ncaaEmail({ greeting: greeting(fam), link: linkOf(lead), from: SENDER.name }),
    text: ncaaText({ link: linkOf(lead), from: SENDER.name.split(" ")[0] }),
  };
});
const jobs = allJobs.filter((j) => j.recipients.length);
const noEmail = fams.filter((f) => !emailsOf(f).length);
const kidsOf = (j) => j.fam.map((p) => p.first_name + " " + p.last_name + " (" + p.team_assignment + ")").join(" + ");

console.log(`${fams.length} families` + (onlyTeam ? ` with a player on ${onlyTeam}` : "") +
  (includeDone ? " (including families who already answered)" : " (families who haven't answered)"));
console.log(`${jobs.length} emails, ${new Set(jobs.flatMap((j) => j.recipients)).size} distinct addresses`);
console.log(`${allJobs.filter((j) => j.phones.length).length} families with a parent mobile, ${allJobs.reduce((n, j) => n + j.phones.length, 0)} numbers\n`);
for (const j of jobs) console.log("   " + kidsOf(j).padEnd(56) + " " + j.recipients.join(", "));
if (noEmail.length) {
  console.log(`\n⚠ ${noEmail.length} families with NO email on file:`);
  noEmail.forEach((f) => console.log("   " + f.map((p) => p.first_name + " " + p.last_name + " (" + p.team_assignment + ")").join(" + ")));
}

if (!doSend) {
  if (jobs.length) {
    console.log("\n─── first email, in full ───────────────────────────────");
    console.log("To:       " + jobs[0].recipients.join(", "));
    console.log("Reply-To: " + SENDER.email);
    console.log("Subject:  " + jobs[0].subject + "\n");
    console.log(jobs[0].body);
    console.log("─── first text ─────────────────────────────────────────");
    console.log(jobs[0].text);
    console.log("────────────────────────────────────────────────────────");
  }
  console.log("\nDRY RUN — nothing sent. Re-run with --send to actually send.");
  process.exit(0);
}

const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const nudge = (job, channel, recipients) => supabase.from("player_nudges").insert(job.fam.map((p) => ({
  player_id: p.id, need: "ncaa", channel, recipients, sent_by: SENDER.name })));
let sent = 0, failed = 0, texted = 0, textFailed = 0;

if (doEmail) {
  const list = testTo ? jobs.slice(0, 1).map((j) => ({ ...j, recipients: [testTo], subject: "[TEST] " + j.subject })) : testPhone ? [] : jobs;
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
    if (!res.ok || out.error) { failed++; console.error("FAILED email " + kidsOf(job) + ": " + (out.error || res.status)); continue; }
    sent++;
    if (!testTo) await nudge(job, "email", job.recipients);
    console.log("emailed " + kidsOf(job) + " → " + job.recipients.join(", "));
  }
}

if (doText) {
  const withPhones = allJobs.filter((j) => j.phones.length);
  const list = testPhone ? withPhones.slice(0, 1).map((j) => ({ ...j, phones: [{ to: testPhone, name: SENDER.name }] })) : testTo ? [] : withPhones;
  for (const job of list) {
    const res = await fetch(APP_URL + "/api/send-sms", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + SERVICE_KEY },
      body: JSON.stringify({ body: job.text, audience: "NCAA tickets · " + job.lead.first_name + " " + job.lead.last_name + (testPhone ? " · test" : ""),
        recipients: job.phones.map((x) => ({ ...x, kind: testPhone ? null : "parent", player_id: testPhone ? null : x.player_id, team_name: testPhone ? null : x.team_name })),
        sent_by_label: SENDER.name }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error || !out.sent) {
      textFailed++;
      console.error("FAILED text " + kidsOf(job) + ": " + (out.error || (out.failed || []).map((f) => f.error).join("; ") || res.status));
      continue;
    }
    texted += out.sent;
    if ((out.failed || []).length) console.error("  some numbers failed for " + kidsOf(job) + ": " + out.failed.map((f) => f.to + " " + f.error).join("; "));
    if (!testPhone) await nudge(job, "sms", job.phones.map((x) => x.to));
    console.log("texted " + kidsOf(job) + " → " + out.sent + " number" + (out.sent === 1 ? "" : "s"));
  }
}
console.log(`\nDone. ${sent} emails sent, ${failed} failed; ${texted} texts sent, ${textFailed} families' texts failed.`);
