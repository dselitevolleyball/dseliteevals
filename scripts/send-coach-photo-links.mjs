// Give every coach their own photo upload link — HQ notification + email.
//
// Coaches take as many of the season's good photos as anyone, and until now
// the upload page only took families. Each coach's link is their own
// (coach_roster.photo_upload_token): uploads are credited to them, and the
// form offers only the teams they coach, then that team's tournaments.
//
// The same link is on their home page in the app, so the email is the
// introduction rather than the only way back.
//
// DRY RUN BY DEFAULT.
//
// Usage:
//   node scripts/send-coach-photo-links.mjs
//   node scripts/send-coach-photo-links.mjs --test drew@dselitevolleyball.com
//   node scripts/send-coach-photo-links.mjs --send
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const PLACEHOLDER = /^(tbd|tba|n\/a|na|none|pending|sub|open|needed|\?+|-+|—)$/i;
const isPlaceholder = (c) => { const s = String(c || "").trim(); return !s || PLACEHOLDER.test(s) || /new coach|floater coach|assistant coach$/i.test(s); };
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const args = process.argv.slice(2);
const doSend = args.includes("--send");
const ti = args.indexOf("--test"); const testTo = ti >= 0 ? args[ti + 1] : null;

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [{ data: teams }, { data: roster, error }, { data: accounts }] = await Promise.all([
  sb.from("practice_teams").select("team_name, head_coach, assistant_coach, third_coach"),
  sb.from("coach_roster").select("first_name, last_name, email, photo_upload_token"),
  sb.from("coaches").select("display_name, email"),
]);
if (error) { console.error(error.message + " — has migrations/20260912_coach_photo_links.sql been run?"); process.exit(1); }

const rosterBy = new Map((roster || []).map(r => [norm(`${r.first_name || ""} ${r.last_name || ""}`), r]));
const acctEmail = new Map((accounts || []).map(a => [norm(a.display_name), String(a.email || "").trim().toLowerCase()]));

// Everyone coaching a team, once each, with the teams they coach.
const people = new Map();
for (const t of teams || []) for (const n of [t.head_coach, t.assistant_coach, t.third_coach]) {
  if (isPlaceholder(n)) continue;
  const k = norm(n);
  if (!people.has(k)) people.set(k, { name: String(n).trim(), teams: [] });
  people.get(k).teams.push(t.team_name);
}

const jobs = [...people.values()].sort((a, b) => a.name.localeCompare(b.name)).map(p => {
  const r = rosterBy.get(norm(p.name));
  const email = String(r?.email || acctEmail.get(norm(p.name)) || "").trim().toLowerCase();
  const link = r?.photo_upload_token ? `${APP}/photos?t=${r.photo_upload_token}` : null;
  return { ...p, email: EMAIL_RE.test(email) ? email : null, link };
});

const build = (j) => {
  const first = j.name.split(/\s+/)[0];
  const teamsLine = j.teams.sort().join(", ");
  const subject = "Your own link for team photos";
  const text = `Hi ${first},

You take some of the best photos of the season — from the bench, at practice, in the hotel lobby. This is your own link to send them straight into the club's photo library:

${j.link}

It's also on your home page in the app now, under "Send us your photos".

HOW IT WORKS

  - Pick the team — only the teams you coach are listed (${teamsLine}).
  - Say where they're from: a tournament from that team's schedule, practice, or a team event.
  - Choose as many as you like — up to 40 at a time, videos too, straight from your phone.

They're credited to you and filed by team and event, so we can find the right ones for social media and the end-of-season video. Send everything — if a family has asked us not to post their daughter, we take care of that before anything goes out.

Bookmark it. The link is yours all season.

— Drew`;

  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:580px">'
    + `<p style="margin:0 0 14px">Hi ${esc(first)},</p>`
    + `<p style="margin:0 0 16px">You take some of the best photos of the season &mdash; from the bench, at practice, in the hotel lobby. This is your own link to send them straight into the club&rsquo;s photo library:</p>`
    + `<p style="margin:0 0 8px"><a href="${j.link}" style="display:inline-block;background:#e91e8c;color:#fff;padding:13px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">Upload photos &rarr;</a></p>`
    + `<p style="margin:0 0 18px;font-size:12px;color:#666">It&rsquo;s also on your home page in the app now, under <b>Send us your photos</b>.</p>`
    + `<p style="margin:0 0 8px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">How it works</p>`
    + `<ul style="margin:0 0 16px;padding-left:20px">`
    + `<li style="margin-bottom:6px">Pick the team &mdash; only the teams you coach are listed (${esc(teamsLine)}).</li>`
    + `<li style="margin-bottom:6px">Say where they&rsquo;re from: a tournament from that team&rsquo;s schedule, practice, or a team event.</li>`
    + `<li>Choose as many as you like &mdash; up to 40 at a time, videos too, straight from your phone.</li>`
    + `</ul>`
    + `<p style="margin:0 0 14px">They&rsquo;re credited to you and filed by team and event, so we can find the right ones for social media and the end-of-season video. <b>Send everything</b> &mdash; if a family has asked us not to post their daughter, we take care of that before anything goes out.</p>`
    + `<p style="margin:0 0 14px">Bookmark it. The link is yours all season.</p>`
    + `<p style="margin:0">&mdash; Drew</p></div>`;
  return { subject, text, html,
    push: { title: "Your own link for team photos", body: "Send your photos straight into the club library — it's on your home page now.", url: j.link } };
};

const sendable = jobs.filter(j => j.email && j.link);
const missing = jobs.filter(j => !sendable.includes(j));
console.log(`${jobs.length} coaches · ${sendable.length} ready` + (missing.length
  ? ` · can't send: ${missing.map(j => j.name + (j.link ? " (no email)" : " (no roster row / link)")).join(", ")}` : ""));

const email = async (j, to, subjectPrefix = "") => {
  const b = build(j);
  const r = await fetch(APP + "/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: subjectPrefix + b.subject, body: b.text, bodyHtml: b.html, recipients: [to], skipPush: true,
      sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script" }) });
  const o = await r.json().catch(() => ({})); return r.ok && !o.error ? null : (o.error || r.status);
};

if (testTo) {
  // Drew's own link, so clicking through the test uploads nothing in anyone
  // else's name.
  const me = sendable.find(j => j.email === SENDER.email) || sendable[0];
  const err = await email(me, testTo, "[TEST] ");
  console.log(err ? "FAILED: " + err : `test sent to ${testTo} — ${me.name}'s link`);
} else if (!doSend) {
  const j = sendable[0];
  console.log("\nTO: " + j.email + "\nSUBJECT: " + build(j).subject + "\n" + "─".repeat(64) + "\n" + build(j).text + "\n\nDRY RUN — nothing sent.");
} else {
  let sent = 0, pushed = 0, failed = 0;
  for (const j of sendable) {
    try {
      const pr = await fetch(APP + "/api/send-push", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...build(j).push, skipEmail: true, sentBy: SENDER.name, audience: { type: "email", email: j.email } }) });
      const po = await pr.json().catch(() => ({})); if (pr.ok && po.sent) pushed += po.sent;
    } catch { /* the email still goes */ }
    const err = await email(j, j.email);
    if (err) { failed++; console.error("FAILED " + j.name + ": " + err); continue; }
    sent++; console.log("sent " + j.name.padEnd(22) + "→ " + j.email);
  }
  console.log(`\nDone. ${sent} emailed, ${pushed} notifications, ${failed} failed.`);
}
