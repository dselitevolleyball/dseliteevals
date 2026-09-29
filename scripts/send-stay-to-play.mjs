// Email every current family Drew's Stay to Play letter, with the season's
// Stay to Play tournaments and the ones their daughter's team is entered in.
//
// One email per household: siblings who share a parent address get one
// message naming each girl's team. Event-only teams (practices_per_week = 0,
// e.g. 14 Crystal) are left out, as with every team communication.
//
// The tournament list is Drew's (29 Sep 2026): Countdown City Classic, Red
// Rock Rave, Music City, Lone Star Classic, Lone Star Regionals, West Coast
// Qualifier. Which weekend each team plays comes from tournament_assignments.
//
// DRY RUN BY DEFAULT.
//   node scripts/send-stay-to-play.mjs                         # who + first email
//   node scripts/send-stay-to-play.mjs --show "Mia Paz"        # that family's email
//   node scripts/send-stay-to-play.mjs --test drew@dselitevolleyball.com --send
//   node scripts/send-stay-to-play.mjs --send
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP_URL = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const TERMINAL_OFFER = ["declined", "not_invited", "opted_out"];

// Each event, the tournaments rows that make it up. Only the weekends a family's team is entered in appear in its email.
const EVENTS = [
  { key: "countdown", title: "Countdown City Classic", ids: [256], when: "Jan 9–10, San Antonio" },
  { key: "westcoast", title: "West Coast Qualifier", ids: [471], when: "Jan 9–11, Anaheim" },
  { key: "musiccity", title: "Music City", ids: [206], when: "Jan 29–31, New Orleans" },
  { key: "redrock", title: "Red Rock Rave", ids: [184, 205], when: "Mar 5–7 or Apr 23–25, Las Vegas" },
  { key: "lonestar", title: "Lone Star Classic", ids: [192, 482, 196, 483, 484, 485, 200], when: "April weekends in Dallas, Oklahoma City and Houston" },
  { key: "regionals", title: "Lone Star Regionals", ids: [211, 212], when: "May 8–9 or May 15–16, Houston" },
];

