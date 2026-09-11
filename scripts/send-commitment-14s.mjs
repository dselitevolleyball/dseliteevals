// The commitment link and the team photo link, to every 14s family — tonight.
//
// The commitment page was built to be signed on a phone in the gym during the
// 6:00 meeting (api/commitment-form.js), which for the 14s is tonight. So this
// has to be in inboxes before the meeting starts, not after it.
//
// One email per family, to every parent address on file. Both links are the
// PLAYER's own: the commitment token can sign for her and nobody else, and the
// photo token files every upload under her team and her family's name, which
// is the "tracking" half of Drew's ask — a photo that arrives attributed and
// tagged to a tournament can be found again; one texted to a coach cannot.
//
// AUDIENCE: 14 Diamond, Emerald, Ruby, Sapphire and Topaz, current roster only.
// Not 14 Rise 1, and never 14 Crystal — an event team, whose girls already get
// this through their home teams (shared/event-teams.js). The team list is
// written out rather than matched on "14 " so a new 14s team has to be added
// here on purpose instead of being swept in.
//
// DRY RUN BY DEFAULT.
//
// Usage:
//   node scripts/send-commitment-14s.mjs                   # counts + one sample
//   node scripts/send-commitment-14s.mjs --player "Hazel Colletti"
//   node scripts/send-commitment-14s.mjs --test drew@dselitevolleyball.com
//   node scripts/send-commitment-14s.mjs --send
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { isEventTeam } from "../shared/event-teams.js";

