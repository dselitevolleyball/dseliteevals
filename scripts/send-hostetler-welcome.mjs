// Everything the Hostetler family needs for both girls, in one email (Oct 7 2026):
// Charlie (11 Rise) and Brooklyn (13 Rise) — SportsYou codes, Rise orientation and
// uniform try-ons this Sunday (Oct 11), coaches, practice, and the to-dos.
//
// DRY RUN BY DEFAULT.
//   node scripts/send-hostetler-welcome.mjs --test drew@dselitevolleyball.com
//   node scripts/send-hostetler-welcome.mjs --send

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const WAREHOUSE = "DSSC Warehouse, 15113 Fitzhugh Rd, Suite 1400, Dripping Springs";
const RISE_CAMP = "https://drippingsports.playbookapi.com/programs/more_info/class_package/77559/";
const LONESTAR = "https://memberships.sportsengine.com/org/lone-star-region-volleyball/affiliation/ds-elite-volleyball-ds-elite";
const CODES = { "11 Rise 1": "NJ7E-CSBS", "13 Rise 1": "Q4DXFDN6" };
const PLAYER_IDS = [439, 438]; // Charlie (11 Rise), Brooklyn (13 Rise)
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const testTo = val("test"), doSend = args.includes("--send");
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: kids } = await sb.from("players").select("id, first_name, last_name, team_assignment, parent_name, parent2_name, parent_email, parent_email2, gear_form_token").in("id", PLAYER_IDS);
const teamsWanted = [...new Set(kids.map(k => k.team_assignment))];
const [{ data: teams }, { data: coaches }, { data: pas }] = await Promise.all([
  sb.from("practice_teams").select("team_name, head_coach, assistant_coach, third_coach").in("team_name", teamsWanted),
  sb.from("coach_roster").select("first_name, last_name, email, phone"),
  sb.from("practice_assignments").select("team_name, day, slot").in("team_name", teamsWanted).eq("phase", "season"),
]);
const ordered = PLAYER_IDS.map(id => kids.find(k => k.id === id));

const phone = (s) => { const x = String(s || "").replace(/\D/g, "").slice(-10); return x.length === 10 ? `(${x.slice(0, 3)}) ${x.slice(3, 6)}-${x.slice(6)}` : ""; };
const nm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const hr = (n) => (Number(n) === 12 ? 12 : Number(n) + 12), clock = (h) => (h > 12 ? h - 12 : h);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const schedFor = (team) => pas.filter(p => p.team_name === team).sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day))
  .map(p => { const m = /^(\d{1,2})\s*-\s*(\d{1,2})/.exec(p.slot); return m ? `${p.day} ${clock(hr(m[1]))}-${clock(hr(m[2]))}pm` : null; }).filter(Boolean);
const coachLines = (team) => { const t = teams.find(x => x.team_name === team) || {};
  return [["Head coach", t.head_coach], ["Assistant coach", t.assistant_coach], ["Coach", t.third_coach]].filter(([, n]) => n).map(([role, n]) => {
    const r = coaches.find(x => nm(x.first_name + x.last_name) === nm(n));
    return `${n} - ${role}${r?.phone ? " · " + phone(r.phone) : ""}${r?.email ? " · " + r.email.toLowerCase() : ""}`;
  }); };
const short = (team) => team.replace(/ 1$/, "");
const [c, b] = ordered.map(k => k.first_name.trim());
const both = `${c} and ${b}`;

