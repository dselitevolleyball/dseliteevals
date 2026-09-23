// "Join your team on SportsYou" — one email per family, with that team's own
// join code and the steps to use it.
//
// SportsYou is where practice reminders, schedule changes and the team calendar
// live, so a family that never joins is a family that misses everything.
//
// Codes come from practice_teams.sportsyou_code, falling back to the map below
// (same list the app uses). A team with no code is refused rather than emailed
// a blank — a code has to exist in SportsYou first.
//
// DRY RUN BY DEFAULT.
//   node scripts/send-sportsyou-invite.mjs --teams "11 Rise 1,12 Rise 1"
//   node scripts/send-sportsyou-invite.mjs --teams "11 Rise 1" --test drew@dselitevolleyball.com
//   node scripts/send-sportsyou-invite.mjs --teams "11 Rise 1,12 Rise 1" --send

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const TERMINAL = ["declined", "not_invited", "opted_out"];
const CODES = {
  "11 Rise 1": "NJ7E-CSBS", "13 Rise 1": "Q4DXFDN6", "11 Diamond": "BZVJ-FHLM", "12 Diamond": "TNCX-ZP4W", "12 Ruby": "XJAV-9C6Y",
  "12 Rise 1": "XP88-JSA6", "13 Diamond": "88KA-EFHZ", "13 Ruby": "QEZQ-T36X", "13 Sapphire": "KEZ4-V9F9",
  "13 Emerald": "AQS2-MFTK", "14 Diamond": "RNDK-87KK", "14 Ruby": "B8P3-B5YY", "14 Sapphire": "NN4H-3KPP",
  "14 Emerald": "2CUF-EANL", "14 Topaz": "UYVD-WHUF", "15 Diamond": "VGUK-USAL", "15 Ruby": "NVL3-ML7Z",
  "15 Sapphire": "7NPR-Z9SC", "15 Emerald": "MX88-D7R9", "16 Diamond": "JJT2-MYX3", "17 Diamond": "LSQ5-ZACW",
};

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const testTo = val("test"), doSend = args.includes("--send");
const TEAMS = String(val("teams") || "").split(",").map(s => s.trim()).filter(Boolean);
if (!TEAMS.length) { console.error('--teams "11 Rise 1,12 Rise 1"'); process.exit(1); }

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [{ data: players }, { data: teams }, { data: roster }] = await Promise.all([
  sb.from("players").select("first_name, last_name, team_assignment, offer_status, parent_name, parent2_name, parent_email, parent_email2, parent_email3")
    .in("team_assignment", TEAMS).eq("season", "2026-27"),
  sb.from("practice_teams").select("team_name, head_coach, assistant_coach, third_coach").in("team_name", TEAMS),
  sb.from("coach_roster").select("first_name, last_name, email, phone"),
]);
const codeFor = (team) => CODES[team] || null;
const missing = TEAMS.filter(t => !codeFor(t));
if (missing.length) { console.error("No SportsYou code for: " + missing.join(", ") + " — create the group in SportsYou first, then set practice_teams.sportsyou_code."); process.exit(1); }

const nm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const phone = (s) => { const x = String(s || "").replace(/\D/g, "").slice(-10); return x.length === 10 ? `(${x.slice(0, 3)}) ${x.slice(3, 6)}-${x.slice(6)}` : ""; };
const listOf = (xs) => xs.length === 1 ? xs[0] : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];

