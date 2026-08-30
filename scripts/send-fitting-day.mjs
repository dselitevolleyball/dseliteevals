// Fitting day: one email per athlete carrying her own order link, and one
// SportsYou post per team carrying that team's window.
//
// The email is per-PLAYER because the link is — it opens her order and nothing
// else, so it can't go in a team post. The SportsYou post is the same
// information minus the link, for the families who read the app and not email.
//
// The windows below are the ones already posted on 23 August. They are repeated
// verbatim rather than recalculated, because a family who wrote theirs on the
// fridge a week ago should not find it has quietly moved.
//
// DRY RUN BY DEFAULT. Nothing is emailed and nothing is queued until --send.
//
// Usage:
//   node scripts/send-fitting-day.mjs                    # dry run, both channels
//   node scripts/send-fitting-day.mjs --team "14 Ruby"   # dry run, one team
//   node scripts/send-fitting-day.mjs --emails-only
//   node scripts/send-fitting-day.mjs --sportsyou-only
//   node scripts/send-fitting-day.mjs --send             # do it
//
// SportsYou has no postable API — the queue is drained by the bookmarklet in a
// logged-in tab (api/sportsyou-outbox.js), so --send only QUEUES those.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { GEAR_TEAMS } from "../shared/gear-teams.js";

const APP_URL = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const PHONE = "512-202-9099";
const WHEN = "today, Sunday August 30";
const WHERE = "the DSSC Warehouse — 15113 Fitzhugh Rd, Suite 1400";
const DOORS = "2:30pm";
const CLOSE = "7:30pm";
const TERMINAL = ["declined", "not_invited", "opted_out"];

// As posted on 23 August. Every team on the gear list has one.
const WINDOWS = {
  "12 Ruby": "2:30–3:00pm", "13 Sapphire": "2:30–3:00pm", "14 Sapphire": "2:30–3:00pm",
  "11 Diamond": "3:00–3:30pm", "12 Diamond": "3:00–3:30pm", "13 Ruby": "3:00–3:30pm",
  "14 Topaz": "4:15–4:45pm", "15 Emerald": "4:15–4:45pm",
  "13 Emerald": "4:45–5:15pm", "14 Emerald": "4:45–5:15pm",
  "14 Diamond": "5:00–5:30pm", "15 Diamond": "5:00–5:30pm",
  "13 Diamond": "5:30–6:00pm",
  "14 Ruby": "6:30–7:00pm", "15 Ruby": "6:30–7:00pm",
  "15 Sapphire": "6:30–7:00pm", "16 Diamond": "6:30–7:00pm",
};

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
const onlyTeam = value("team");
const emailsOnly = flag("emails-only");
const syOnly = flag("sportsyou-only");
const doEmails = !syOnly;
const doSy = !emailsOnly;

const env = loadEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: players, error } = await supabase.from("players")
  .select("id, first_name, last_name, team_assignment, roster_status, season, offer_status," +
    "parent_name, parent_email, parent_email2, parent_email3, gear_form_token")
  .order("team_assignment");
if (error) { console.error("Load players failed:", error.message); process.exit(1); }

const targets = (players || []).filter(p =>
  p.roster_status === "active" && (p.season || "2026-27") === "2026-27" &&
  !TERMINAL.includes(p.offer_status || "") &&
  GEAR_TEAMS.includes(p.team_assignment) &&
  (!onlyTeam || p.team_assignment === onlyTeam));

const emailsOf = (p) => [...new Set([p.parent_email, p.parent_email2, p.parent_email3]
  .map(e => String(e || "").trim().toLowerCase()).filter(Boolean))];
// "Hi Paul," when we know a parent's name, "Hi," when we don't — never "Hi
// Saunders family," which reads like a mail merge because it is one.
const greeting = (p) => {
  const first = String(p.parent_name || "").trim().split(/\s+/)[0];
  return first ? "Hi " + first + "," : "Hi,";
};

