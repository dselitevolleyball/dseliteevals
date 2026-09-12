// The commitment link and the team photo link, to the families of one age group.
//
// Generalised from the 14s send on 11 September. Each age group gets this on
// its own orientation night, so the script takes the group and when it lands.
//
// TIMING CHANGES THE WORDING. The commitment page is built to be signed on a
// phone during the 6:00 meeting, so an email that arrives at 6:15 says "open it
// now and follow along". One that arrives the next afternoon cannot — those
// families were either there and signed, or weren't and still need to. Pass
// --when after and the copy changes to match; getting this wrong tells half the
// club to do something they already did.
//
// One email per family, to every parent address on file. Both links are the
// PLAYER's own: the commitment token signs for her and nobody else, and the
// photo token files uploads under her team and her family's name.
//
// Rise and event teams (14 Crystal) are left out — event teams' girls already
// get this through their home teams. --rise includes Rise if ever needed.
//
// DRY RUN BY DEFAULT.
//
// Usage:
//   node scripts/send-commitment.mjs --age 15
//   node scripts/send-commitment.mjs --age 15 --test drew@dselitevolleyball.com
//   node scripts/send-commitment.mjs --age 15 --send --at "2026-09-12T18:15:00-05:00"
//   node scripts/send-commitment.mjs --age 16 --when after --send --at "2026-09-13T14:00:00-05:00"
//   node scripts/send-commitment.mjs --teams "15 Ruby,15 Emerald" ...
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { isEventTeam } from "../shared/event-teams.js";

