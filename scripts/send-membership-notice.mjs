// The Lone Star / USAV membership notice: every non-Rise parent, and a post on
// every non-Rise SportsYou team.
//
// Rise is excluded on both channels, the same call the gear order and the
// kickoff check-in make. Rise plays the in-house tournament only, so a regional
// membership is not something those families need to buy.
//
// DRY RUN BY DEFAULT.
//
// Usage:
//   node scripts/send-membership-notice.mjs               # dry run
//   node scripts/send-membership-notice.mjs --send        # email + queue posts
//   node scripts/send-membership-notice.mjs --emails-only
//   node scripts/send-membership-notice.mjs --sportsyou-only
//
// SportsYou has no postable API, so --send only QUEUES those; the bookmarklet
// in a logged-in tab drains the queue (api/sportsyou-outbox.js).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP_URL = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const LINK = "https://memberships.sportsengine.com/org/lone-star-region-volleyball/affiliation/ds-elite-volleyball-ds-elite";
const KRISTEN = "kristen@dselitevolleyball.com";
const TERMINAL = ["declined", "not_invited", "opted_out"];
const isRise = (t) => /\brise\b/i.test(String(t || ""));

function loadEnv() {
  const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const doSend = flag("send");
const emailsOnly = flag("emails-only");
const syOnly = flag("sportsyou-only");
const doEmails = !syOnly;
const doSy = !emailsOnly;

const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const [{ data: players, error: pErr }, { data: teams }] = await Promise.all([
  sb.from("players").select("id, first_name, last_name, team_assignment, roster_status, season, offer_status, parent_email, parent_email2, parent_email3"),
  sb.from("practice_teams").select("team_name"),
]);
if (pErr) { console.error("Load players failed:", pErr.message); process.exit(1); }

const roster = (players || []).filter(p =>
  p.roster_status === "active" && (p.season || "2026-27") === "2026-27" &&
  String(p.team_assignment || "").trim() && !isRise(p.team_assignment) &&
  !TERMINAL.includes(p.offer_status || ""));

const recipients = [...new Set(roster.flatMap(p =>
  [p.parent_email, p.parent_email2, p.parent_email3]
    .map(e => String(e || "").trim().toLowerCase()).filter(Boolean)))];

const noEmail = roster.filter(p =>
  ![p.parent_email, p.parent_email2, p.parent_email3].some(e => String(e || "").trim()));

const syTeams = (teams || []).map(t => t.team_name).filter(t => !isRise(t)).sort();

// ── The message ─────────────────────────────────────────────────────────────
const STEPS = [
  "Click Get Started",
  "Select your player's profile",
  'When the "Invite a Parent/Guardian" popup appears, click Skip for now',
  'Select "Player/Athlete" and click Next',
  'Select "26-27 LoneStar Junior Player" and click Next',
  "Complete the rest of the prompts, accept the liability waivers, and click through to the summary page",
  'Review your club assignment (should be "DS Elite Volleyball") and make payment — total fees should be $55 for Lone Star and USAV memberships.',
  "Click through to SportsEngine and confirm it shows your player as Eligible for the 26-27 Season.",
];

const text = `Hi DS Elite Family!

It is time to secure your player's Lone Star and USAV volleyball memberships for the '26-27 season. This is required for every player in order to compete at tournaments in our region — we cannot officially roster your player to a team without it.

Please use this link and purchase your memberships as soon as possible:

${LINK}

${STEPS.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Please reach out to Coach Kristen if you have any issues or questions — ${KRISTEN}.

Thank you!`;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:600px">'
  + '<p style="margin:0 0 14px">Hi DS Elite Family!</p>'
  + '<p style="margin:0 0 14px">It is time to secure your player&rsquo;s <b>Lone Star and USAV volleyball memberships</b> for the &rsquo;26-27 season. This is required for every player in order to compete at tournaments in our region &mdash; we cannot officially roster your player to a team without it.</p>'
  + '<p style="margin:0 0 14px">Please use this link and purchase your memberships as soon as possible:</p>'
  + `<p style="margin:0 0 8px"><a href="${LINK}" style="display:inline-block;background:#e91e8c;color:#fff;padding:13px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">Buy the memberships &rarr;</a></p>`
  + `<p style="margin:0 0 18px;font-size:12px;color:#666">If the button doesn&rsquo;t work, copy this into your browser:<br><span style="word-break:break-all">${esc(LINK)}</span></p>`
  + '<ol style="margin:0 0 16px;padding-left:22px">'
  + STEPS.map(s => `<li style="margin-bottom:7px">${esc(s)}</li>`).join("")
  + '</ol>'
  + `<p style="margin:0 0 14px">Please reach out to Coach Kristen if you have any issues or questions &mdash; <a href="mailto:${KRISTEN}" style="color:#c2186f">${KRISTEN}</a>.</p>`
  + '<p style="margin:0">Thank you!</p></div>';

// SportsYou strips links unreliably, so the URL goes in as plain text on its
// own line rather than dressed up as something to tap.
const syText = `Hi ${"{TEAM}"} families,

It is time to secure your player's Lone Star and USAV volleyball memberships for the '26-27 season. This is required for every player in order to compete at tournaments in our region — we cannot officially roster your player to a team without it.

Please purchase as soon as possible:

${LINK}

${STEPS.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Please reach out to Coach Kristen if you have any issues or questions — ${KRISTEN}.

Thank you!`;

console.log(`${roster.length} players on ${new Set(roster.map(p => p.team_assignment)).size} non-Rise teams`);
if (doEmails) console.log(`${recipients.length} distinct parent addresses`);
if (doSy) console.log(`${syTeams.length} SportsYou posts to queue: ${syTeams.join(", ")}`);
if (noEmail.length) {
  console.log(`\n⚠ ${noEmail.length} with NO parent email — they only get the SportsYou post:`);
  noEmail.forEach(p => console.log("   " + p.first_name + " " + p.last_name + " (" + p.team_assignment + ")"));
}

if (!doSend) {
  console.log("\n─── the email ──────────────────────────────────────────");
  console.log("Subject: Action needed: Lone Star + USAV memberships for '26-27\n");
  console.log(text);
  console.log("\n─── the SportsYou post (11 Diamond shown) ──────────────");
  console.log(syText.replace("{TEAM}", "11 Diamond"));
  console.log("\nDRY RUN — nothing sent, nothing queued. Re-run with --send.");
} else {
  if (doSy) {
    const rows = syTeams.map(t => ({
      team_name: t, subject: "Lone Star + USAV memberships",
      message: syText.replace("{TEAM}", t),
      status: "pending", queued_by: SENDER.name, batch_id: "memberships-2026-09",
    }));
    const { error } = await sb.from("sportsyou_outbox").insert(rows);
    console.log(error ? ("Queueing failed: " + error.message)
      : `Queued ${rows.length} SportsYou posts — run the bookmarklet to post them.`);
  }
  if (doEmails) {
    const res = await fetch(APP_URL + "/api/send-email", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: "Action needed: Lone Star + USAV memberships for '26-27",
        body: text, bodyHtml: html, recipients,
        replyTo: KRISTEN,
        sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script",
      }),
    });
    const out = await res.json().catch(() => ({}));
    console.log(out.error ? ("Email FAILED: " + out.error)
      : `Emailed ${out.sent} of ${recipients.length}${out.failed?.length ? ", " + out.failed.length + " failed" : ""}.`);
  }
}