const build = (p) => {
  const girl = p.first_name.trim();
  const team = p.team_assignment.replace(/ 1$/, "");
  const code = codeFor(p.team_assignment);
  const t = teams.find(x => x.team_name === p.team_assignment) || {};
  const coaches = [t.head_coach, t.assistant_coach, t.third_coach].filter(Boolean).map(n => {
    const r = roster.find(x => nm(x.first_name + x.last_name) === nm(n));
    return `${n}${r?.phone ? " · " + phone(r.phone) : ""}`;
  });
  const parents = [...new Set([p.parent_name, p.parent2_name].map(x => String(x || "").trim().split(/\s+/)[0]).filter(Boolean))];
  const greet = parents.length ? "Hi " + listOf(parents) + "," : "Hi,";
  const intro = [
    `One thing to set up before the season: please join ${team} on SportsYou. It's how we reach you — practice reminders, schedule changes, last-minute news — and it carries the team calendar, so every practice, tournament and event shows up on your phone.`,
    `${team}'s join code is ${code}`,
  ];
  const blocks = [
    ["How to join", [
      `Download the free SportsYou app (App Store or Google Play), or go to sportsyou.com.`,
      `Create an account — use your own name, not ${girl}'s, so we know who we're talking to.`,
      `Tap the + or "Join a team" and enter the code: ${code}`,
      `That's it. You'll see ${team}'s posts and calendar straight away.`,
    ]],
    ["Worth doing while you're in there", [
      `Turn notifications ON. Schedule changes go out here first.`,
      `Add the team calendar to your phone's calendar so practices and tournaments land in your own diary.`,
      `${girl} can have her own account and join with the same code — most of our players do.`,
    ]],
  ];
  if (coaches.length) blocks.push([`Your ${team} coaches`, coaches]);
  const outro = `If the code doesn't work or you get stuck, just reply to this email and we'll sort it out.`;

  const text = `${greet}\n\n${intro.join("\n\n")}\n\n`
    + blocks.map(([h, items]) => `${h.toUpperCase()}\n${items.map((i, n2) => (h === "How to join" ? `  ${n2 + 1}. ` : "  • ") + i).join("\n")}`).join("\n\n")
    + `\n\n${outro}\n\nSee you on the court,\n\nDrew Rose\nDirector, DS Elite`;
  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:620px">'
    + `<p style="margin:0 0 14px">${esc(greet)}</p>`
    + `<p style="margin:0 0 16px">${esc(intro[0])}</p>`
    + `<p style="margin:0 0 6px;font-size:13px;color:#666">${esc(team)} join code</p>`
    + `<p style="margin:0 0 18px;font-size:30px;font-weight:800;letter-spacing:.06em;color:#c2186f">${esc(code)}</p>`
    + blocks.map(([h, items]) => `<p style="margin:22px 0 6px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">${esc(h)}</p>`
        + (h === "How to join"
          ? `<ol style="margin:0 0 10px;padding-left:22px">${items.map(i => `<li style="margin-bottom:6px">${esc(i)}</li>`).join("")}</ol>`
          : `<ul style="margin:0 0 10px;padding-left:20px">${items.map(i => `<li style="margin-bottom:5px">${esc(i)}</li>`).join("")}</ul>`)).join("")
    + `<p style="margin:20px 0 0">${esc(outro)}</p><p style="margin:14px 0 0">See you on the court,</p><p style="margin:10px 0 0">Drew Rose<br>Director, DS Elite</p></div>`;
  return { subject: `Join ${team} on SportsYou — code ${code}`, text, html };
};

const jobs = [];
for (const p of players.filter(x => !TERMINAL.includes(x.offer_status || ""))) {
  const to = [...new Set([p.parent_email, p.parent_email2, p.parent_email3].map(e => String(e || "").trim().toLowerCase()).filter(e => EMAIL_RE.test(e)))];
  if (!to.length) { console.error(`NO EMAIL: ${p.first_name} ${p.last_name} (${p.team_assignment})`); continue; }
  jobs.push({ p, to, ...build(p) });
}
jobs.sort((a, b) => a.p.team_assignment.localeCompare(b.p.team_assignment) || a.p.last_name.localeCompare(b.p.last_name));

const send = async (m, recipients) => {
  const r = await fetch(APP + "/api/send-email", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: m.subject, body: m.text, bodyHtml: m.html, recipients, replyTo: SENDER.email,
      sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script", skipPush: true }),
  });
  const o = await r.json().catch(() => ({}));
  return r.ok && !o.error ? null : (o.error || String(r.status));
};

console.log(`${jobs.length} emails`);
for (const t of TEAMS) console.log(`  ${t.padEnd(12)} ${codeFor(t)}  ${jobs.filter(j => j.p.team_assignment === t).length} families`);

if (testTo) {
  const err = await send({ ...jobs[0], subject: "[TEST] " + jobs[0].subject }, [testTo]);
  console.log(err ? "FAILED: " + err : `test sent (${jobs[0].p.first_name}, ${jobs[0].p.team_assignment})`);
} else if (doSend) {
  let ok = 0;
  for (const j of jobs) {
    const err = await send(j, j.to);
    if (err) console.error(`FAILED ${j.p.first_name} ${j.p.last_name}: ${err}`);
    else { ok++; console.log(`sent ${j.p.team_assignment.padEnd(12)} ${(j.p.first_name + " " + j.p.last_name).padEnd(22)} → ${j.to.join(", ")}`); }
  }
  console.log(`\n${ok}/${jobs.length} sent`);
} else {
  console.log("\n" + "═".repeat(72) + `\n${jobs[0].p.first_name} ${jobs[0].p.last_name} → ${jobs[0].to.join(", ")}\nSUBJECT: ${jobs[0].subject}\n` + "─".repeat(72) + "\n" + jobs[0].text);
  console.log("\nDRY RUN — --test <email> or --send.");
}