function loadEnv() {
  const env = {};
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const value = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const doSend = flag("send"), testTo = value("test"), show = value("show");

const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const allIds = EVENTS.flatMap(e => e.ids);
const { data: tourns } = await sb.from("tournaments").select("id,start_date,end_date,location,cancelled").in("id", allIds);
const { data: assigns } = await sb.from("tournament_assignments").select("tournament_id,team_id").in("tournament_id", allIds);
const { data: pteams } = await sb.from("practice_teams").select("team_name,practices_per_week");
const eventTeams = new Set((pteams || []).filter(t => t.practices_per_week === 0).map(t => t.team_name));
const tById = new Map(tourns.map(t => [t.id, t]));
const missing = allIds.filter(id => !tById.has(id));
if (missing.length) { console.error("Tournament rows not found:", missing.join(", ")); process.exit(1); }

const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dates = (t) => {
  const [, m1, d1] = t.start_date.split("-").map(Number), [, m2, d2] = t.end_date.split("-").map(Number);
  return mon[m1 - 1] + " " + d1 + "–" + (m1 === m2 ? d2 : mon[m2 - 1] + " " + d2);
};
const city = (t) => String(t.location || "").replace(/,.*$/, "");

// team → [{ title, dates, city }]
const byTeam = new Map();
for (const e of EVENTS) for (const id of e.ids) {
  const t = tById.get(id);
  if (t.cancelled) continue;
  for (const a of assigns.filter(x => x.tournament_id === id)) {
    if (!byTeam.has(a.team_id)) byTeam.set(a.team_id, []);
    byTeam.get(a.team_id).push({ order: t.start_date, text: `${e.title} (${dates(t)}, ${city(t)})` });
  }
}
for (const list of byTeam.values()) list.sort((a, b) => a.order.localeCompare(b.order));

const { data: players, error } = await sb.from("players")
  .select("id,first_name,last_name,team_assignment,offer_status,parent_name,parent2_name,parent_email,parent_email2,parent_email3");
if (error) { console.error(error.message); process.exit(1); }
const roster = players.filter(p => String(p.team_assignment || "").trim() && !TERMINAL_OFFER.includes(p.offer_status || "") && !eventTeams.has(p.team_assignment));
const emailsOf = (p) => [...new Set([p.parent_email, p.parent_email2, p.parent_email3].map(e => String(e || "").trim().toLowerCase()).filter(Boolean))];

// Households: players joined by any shared parent address.
const parent = new Map();
const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
const union = (a, b) => { parent.set(find(a), find(b)); };
for (const p of roster) { const k = "p" + p.id; parent.set(k, k); for (const e of emailsOf(p)) { if (!parent.has(e)) parent.set(e, e); union(k, e); } }
const houses = new Map();
for (const p of roster) { const r = find("p" + p.id); if (!houses.has(r)) houses.set(r, []); houses.get(r).push(p); }

const firstNames = (ps) => [...new Set(ps.flatMap(p => [p.parent_name, p.parent2_name]).map(x => String(x || "").trim().split(/\s+/)[0]).filter(Boolean))];
// Only the tournaments this family's player(s) are entered in — no club-wide list.
const teamLine = (p, many) => {
  const list = byTeam.get(p.team_assignment) || [];
  const who = many ? `${p.first_name.trim()} (${p.team_assignment})` : `${p.first_name.trim()}'s team, ${p.team_assignment},`;
  return list.length
    ? `${who}${many ? ":" : " is entered in these Stay to Play tournaments:"}\n` + list.map(x => "  - " + x.text).join("\n")
    : `${who}${many ? ": " : " "}isn't entered in any Stay to Play tournaments yet. If that changes, the same rule applies and we'll tell you.`;
};

const section = (kids) => `Which of your tournaments are Stay to Play

${kids.length > 1 ? "Your players are entered in these Stay to Play tournaments:\n\n" : ""}${kids.map(k => teamLine(k, kids.length > 1)).join("\n\n")}${kids.some(k => (byTeam.get(k.team_assignment) || []).length) ? "\n\nWe'll send the housing link for each one as soon as it opens." : ""}`;

const bodyFor = (kids) => `Families,

I want to be direct about Stay to Play, because the rules around it have tightened and the stakes have gone up.

The expectation is simple: every player stays in the hotel the club books. Not a cheaper one down the road, not with family in town, not a different property on the same block. The one we book, through the tournament's housing partner, inside the window they give us.

${section(kids)}

Here's what's at risk, and it isn't the family — it's the team.

If a tournament finds that our roster isn't fully booked through their housing partner, the penalty falls on the whole team. That can mean being pulled from the event. And at a national qualifier, it can mean a bid being revoked after we've already won it. Imagine your daughter's team earning a bid on Sunday afternoon and losing it on Monday because one family booked elsewhere. That's not a hypothetical worst case — it's the enforcement mechanism these events actually use.

That's also why we can't handle this case by case. There's no version where one family opts out and the consequence stays with that family.

What's changed this year.

Several tournaments have moved to new housing operators, and they don't work the way the ones we've dealt with in past seasons did. We've received multiple notices from current providers that they're enforcing requirements more strictly than before. Events are filling to capacity, and Stay to Play has become a significant business for the people running it. The room for informal exceptions that may have existed a few years ago is gone.

Committing isn't enough — you have to book in the window.

This is where it's most likely to go wrong. When we send the housing link, there's a defined period to register, and blocks sell out. A family that intends to book but does it two weeks late can put the team in the same position as a family that never booked at all. When the link comes, book it that week.

And I'll be honest with you about how we feel about it.

We don't like Stay to Play. It isn't cost effective for our families — you're generally paying above market for the room. The penalties are disproportionate and they punish the wrong people. And it takes away our ability to support families differently depending on what each one can afford, which is something we care about a lot.

There's also growing scrutiny of these arrangements, and we're watching whether the framework holds up over time. If it changes, we'll be glad. But we have to operate under the rules as they exist this season, and right now those rules are enforced hard.

So here's what I'm asking.

Book through the link the day it arrives. If there is a genuine reason you can't — a real hardship, a medical situation, something specific — come to me before you book anything else. Sometimes there's a path, sometimes there isn't, but I can only help if I know in advance. What I can't do is fix it after the tournament flags us.

Thank you for taking this seriously. It's an unglamorous piece of a club season, and it's one of the few where one household's decision can cost twelve other kids their weekend.

Drew Rose
Director, DS Elite
512-202-9099`;

const SUBJECT = "Stay to Play — why we can't make exceptions this season";
const jobs = [...houses.values()].map(kids => ({
  kids: kids.sort((a, b) => a.team_assignment.localeCompare(b.team_assignment)),
  recipients: [...new Set(kids.flatMap(emailsOf))],
})).filter(j => j.recipients.length).map(j => ({ ...j, body: bodyFor(j.kids) }));
const noEmail = roster.filter(p => !emailsOf(p).length);

console.log(`${roster.length} current players · ${jobs.length} households · ${new Set(jobs.flatMap(j => j.recipients)).size} addresses`);
console.log(`Left out: event teams ${[...eventTeams].join(", ") || "none"}`);
const perTeam = {};
for (const p of roster) perTeam[p.team_assignment] = (perTeam[p.team_assignment] || 0) + 1;
console.log(Object.keys(perTeam).sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b)).map(t => `${t} ${perTeam[t]}${byTeam.has(t) ? "" : " (no STP events)"}`).join(" · "));
if (noEmail.length) console.log("⚠ no email:", noEmail.map(p => p.first_name + " " + p.last_name + " (" + p.team_assignment + ")").join(", "));
const sibs = jobs.filter(j => j.kids.length > 1);
if (sibs.length) console.log("Siblings in one email:", sibs.map(j => j.kids.map(k => k.first_name + " (" + k.team_assignment + ")").join(" + ")).join("; "));

if (!doSend) {
  const pick = show ? jobs.find(j => j.kids.some(k => (k.first_name + " " + k.last_name).toLowerCase() === show.toLowerCase())) : jobs[0];
  if (pick) {
    console.log("\n─── email ───────────────────────────────────────────");
    console.log("To:      " + pick.recipients.join(", "));
    console.log("Subject: " + SUBJECT + "\n");
    console.log(pick.body);
  }
  console.log("\nDRY RUN — nothing sent.");
  process.exit(0);
}

const list = testTo ? [{ ...(jobs.find(j => j.kids.length > 1) || jobs[0]), recipients: [testTo] }] : jobs;
let sent = 0, failed = 0;
for (const j of list) {
  const res = await fetch(APP_URL + "/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: (testTo ? "[TEST] " : "") + SUBJECT, body: j.body, recipients: j.recipients, replyTo: SENDER.email,
      sentBy: SENDER.name, sentByEmail: SENDER.email, source: testTo ? "script test · stay to play" : "script · stay to play", skipPush: true }) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.error) { failed++; console.error("FAILED " + j.kids.map(k => k.first_name).join("+") + ": " + (out.error || res.status)); continue; }
  sent++;
  console.log("sent " + j.kids.map(k => k.first_name + " " + k.last_name).join(" + ") + " → " + j.recipients.join(", "));
}
console.log(`\nDone. ${sent} sent, ${failed} failed.`);