// The shared middle of both messages: why a parent has to be there, and what
// happens at the table. Written once so the email and the post can't drift.
const theRules = (team) => `${team}'s window: ${WINDOWS[team] || "—"}

We're open from ${DOORS} and fitting right through until ${CLOSE}, so come earlier than your window if that's easier — we're open for business all afternoon. If you're running late, text me at ${PHONE} and we'll make sure someone is there for you.

A parent needs to come with their athlete.

This is our one chance to get her sizes right. Once the order is placed, a jersey that doesn't fit has to be reordered and we have to charge for the replacement — and the same goes for a jersey that's lost, stolen or damaged. A few minutes with her at the table today avoids all of it.

How it works: your athlete tries on each piece herself — jersey, warm-up tee, practice shirt, hoodie, spandex, joggers, kneepads, socks, arm sleeves and shoes. There are two bathrooms to change in. Have her wear something easy to change over.`;

const bodyFor = (p) => `${greeting(p)}

Jersey fittings are ${WHEN} at ${WHERE}.

${theRules(p.team_assignment)}

Before you come, please open ${p.first_name}'s form:

${APP_URL}/gear?t=${p.gear_form_token}

That link is hers, so there's nothing to log into. There are a few things on it we need you to confirm or fill in — the spelling of her last name, her jersey number and team, both parents' names, phone numbers and emails, and her own number if she has one. You can do it before you arrive or at the table.

Looking forward to seeing everyone today!

Drew Rose
DS Elite Volleyball
${PHONE}`;

// The same email as real HTML, because /api/send-email escapes plain text into
// a pre-wrap div and never builds an <a href>. Gmail and Apple Mail linkify a
// bare URL on their own; enough clients don't that on a 349-address send some
// families get a link they can only copy by hand — which reads as "the link
// was cut off". A button removes the question.
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const para = (s) => `<p style="margin:0 0 14px">${esc(s).replace(/\n/g, "<br>")}</p>`;

const htmlFor = (p) => {
  const link = `${APP_URL}/gear?t=${p.gear_form_token}`;
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:560px">
${para(greeting(p))}
${para(`Jersey fittings are ${WHEN} at ${WHERE}.`)}
<p style="margin:0 0 14px;font-size:17px"><b>${esc(p.team_assignment)}'s window: ${esc(WINDOWS[p.team_assignment] || "—")}</b></p>
${para(`We're open from ${DOORS} and fitting right through until ${CLOSE}, so come earlier than your window if that's easier — we're open for business all afternoon. If you're running late, text me at ${PHONE} and we'll make sure someone is there for you.`)}
<p style="margin:0 0 8px"><b>A parent needs to come with their athlete.</b></p>
${para("This is our one chance to get her sizes right. Once the order is placed, a jersey that doesn't fit has to be reordered and we have to charge for the replacement — and the same goes for a jersey that's lost, stolen or damaged. A few minutes with her at the table today avoids all of it.")}
${para("How it works: your athlete tries on each piece herself — jersey, warm-up tee, practice shirt, hoodie, spandex, joggers, kneepads, socks, arm sleeves and shoes. There are two bathrooms to change in. Have her wear something easy to change over.")}
${para(`Before you come, please open ${p.first_name}'s form:`)}
<p style="margin:0 0 8px"><a href="${link}" style="display:inline-block;background:#e91e8c;color:#fff;padding:13px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">Open ${esc(p.first_name)}'s form →</a></p>
<p style="margin:0 0 18px;font-size:12px;color:#666">If the button doesn't work, copy this into your browser:<br><span style="word-break:break-all">${esc(link)}</span></p>
${para("That link is hers, so there's nothing to log into. There are a few things on it we need you to confirm or fill in — the spelling of her last name, her jersey number and team, both parents' names, phone numbers and emails, and her own number if she has one. You can do it before you arrive or at the table.")}
${para("Looking forward to seeing everyone today!")}
<p style="margin:0">Drew Rose<br>DS Elite Volleyball<br>${PHONE}</p>
</div>`;
};

const syFor = (team) => `Hi ${team} families,

Jersey fittings are ${WHEN} at ${WHERE}.

${theRules(team)}

Check your email — each athlete has her own order link, and there are a few questions on it we need you to confirm or fill in before her gear is ordered. You can do it at the table if you haven't already.

Looking forward to seeing everyone today!

— Drew, DS Elite`;

// ── Build the work ──────────────────────────────────────────────────────────
const jobs = targets.map(p => ({
  p, recipients: emailsOf(p),
  subject: `${p.first_name}'s jersey fitting today — ${WINDOWS[p.team_assignment] || ""} at the warehouse`,
  body: bodyFor(p),
  bodyHtml: htmlFor(p),
})).filter(j => j.recipients.length && j.p.gear_form_token);