const APP = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const TERMINAL = ["declined", "not_invited", "opted_out"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const norm = (s) => String(s || "").trim().toLowerCase();
const isRise = (t) => /\brise\b/i.test(String(t || ""));
const PLACEHOLDER = /^(tbd|tba|n\/a|na|none|pending|sub|open|needed|\?+|-+|—)$/i;
// Addresses held back until someone confirms them. The commitment link can sign
// for the girl, so a mistyped address hands that to a stranger.
// alexandrov@gmail.com — Avery's second parent; a bare-surname Gmail is almost
// certainly somebody else's, and Kristen still receives it.
const HOLD = new Set(["alexandrov@gmail.com"]);
// Staff whose family-facing address is the club one, not the personal address
// the roster holds for payroll and travel. Drew's call for Kristen.
const CLUB_EMAIL = { "kristen alexandrov": "kristen@dselitevolleyball.com" };

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const value = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const doSend = flag("send"), testTo = value("test"), sendAt = value("at");
const onlyPlayer = value("player"), age = value("age"), teamsArg = value("teams");
const when = (value("when") || "tonight").toLowerCase();      // tonight | after
if (!["tonight", "after"].includes(when)) { console.error("--when must be tonight or after"); process.exit(1); }
if (!age && !teamsArg) { console.error("Give --age 15 or --teams \"15 Ruby,15 Emerald\""); process.exit(1); }

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const [{ data: allTeams }, { data: coachRoster }] = await Promise.all([
  sb.from("practice_teams").select("team_name, practices_per_week, head_coach, assistant_coach, third_coach"),
  sb.from("coach_roster").select("first_name, last_name, phone, email"),
]);

const TEAMS = (teamsArg ? teamsArg.split(",").map(s => s.trim()).filter(Boolean)
  : (allTeams || []).filter(t => String(t.team_name).trim().split(/\s+/)[0] === String(age).trim()).map(t => t.team_name))
  .filter(name => {
    const row = (allTeams || []).find(t => t.team_name === name);
    if (isEventTeam(row)) { console.log("skipping event team " + name); return false; }
    if (isRise(name) && !flag("rise")) { console.log("skipping " + name + " (Rise — pass --rise to include)"); return false; }
    return true;
  }).sort();
if (!TEAMS.length) { console.error("No teams matched."); process.exit(1); }

const { data: players, error } = await sb.from("players")
  .select("id, first_name, last_name, team_assignment, offer_status, parent_name, parent2_name, parent_email, parent_email2, parent_email3, commitment_token, photo_upload_token")
  .in("team_assignment", TEAMS);
if (error) { console.error(error.message); process.exit(1); }

const rosterBy = new Map((coachRoster || []).map(r => [norm(`${r.first_name || ""} ${r.last_name || ""}`.trim()), r]));
const fmtPhone = (p) => {
  const d = String(p || "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? { show: `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`, tel: "+1" + d } : null;
};
const coachesFor = (team) => {
  const t = (allTeams || []).find(x => x.team_name === team);
  if (!t) return [];
  return [["Head coach", t.head_coach], ["Assistant coach", t.assistant_coach], ["Coach", t.third_coach]]
    .filter(([, n]) => n && !PLACEHOLDER.test(String(n).trim()))
    .map(([role, n]) => {
      const r = rosterBy.get(norm(n));
      const email = String(CLUB_EMAIL[norm(n)] || r?.email || "").trim().toLowerCase();
      return { role, name: String(n).trim(), phone: fmtPhone(r?.phone), email: EMAIL_RE.test(email) ? email : null };
    });
};

const roster = (players || [])
  .filter(p => !TERMINAL.includes(p.offer_status || ""))
  .filter(p => !onlyPlayer || norm(p.first_name + " " + p.last_name) === norm(onlyPlayer))
  .sort((a, b) => a.team_assignment.localeCompare(b.team_assignment) || a.last_name.localeCompare(b.last_name));

const firstName = (full) => String(full || "").trim().split(/\s+/)[0] || "";
const greetingFor = (p) => {
  const names = [...new Set([firstName(p.parent_name), firstName(p.parent2_name)].filter(Boolean))];
  return names.length ? "Hi " + names.join(" and ") + "," : "Hi,";
};

// preview=true swaps in the sample pages, which render the real layout but save
// nothing — a test email is opened and clicked by staff, and on a real token
// that click signs a real girl's commitment.
const build = (p, { preview = false } = {}) => {
  const girl = p.first_name.trim();
  const commit = preview ? `${APP}/commitment?preview=1` : `${APP}/commitment?t=${p.commitment_token}`;
  const photos = preview ? `${APP}/photos?preview=1` : `${APP}/photos?t=${p.photo_upload_token}`;
  const greet = greetingFor(p);
  const coaches = coachesFor(p.team_assignment);
  const live = when === "tonight";

  const opener = live
    ? `We're going through the DS Elite commitment together at orientation tonight, and ${girl} and you will each sign it. This is ${girl}'s own link:`
    : `We went through the DS Elite commitment together at orientation last night. ${girl} and you each sign it, and this is ${girl}'s own link:`;
  const third = live
    ? `If you're at orientation, open it now and follow along with us. If you couldn't make it tonight, sign whenever you're ready — the link keeps working.`
    : `If you both signed last night, thank you — there's nothing more to do. If you didn't finish, or you couldn't be there, the link is open and works whenever you're ready.`;

  const text = `${greet}

${opener}

${commit}

How it works:
  - Two signatures. ${girl} signs her side and a parent signs yours — separately, in your own names, on the same link. Either can go first.
  - Every point has to be ticked before that side saves.
  - ${third}

TEAM PHOTOS

Second link — this one is for photos of ${p.team_assignment}:

${photos}

Everyone can and should upload. Pick the tournament from the dropdown and add as many as you like at once, from your phone or your computer. They build the team's library for the season and are what we use on social media. Bookmark it — it's the same link all year.

YOUR ${p.team_assignment.toUpperCase()} COACHES

${coaches.map(c => `  ${c.name} — ${c.role}\n    ${[c.phone?.show, c.email].filter(Boolean).join("  ·  ") || "contact via the club"}`).join("\n\n")}

Thank you.

— Drew`;

  const btn = (href, label) =>
    `<p style="margin:0 0 8px"><a href="${href}" style="display:inline-block;background:#e91e8c;color:#fff;padding:13px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">${label} &rarr;</a></p>`
    + `<p style="margin:0 0 18px;font-size:12px;color:#666">If the button doesn&rsquo;t work, copy this into your browser:<br><span style="word-break:break-all">${href}</span></p>`;

  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:600px">'
    + `<p style="margin:0 0 14px">${esc(greet)}</p>`
    + `<p style="margin:0 0 16px">${esc(opener)}</p>`
    + btn(commit, `Open ${esc(girl)}&rsquo;s commitment`)
    + `<p style="margin:0 0 8px"><b>How it works</b></p>`
    + `<ul style="margin:0 0 20px;padding-left:20px">`
    + `<li style="margin-bottom:6px"><b>Two signatures.</b> ${esc(girl)} signs her side and a parent signs yours &mdash; separately, in your own names, on the same link. Either can go first.</li>`
    + `<li style="margin-bottom:6px">Every point has to be ticked before that side saves.</li>`
    + `<li>${esc(third)}</li>`
    + `</ul>`
    + `<p style="margin:26px 0 10px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">Team photos</p>`
    + `<p style="margin:0 0 16px">Second link &mdash; this one is for photos of <b>${esc(p.team_assignment)}</b>:</p>`
    + btn(photos, `Upload ${esc(p.team_assignment)} photos`)
    + `<p style="margin:0 0 14px"><b>Everyone can and should upload.</b> Pick the tournament from the dropdown and add as many as you like at once, from your phone or your computer. They build the team&rsquo;s library for the season and are what we use on social media. Bookmark it &mdash; it&rsquo;s the same link all year.</p>`
    + `<p style="margin:26px 0 10px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">Your ${esc(p.team_assignment)} coaches</p>`
    + `<table style="border-collapse:collapse;width:100%;font-size:14px;margin:0 0 20px">`
    + coaches.map(c =>
        `<tr><td style="padding:9px 0;border-bottom:1px solid #eee;vertical-align:top">`
        + `<b style="font-size:15px">${esc(c.name)}</b><br><span style="color:#777;font-size:13px">${esc(c.role)}</span></td>`
        + `<td style="padding:9px 0 9px 12px;border-bottom:1px solid #eee;text-align:right;vertical-align:top;line-height:1.7">`
        + (c.phone ? `<a href="tel:${c.phone.tel}" style="color:#1a1a1a;text-decoration:none;font-weight:600">${c.phone.show}</a><br>` : "")
        + (c.email ? `<a href="mailto:${esc(c.email)}" style="color:#c2186f;text-decoration:none">${esc(c.email)}</a>` : "")
        + (!c.phone && !c.email ? `<span style="color:#777">contact via the club</span>` : "")
        + `</td></tr>`).join("")
    + `</table>`
    + `<p style="margin:0 0 14px">Thank you.</p>`
    + '<p style="margin:0">&mdash; Drew</p></div>';

  return {
    subject: (live ? "Tonight: " : "") + `${girl}'s DS Elite commitment, and your team photo link`,
    text, html,
  };
};

const jobs = roster.map(p => {
  const to = [...new Set([p.parent_email, p.parent_email2, p.parent_email3]
    .map(e => String(e || "").trim().toLowerCase()).filter(e => EMAIL_RE.test(e) && !HOLD.has(e)))];
  return { p, to, ...build(p) };
});
const sendable = jobs.filter(j => j.to.length && j.p.commitment_token && j.p.photo_upload_token);
const skipped = jobs.filter(j => !sendable.includes(j));

const byTeam = {};
for (const j of sendable) byTeam[j.p.team_assignment] = (byTeam[j.p.team_assignment] || 0) + 1;
console.log(`${TEAMS.join(", ")}\n${sendable.length} families · ${sendable.reduce((n, j) => n + j.to.length, 0)} parent addresses · wording: ${when}`);
for (const t of TEAMS) console.log("   " + t.padEnd(12) + (byTeam[t] || 0));
if (skipped.length) console.log("⚠ cannot send: " + skipped.map(j => j.p.first_name + " " + j.p.last_name).join(", "));

const allIds = [];
const send = async (j, recipients) => {
  const r = await fetch(APP + "/api/send-email", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: j.subject, body: j.text, bodyHtml: j.html, recipients,
      ...(sendAt && !testTo ? { scheduledAt: sendAt, skipPush: true } : {}),
      sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script" }),
  });
  const o = await r.json().catch(() => ({}));
  if (Array.isArray(o.ids)) allIds.push(...o.ids);
  return r.ok && !o.error ? null : (o.error || String(r.status));
};

if (testTo) {
  const j = sendable[0];
  const err = await send({ ...j, ...build(j.p, { preview: true }), subject: "[TEST] " + j.subject }, [testTo]);
  console.log(err ? "FAILED: " + err : `test sent to ${testTo} — ${j.p.first_name}'s wording, preview links`);
} else if (!doSend) {
  const j = sendable[0];
  if (j) {
    console.log("\n" + "─".repeat(72) + "\nTO: " + j.to.join(", ") + "\nSUBJECT: " + j.subject + "\n" + "─".repeat(72));
    console.log(j.text);
  }
  console.log("\nDRY RUN — nothing sent. --test <email> to see it, --send to send" + (sendAt ? ` (queued for ${sendAt})` : "") + ".");
} else {
  let sent = 0, failed = 0;
  for (const j of sendable) {
    const err = await send(j, j.to);
    if (err) { failed++; console.error("FAILED " + j.p.first_name + " " + j.p.last_name + ": " + err); continue; }
    sent++;
    console.log((sendAt ? "queued " : "sent ") + j.p.team_assignment.padEnd(12) + (j.p.first_name + " " + j.p.last_name).padEnd(24) + "→ " + j.to.join(", "));
  }
  if (sendAt && allIds.length) {
    const f = new URL(`../scheduled-${sendAt.slice(0, 10)}-commitment-${age || "teams"}.json`, import.meta.url);
    writeFileSync(f, JSON.stringify({ sendAt, teams: TEAMS, ids: allIds }, null, 2));
    console.log(`\n${allIds.length} messages held by Resend until ${sendAt}. Ids saved for cancelling.`);
  }
  console.log(`\nDone. ${sent} families ${sendAt ? "queued" : "emailed"}, ${failed} failed.`);
}