const greet = "Hi Rachel and Kenny,";
const subject = `${both}: SportsYou, Sunday's orientation and everything for the season`;
const intro = [
  `Here's everything in one place for both girls: ${c} is on ${short(ordered[0].team_assignment)} and ${b} is on ${short(ordered[1].team_assignment)}.`,
  `The big one is this Sunday, October 11: Rise orientation and uniform try-ons. It's mandatory for both girls.`,
];
const blocks = [
  ["This Sunday, October 11 - Rise orientation (mandatory)", [
    `At the ${WAREHOUSE}.`,
    `11:30am - jersey and uniform try-ons (both girls get fitted).`,
    `12:00pm - orientation, the DS Elite commitment, and team time. We'll be done by 1:00pm.`,
    `Both girls are required, with a parent for the first part: the commitment is signed by the player and a parent, and it's where we walk families through the season.`,
    `Bring knee pads and a water bottle, and a pink DS Elite shirt if they have one.`,
  ]],
  ["SportsYou - join both teams", [
    `SportsYou is how we reach you: practice reminders, schedule changes and the team calendar all live there.`,
    `Download the free SportsYou app (App Store or Google Play) or go to sportsyou.com, and create an account in your own name.`,
    ...ordered.map(k => `${short(k.team_assignment)} (${k.first_name.trim()}): join code ${CODES[k.team_assignment]}`),
    `Tap the + or "Join a team" and enter each code. Join both, since the girls are on different teams.`,
  ]],
  ...ordered.map(k => [`${k.first_name.trim()}'s ${short(k.team_assignment)} coaches`, coachLines(k.team_assignment)]),
  ["Practice", [
    ...ordered.map(k => `${short(k.team_assignment)} (${k.first_name.trim()}): ${schedFor(k.team_assignment).join(" · ")}`),
    `Season practices start the weekend after Thanksgiving.`,
    `Until then, every Rise player is welcome at Rise Fall Camp on Saturdays at the Warehouse - a great way to get going and meet teammates. Sign up: ${RISE_CAMP}`,
  ]],
  ["Tournaments", [`About six tournaments across the season for each Rise team - four one-day and two two-day events - finishing at Lone Star Regionals. They'll show up on each team's SportsYou calendar as they're confirmed.`]],
  ["To-do list", [
    `Lone Star + USAV membership ($55 each) is required before a player can be rostered or play a tournament: ${LONESTAR}`,
    ...ordered.filter(k => k.gear_form_token).map(k => `${k.first_name.trim()}'s player details and uniform sizes: ${APP}/gear?t=${k.gear_form_token}`),
    `Our club shoe is the Avoli Mid Supersonic Pink, out in November - please wait for our word before buying. Any white volleyball shoe works until then.`,
    `Club logos for spirit wear: ${APP}/logos`,
  ]],
];
const outro = `We're so glad to have both girls with us. Any questions at all, just reply to this email.`;
const link = (s) => esc(s).replace(/(https?:\/\/\S+)/g, '<a href="$1" style="color:#c2186f">$1</a>');
const text = `${greet}\n\n${intro.join("\n\n")}\n\n` + blocks.map(([h, items]) => `${h.toUpperCase()}\n${items.map(i => "  • " + i).join("\n")}`).join("\n\n") + `\n\n${outro}\n\nSee you on the court,\n\nDrew Rose\nDirector, DS Elite`;
const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:620px">'
  + `<p style="margin:0 0 14px">${esc(greet)}</p>` + intro.map(x => `<p style="margin:0 0 14px">${esc(x)}</p>`).join("")
  + blocks.map(([h, items]) => `<p style="margin:24px 0 6px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">${esc(h)}</p><ul style="margin:0 0 10px;padding-left:20px">${items.map(i => `<li style="margin-bottom:5px">${link(i)}</li>`).join("")}</ul>`).join("")
  + `<p style="margin:20px 0 0">${esc(outro)}</p><p style="margin:14px 0 0">See you on the court,</p><p style="margin:10px 0 0">Drew Rose<br>Director, DS Elite</p></div>`;

const to = [...new Set(kids.flatMap(k => [k.parent_email, k.parent_email2]).map(e => String(e || "").trim().toLowerCase()).filter(Boolean))];
console.log("To:", to.join(", "), "\nSubject:", subject, "\n\n" + text);
const send = async (recipients) => {
  const r = await fetch(APP + "/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject, body: text, bodyHtml: html, recipients, replyTo: SENDER.email, sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script", skipPush: true }) });
  const o = await r.json().catch(() => ({}));
  return r.ok && !o.error ? null : (o.error || String(r.status));
};
if (testTo) console.log("\nTEST →", testTo, (await send([testTo])) || "sent");
else if (doSend) console.log("\nSEND →", to.join(", "), (await send(to)) || "sent");
else console.log("\n(dry run)");