const noEmail = targets.filter(p => !emailsOf(p).length);
const noToken = targets.filter(p => !p.gear_form_token);
const teams = GEAR_TEAMS.filter(t => !onlyTeam || t === onlyTeam);
const noWindow = teams.filter(t => !WINDOWS[t]);

console.log(`${targets.length} athletes in scope` + (onlyTeam ? ` (${onlyTeam})` : "") +
  ` across ${teams.length} teams`);
if (doEmails) console.log(`${jobs.length} emails, ${new Set(jobs.flatMap(j => j.recipients)).size} distinct addresses`);
if (doSy) console.log(`${teams.length} SportsYou posts to queue`);
if (noWindow.length) console.log(`\n⚠ no fitting window for: ${noWindow.join(", ")}`);
if (noToken.length) {
  console.log(`\n⚠ ${noToken.length} with no order link — they get no email:`);
  noToken.forEach(p => console.log("   " + p.first_name + " " + p.last_name + " (" + p.team_assignment + ")"));
}
if (noEmail.length) {
  console.log(`\n⚠ ${noEmail.length} with NO parent email on file — chase another way:`);
  noEmail.forEach(p => console.log("   " + p.first_name + " " + p.last_name + " (" + p.team_assignment + ")"));
}

const byTeam = {};
jobs.forEach(j => { (byTeam[j.p.team_assignment] = byTeam[j.p.team_assignment] || []).push(j); });
console.log("");
Object.keys(byTeam).sort().forEach(t =>
  console.log("   " + t.padEnd(14) + String(byTeam[t].length).padStart(2) + " emails   " + (WINDOWS[t] || "—")));

// --preview-html <file> writes the first email exactly as a family's mail
// client will render it. Generated by the same htmlFor() that sends, so what
// you approve is what goes out.
const previewPath = value("preview-html");
if (previewPath && jobs.length) {
  writeFileSync(previewPath,
    `<html><body style="background:#f4f4f5;margin:0;padding:24px">
     <div style="background:#fff;border-radius:10px;padding:22px;max-width:600px;margin:0 auto">
     <div style="font:13px sans-serif;color:#666;border-bottom:1px solid #eee;padding-bottom:10px;margin-bottom:16px">
       <b>To:</b> ${jobs[0].recipients.join(", ")}<br><b>Subject:</b> ${jobs[0].subject}</div>
     ${jobs[0].bodyHtml}</div></body></html>`);
  console.log("Preview written to " + previewPath);
}

if (!doSend) {
  if (doEmails && jobs.length) {
    console.log("\n─── first email, in full ───────────────────────────────");
    console.log("To:      " + jobs[0].recipients.join(", "));
    console.log("Subject: " + jobs[0].subject + "\n");
    console.log(jobs[0].body);
  }
  if (doSy) {
    console.log("\n─── SportsYou post for " + teams[0] + " ─────────────────────");
    console.log(syFor(teams[0]));
  }
  console.log("\n────────────────────────────────────────────────────────");
  console.log("DRY RUN — nothing sent, nothing queued. Re-run with --send.");
} else {
  if (doSy) {
    const batch = "fitting-day-" + WHEN.replace(/[^0-9a-z]+/gi, "-").toLowerCase();
    const rows = teams.map(t => ({
      team_name: t, subject: "Jersey fittings today", message: syFor(t),
      status: "pending", queued_by: SENDER.name, batch_id: batch,
    }));
    const { error: qErr } = await supabase.from("sportsyou_outbox").insert(rows);
    if (qErr) console.error("Queueing SportsYou posts failed:", qErr.message);
    else console.log(`Queued ${rows.length} SportsYou posts — run the bookmarklet in a logged-in SportsYou tab to post them.`);
  }

  if (doEmails) {
    let sent = 0, failed = 0;
    for (const job of jobs) {
      const res = await fetch(APP_URL + "/api/send-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: job.subject, body: job.body, bodyHtml: job.bodyHtml,
          recipients: job.recipients,
          sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script",
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) {
        failed++;
        console.error("FAILED " + job.p.first_name + " " + job.p.last_name + ": " + (out.error || res.status));
        continue;
      }
      sent++;
      console.log("sent " + (job.p.first_name + " " + job.p.last_name).padEnd(24) + "→ " + job.recipients.join(", "));
    }
    console.log(`\nDone. ${sent} emailed, ${failed} failed.`);
  }
}
