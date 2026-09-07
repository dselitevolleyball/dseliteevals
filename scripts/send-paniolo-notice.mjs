// December schedule notice for the three teams heading to the West Coast NQ.
//
// Two different messages, because the two audiences are in different positions:
//   14 Diamond + 15 Diamond — Paniolo is step one of Paniolo -> Fast Warm Up -> Anaheim.
//   14 Ruby                 — Paniolo REPLACES December Dash, and is their only
//                             step up before Anaheim (they skip Fast Warm Up).
//
// DRY RUN BY DEFAULT.
//   node scripts/send-paniolo-notice.mjs            # dry run
//   node scripts/send-paniolo-notice.mjs --send     # actually send
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP_URL = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const KRISTEN = "kristen@dselitevolleyball.com";
const TERMINAL = ["declined", "not_invited", "opted_out"];
const DIAMONDS = ["14 Diamond", "15 Diamond"];
const RUBY = ["14 Ruby"];

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
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: players, error } = await sb.from("players")
  .select("team_assignment, offer_status, parent_email, parent_email2, parent_email3")
  .in("team_assignment", [...DIAMONDS, ...RUBY]);
if (error) { console.error(error.message); process.exit(1); }

const live = players.filter(p => !TERMINAL.includes(String(p.offer_status || "").trim()));
const emailsFor = (teams) => {
  const s = new Set();
  for (const p of live.filter(x => teams.includes(x.team_assignment)))
    for (const e of [p.parent_email, p.parent_email2, p.parent_email3])
      if (e && e.trim()) s.add(e.trim());
  return [...s];
};

const DIAMOND_SUBJECT = "New tournament added — Paniolo Power Play, Dec 5-6 in Fort Worth";
const DIAMOND_TEXT = `Hi 14 Diamond and 15 Diamond families,

We've added a tournament to the December schedule: the Paniolo Power Play, Saturday and Sunday, December 5-6, in Fort Worth, at Game On Sports Complex and All Saints' Episcopal School.

I want to explain how this fits, because it isn't a one-off — it's the first step of a build.

Our first qualifier is the West Coast Juniors National Qualifier in Anaheim, January 9-11. That's earlier in the season than we've chased a qualifier before, and it's the most important weekend on our calendar. You don't arrive at something like that ready by practicing your way into it. You get there by climbing.

So December is three steps, each a level up on the last:

  Dec 5-6 — Paniolo Power Play, Fort Worth. Two full days against teams we never see. 14 Diamond plays 14U; 15 Diamond plays up into the 16U division. Both in Club divisions.

  Dec 12-13 — Fast Warm Up, Houston. Both teams are in the Open division — the top flight, and the hardest competition either team will have faced. Paniolo is what gets us ready to belong there.

  Jan 9-11 — West Coast Juniors National Qualifier, Anaheim. Everything above points here.

Each weekend is meant to make the next one survivable. By the time we land in Anaheim, these teams will have two hard tournaments behind them instead of a long stretch of gym time — and that difference shows up in the first set on day one.

DATES AND TRAVEL — please read this part:

  - Dec 5-6 (Sat-Sun), Fort Worth. Roughly a 3.5-4 hour drive. We're arranging a club hotel block and will send details shortly, so hold off booking rooms.
  - Dec 11-13, Houston. Play is Saturday and Sunday, but we travel Friday, Dec 11 — that's a school day, so plan on your daughter missing it.
  - These are back-to-back travel weekends. Get them on the calendar now.
  - Match schedules and courts come out closer to each event and we'll pass them along.

If either weekend is a problem for your family, tell your coach now so we can plan rosters properly.

These are the weekends that decide what January looks like. Excited to get after it.

Drew Rose
Director, DS Elite Volleyball`;

const RUBY_SUBJECT = "Schedule change for December — Paniolo Power Play instead of December Dash";
const RUBY_TEXT = `Hi 14 Ruby families,

We're making a change to the December schedule. 14 Ruby will play the Paniolo Power Play in Fort Worth on December 5-6, instead of December Dash in Buda.

I want to be straight about why, because I'm asking you to trade an easy local Saturday for a weekend on the road.

This team is going to the West Coast Juniors National Qualifier in Anaheim, January 9-11. That's our first qualifier of the season and the biggest thing on the calendar. Between now and then, 14 Ruby has one opportunity to get real competition under them — and December Dash, close and convenient as it is, isn't the level that prepares anyone for Anaheim.

Paniolo is. Two full days, teams we never see, in a field that will test this group. It's one hard weekend instead of one comfortable one, and it's the difference between arriving in January ready and arriving hopeful.

WHAT TO KNOW:

  - Saturday and Sunday, December 5-6, Fort Worth — roughly a 3.5-4 hour drive.
  - This replaces December Dash. Nothing else on the December calendar changes.
  - We're arranging a club hotel block and will send details shortly — hold off booking rooms.
  - Coach Jayden and Coach Rene are both with the team for the weekend.
  - Match schedules and courts come out closer to the date.

If that weekend is a genuine problem for your family, tell Coach Jayden now so we can plan the roster properly.

This is the right weekend for where this team is headed. Looking forward to it.

Drew Rose
Director, DS Elite Volleyball`;

const html = (t) => "<div style=\"font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a\">"
  + t.split("\n\n").map(p => "<p style=\"margin:0 0 14px\">" + p.replace(/\n/g, "<br>") + "</p>").join("") + "</div>";

const batches = [
  { label: "14 Diamond + 15 Diamond", subject: DIAMOND_SUBJECT, text: DIAMOND_TEXT, recipients: emailsFor(DIAMONDS) },
  { label: "14 Ruby",                 subject: RUBY_SUBJECT,    text: RUBY_TEXT,    recipients: emailsFor(RUBY) },
];

const doSend = process.argv.includes("--send");
for (const b of batches) {
  console.log(`\n═══ ${b.label} — ${b.recipients.length} recipients ═══`);
  console.log("Subject: " + b.subject);
  if (!doSend) { console.log(b.recipients.join(", ")); continue; }
  const res = await fetch(APP_URL + "/api/send-email", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: b.subject, body: b.text, bodyHtml: html(b.text),
      recipients: b.recipients, replyTo: KRISTEN,
      sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script",
    }),
  });
  const out = await res.json().catch(() => ({}));
  console.log(out.error ? ("FAILED: " + out.error)
    : `Sent ${out.sent} of ${b.recipients.length}${out.failed?.length ? ", " + out.failed.length + " failed" : ""}.`);
}
if (!doSend) console.log("\nDRY RUN — nothing sent. Re-run with --send.");