const APP = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const TEAMS = ["14 Diamond", "14 Emerald", "14 Ruby", "14 Sapphire", "14 Topaz"];
const TERMINAL = ["declined", "not_invited", "opted_out"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const norm = (s) => String(s || "").trim().toLowerCase();

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
const value = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const doSend = flag("send");
const testTo = value("test");
const onlyPlayer = value("player");

const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const [{ data: players, error }, { data: teamRows }] = await Promise.all([
  sb.from("players").select("id, first_name, last_name, team_assignment, offer_status, parent_name, parent2_name, parent_email, parent_email2, parent_email3, commitment_token, photo_upload_token")
    .in("team_assignment", TEAMS),
  sb.from("practice_teams").select("team_name, practices_per_week").in("team_name", TEAMS),
]);
if (error) { console.error(error.message); process.exit(1); }

// Belt and braces: if any of these five were ever turned into an event team,
// it drops out here rather than going to families who no longer play on it.
const eventTeams = new Set((teamRows || []).filter(isEventTeam).map(t => t.team_name));
if (eventTeams.size) console.log("⚠ skipping event team(s): " + [...eventTeams].join(", "));

const roster = (players || [])
  .filter(p => !TERMINAL.includes(p.offer_status || "") && !eventTeams.has(p.team_assignment))
  .filter(p => !onlyPlayer || norm(p.first_name + " " + p.last_name) === norm(onlyPlayer))
  .sort((a, b) => a.team_assignment.localeCompare(b.team_assignment) || a.last_name.localeCompare(b.last_name));

const firstName = (full) => String(full || "").trim().split(/\s+/)[0] || "";
const greetingFor = (p) => {
  const names = [firstName(p.parent_name), firstName(p.parent2_name)].filter(Boolean);
  const uniq = [...new Set(names)];
  return uniq.length ? "Hi " + uniq.join(" and ") + "," : "Hi,";
};

const build = (p) => {
  const girl = p.first_name.trim();
  const commit = `${APP}/commitment?t=${p.commitment_token}`;
  const photos = `${APP}/photos?t=${p.photo_upload_token}`;
  const greet = greetingFor(p);

  const text = `${greet}

Tonight at orientation we go through the DS Elite commitment together, and ${girl} and you will each sign it. This is ${girl}'s own link:

${commit}

How it works:
  - Two signatures. ${girl} signs her side and a parent signs yours — separately, in your own names, on the same link. Either can go first.
  - Every point has to be ticked before that side saves.
  - We walk through it together at 6:00, so have your phone with you. If you don't finish tonight, the link keeps working.

TEAM PHOTOS

Second link — this one is for photos of ${p.team_assignment}:

${photos}

Everyone can and should upload. Pick the tournament from the dropdown and add as many as you like at once, from your phone or your computer. They build the team's library for the season and are what we use on social media. Bookmark it — it's the same link all year.

See you tonight.

— Drew`;

  const btn = (href, label) =>
    `<p style="margin:0 0 8px"><a href="${href}" style="display:inline-block;background:#e91e8c;color:#fff;padding:13px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">${label} &rarr;</a></p>`
    + `<p style="margin:0 0 18px;font-size:12px;color:#666">If the button doesn&rsquo;t work, copy this into your browser:<br><span style="word-break:break-all">${href}</span></p>`;

  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:600px">'
    + `<p style="margin:0 0 14px">${esc(greet)}</p>`
    + `<p style="margin:0 0 16px">Tonight at orientation we go through the DS Elite commitment together, and ${esc(girl)} and you will each sign it. This is ${esc(girl)}&rsquo;s own link:</p>`
    + btn(commit, `Open ${esc(girl)}&rsquo;s commitment`)
    + `<p style="margin:0 0 8px"><b>How it works</b></p>`
    + `<ul style="margin:0 0 20px;padding-left:20px">`
    + `<li style="margin-bottom:6px"><b>Two signatures.</b> ${esc(girl)} signs her side and a parent signs yours &mdash; separately, in your own names, on the same link. Either can go first.</li>`
    + `<li style="margin-bottom:6px">Every point has to be ticked before that side saves.</li>`
    + `<li>We walk through it together at <b>6:00</b>, so have your phone with you. If you don&rsquo;t finish tonight, the link keeps working.</li>`
    + `</ul>`
    + `<p style="margin:26px 0 10px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">Team photos</p>`
    + `<p style="margin:0 0 16px">Second link &mdash; this one is for photos of <b>${esc(p.team_assignment)}</b>:</p>`
    + btn(photos, `Upload ${esc(p.team_assignment)} photos`)
    + `<p style="margin:0 0 14px"><b>Everyone can and should upload.</b> Pick the tournament from the dropdown and add as many as you like at once, from your phone or your computer. They build the team&rsquo;s library for the season and are what we use on social media. Bookmark it &mdash; it&rsquo;s the same link all year.</p>`
    + `<p style="margin:0 0 14px">See you tonight.</p>`
    + '<p style="margin:0">&mdash; Drew</p></div>';

  return { subject: `Tonight: ${girl}'s DS Elite commitment, and your team photo link`, text, html };
};

const jobs = roster.map(p => {
  const to = [...new Set([p.parent_email, p.parent_email2, p.parent_email3]
    .map(e => String(e || "").trim().toLowerCase()).filter(e => EMAIL_RE.test(e)))];
  return { p, to, ...build(p) };
});
const sendable = jobs.filter(j => j.to.length && j.p.commitment_token && j.p.photo_upload_token);
const skipped = jobs.filter(j => !sendable.includes(j));

const byTeam = {};
for (const j of sendable) byTeam[j.p.team_assignment] = (byTeam[j.p.team_assignment] || 0) + 1;
console.log(`${sendable.length} families · ${sendable.reduce((n, j) => n + j.to.length, 0)} parent addresses`);
for (const t of TEAMS) console.log("   " + t.padEnd(12) + (byTeam[t] || 0));
if (skipped.length) console.log("⚠ cannot send: " + skipped.map(j => j.p.first_name + " " + j.p.last_name).join(", "));

const send = async (j, recipients) => {
  const r = await fetch(APP + "/api/send-email", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: j.subject, body: j.text, bodyHtml: j.html, recipients,
      sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script" }),
  });
  const o = await r.json().catch(() => ({}));
  return r.ok && !o.error ? null : (o.error || String(r.status));
};

if (testTo) {
  // A real family's email, links and all, delivered only to the tester — the
  // links work, so do not sign anything on them.
  const j = sendable[0];
  const err = await send(j, [testTo]);
  console.log(err ? "FAILED: " + err : `test sent to ${testTo} (using ${j.p.first_name} ${j.p.last_name}'s links — don't sign on them)`);
} else if (!doSend) {
  const j = sendable[0];
  if (j) {
    console.log("\n" + "─".repeat(72));
    console.log("TO: " + j.to.join(", "));
    console.log("SUBJECT: " + j.subject);
    console.log("─".repeat(72));
    console.log(j.text);
  }
  console.log("\nDRY RUN — nothing sent. --test <email> to see it in an inbox, --send to send.");
} else {
  let sent = 0, failed = 0;
  for (const j of sendable) {
    const err = await send(j, j.to);
    if (err) { failed++; console.error("FAILED " + j.p.first_name + " " + j.p.last_name + ": " + err); continue; }
    sent++;
    console.log("sent " + j.p.team_assignment.padEnd(12) + (j.p.first_name + " " + j.p.last_name).padEnd(24) + "→ " + j.to.join(", "));
  }
  console.log(`\nDone. ${sent} families emailed, ${failed} failed.`);
}
