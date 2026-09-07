// Orientation night reminder to families, one SportsYou post per team.
//
// The coaches got the run-of-show weeks ago (send-orientation.mjs). This is the
// family-facing version: what night yours is, who has to be there, and when to
// collect your player. Every team gets its own post naming its own night —
// a club-wide "orientation is coming" leaves every family working out which of
// four dates is theirs, and some of them get it wrong.
//
// The 16s share Saturday the 12th with the 15s. That is the one people assume
// wrong, so it is called out in the 15s and 16s posts specifically.
//
// Queueing is not posting. SportsYou has no server-side write, so these sit in
// sportsyou_outbox until the bookmarklet is run from a logged-in tab.
//
// DRY RUN BY DEFAULT.
//
// Usage:
//   node scripts/send-orientation-reminder.mjs              # show the posts
//   node scripts/send-orientation-reminder.mjs --team "14 Ruby"
//   node scripts/send-orientation-reminder.mjs --send       # queue them
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SENDER = "Drew Rose";
const BATCH = "orientation-reminder-2026-09";

// Same four nights as send-orientation.mjs. Kept in step with that file by hand;
// if the schedule moves, both change.
const NIGHTS = [
  { ages: ["14"],       label: "Friday, September 11",   date: "2026-09-11" },
  { ages: ["15", "16"], label: "Saturday, September 12", date: "2026-09-12" },
  { ages: ["13"],       label: "Friday, September 18",   date: "2026-09-18" },
  { ages: ["11", "12"], label: "Friday, September 25",   date: "2026-09-25" },
];
const ageOf = (team) => String(team || "").trim().split(/\s+/)[0];
const nightFor = (team) => NIGHTS.find((n) => n.ages.includes(ageOf(team))) || null;

const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const value = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const doSend = flag("send");
const onlyTeam = value("team");

const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: teams, error } = await sb.from("practice_teams").select("team_name");
if (error) { console.error(error.message); process.exit(1); }

const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

const post = (team, night) => `DS Elite Orientation — ${night.label}

This is a mandatory meeting for all players, and at least one parent needs to attend with you.

WHEN: ${night.label}, 6:00–10:00 PM
WHERE: DSSC${ageOf(team) === "16" ? "\n\n16s — your night is Saturday the 12th, together with the 15s." : ""}${ageOf(team) === "15" ? "\n\nYou share this night with our 16s." : ""}

HOW THE NIGHT RUNS

6:00–7:00 — Commitment meeting. Players and parents together on the court. Coach Drew and Coach T cover our standards and expectations for the season, our cheer coach teaches the DS Elite cheers, and we finish with logistics and the signing of the commitment.

7:10–9:00 — Team time with your coach, including your team's own parent meeting. Parents head out after that, and pizza is provided for the players.

9:00–10:00 — Glow volleyball. Everyone plays.

PICK-UP IS AT 10:00 PM.

WHAT TO BRING
• One parent, for the full first hour
• Your player, ready to move
• Anything your coach has asked your team for

Thank you for your continued help in making this a very special year for DS Elite teams and athletes.`;

const rows = [];
for (const { team_name: team } of (teams || []).sort((a, b) => a.team_name.localeCompare(b.team_name))) {
  if (onlyTeam && team !== onlyTeam) continue;
  const night = nightFor(team);
  if (!night) { console.log(`⚠ ${team} — no orientation night matches this age group, skipped`); continue; }
  if (night.date < today) { console.log(`· ${team} — ${night.label} has passed, skipped`); continue; }
  rows.push({
    team_name: team,
    subject: `Orientation reminder — ${night.label}`,
    message: post(team, night),
    status: "pending",
    queued_by: SENDER,
    batch_id: BATCH,
  });
}

const byNight = new Map();
for (const r of rows) {
  const n = nightFor(r.team_name).label;
  if (!byNight.has(n)) byNight.set(n, []);
  byNight.get(n).push(r.team_name);
}
console.log(`${rows.length} posts across ${byNight.size} nights:`);
for (const [n, list] of byNight) console.log(`  ${n} — ${list.join(", ")}`);

if (!doSend) {
  const sample = rows.find((r) => nightFor(r.team_name).ages.includes("16")) || rows[0];
  if (sample) {
    console.log(`\n─── the post (${sample.team_name}) ───────────────────────────`);
    console.log(sample.message);
  }
  console.log("\nDRY RUN — nothing queued. Re-run with --send.");
} else if (!rows.length) {
  console.log("\nNothing to queue.");
} else {
  const { error: qErr } = await sb.from("sportsyou_outbox").insert(rows);
  console.log(qErr ? `Queueing failed: ${qErr.message}`
    : `\nQueued ${rows.length} posts. Nothing is public yet — run the SportsYou bookmarklet from a logged-in tab to post them.`);
}
