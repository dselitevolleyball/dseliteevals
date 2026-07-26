// Seeds the per-coach "Season Update" staff email template.
//
// Companion to the per-team parent template: same season information, plus the
// staff-only parts — the practices each coach was auto-assigned to cover, and
// the tournaments their team plays without them because they're booked with
// another team that weekend.
//
// Every section is written as "heading + lead-in ending with a colon", blank
// line, then the merge field alone on its own line. That shape is what lets
// applyMerge() drop a section entirely for a coach it doesn't apply to.
//
// Usage: node scripts/seed-coach-update-template.mjs

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error("Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env"); process.exit(1); }

const NAME = "Season Update — Coaches (per-coach staff email)";
const SUBJECT = "{{COACH}} — your season schedule, sub shifts & tournaments";

const BODY = `Hi {{COACH}},

We just sent families their season update — tournament schedule, practice times, coaching coverage and Speed & Agility. This is your version of it, built from your own assignments, plus the staff-only detail that families don't see. Everything below is specific to you, so please read all the way down — anything that needs something from you is in here.

1) YOUR TEAMS
You're rostered as:

{{MY_ROLES}}

2) YOUR PRACTICE SCHEDULE
Your regular-season practices, starting Nov 29:

{{MY_PRACTICES}}

These individual dates shift from the times above:

{{MY_SCHEDULE_CHANGES}}

3) YOUR TOURNAMENTS
This is still tentative — each event is confirmed once we're officially accepted — but we expect the final schedule to be very close to this. A ✓ means it's locked in. Anything marked "covering" is a team you're helping, not your own:

{{MY_TOURNAMENTS}}

4) TOURNAMENTS YOUR TEAM PLAYS WITHOUT YOU
There are weekends where the schedule needed you in two places at once. Where that happened we kept you with one team and covered the other spot, rather than split you across both. Some of these were genuinely close calls — if you think we got one wrong, tell me now rather than in April. These are the ones that affect you:

{{MY_TOURNAMENT_GAPS}}

5) PRACTICES YOU'RE COVERING FOR OTHER TEAMS
Our goal is two coaches at every practice. On tournament weekends that isn't automatic, because coaches travel — so the gaps were filled by assigning coaches already on site before or after their own practice. Please treat these exactly like your own practices. If one genuinely doesn't work, don't just miss it: open it in the app and hit "Can't make it" so it moves to the open-shift board for another coach to pick up. A released shift gets covered — a silent no-show leaves a team with one coach. You were assigned these:

{{MY_SUB_SHIFTS}}

6) YOUR PRACTICES SOMEONE ELSE IS COVERING
You're away for these, and they're already covered:

{{MY_COVERED}}

7) SPEED & AGILITY
The second block runs December through April, one hour directly before or after practice. Your teams' sessions:

{{MY_SA}}

All of this is on your SportsYou calendar and in the app, and both update automatically if anything changes.

If something here is wrong, or you have a conflict I don't know about, reply to this email and tell me as early as you can — the further out we catch it, the easier it is to fix.

Thanks for everything you're putting into this season.

Drew`;

const supabase = createClient(url, key, { auth: { persistSession: false } });
const { error } = await supabase.from("email_templates")
  .upsert({ name: NAME, subject: SUBJECT, body: BODY, updated_at: new Date().toISOString() }, { onConflict: "name" });
if (error) { console.error("Failed:", error.message); process.exit(1); }
console.log(`Saved template: ${NAME}`);
console.log(`  subject: ${SUBJECT}`);
console.log(`  body:    ${BODY.length} chars, ${BODY.split("\n\n").length} paragraphs`);
