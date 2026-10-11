// Sunday Oct 11, 2026 (Drew): two sends around the Rise orientation.
//   --group rise   Rise families (11/12/13 Rise): text + email at 12:00pm with
//                  the player's commitment link AND her jersey & gear order link.
//   --group tryon  Everyone else still due a jersey try-on (today 11:30-3, or
//                  Monday 6-8pm): text + email with her jersey & gear order link.
// Drew's rule: any player whose commitment is already complete (player AND
// parent signed) gets nothing from either send. Half-signed players are listed.
// Texts: one per parent phone per player, greeting only that parent ({first}),
// ASCII, under 600 chars, skipping STOP opt-outs. Emails: one per player to every
// parent address. Event teams (14 Crystal) are skipped.
//
// DRY RUN BY DEFAULT.
//   node scripts/send-oct11-commit-tryon.mjs --group rise
//   node scripts/send-oct11-commit-tryon.mjs --group tryon
//   node scripts/send-oct11-commit-tryon.mjs --group rise --send --at 2026-10-11T12:00:00-05:00
//       (emails are held by Resend until --at; texts wait in this process until --at)

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { isEventTeam } from "../shared/event-teams.js";

const APP = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const args = process.argv.slice(2);
const val = (k) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : null; };
const group = val("group"), doSend = args.includes("--send"), at = val("at");
if (!["rise", "tryon"].includes(group)) { console.error("--group rise|tryon"); process.exit(1); }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const RISE = ["11 Rise 1", "12 Rise 1", "13 Rise 1"];
const TERMINAL = ["declined", "not_invited", "opted_out"];
const HOLD = new Set(["alexandrov@gmail.com"]);   // same hold as send-commitment.mjs
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WHERE = "the DSSC Warehouse (15113 Fitzhugh Rd, Suite 1400, Dripping Springs)";
const LONESTAR = "https://memberships.sportsengine.com/org/lone-star-region-volleyball/affiliation/ds-elite-volleyball-ds-elite";

const [{ data: players }, { data: commits }, { data: gear }, { data: teams }, { data: outs }] = await Promise.all([
  sb.from("players").select("id, first_name, last_name, team_assignment, offer_status, parent_name, parent2_name, parent_phone, parent2_phone, parent_email, parent_email2, parent_email3, commitment_token, gear_form_token, jersey_number, sportsengine_registered").eq("season", "2026-27").neq("team_assignment", ""),
  sb.from("player_commitments").select("player_id, player_signed_at, parent_signed_at"),
  sb.from("player_gear_orders").select("player_id, details_confirmed, needs_fitting"),
  sb.from("practice_teams").select("team_name, practices_per_week"),
  sb.from("sms_optouts").select("phone"),
]);
const ascii = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E\n]/g, "");
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const last10 = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const e164 = (p) => { const d = last10(p); return d.length === 10 ? "+1" + d : null; };
const optedOut = new Set((outs || []).map(o => last10(o.phone)));
const teamBy = new Map(teams.map(t => [t.team_name, t]));
const cBy = new Map(commits.map(c => [c.player_id, c]));
const gBy = new Map(gear.map(g => [g.player_id, g]));
const complete = (p) => { const c = cBy.get(p.id); return !!(c && c.player_signed_at && c.parent_signed_at); };
const half = (p) => { const c = cBy.get(p.id); return !!(c && (c.player_signed_at || c.parent_signed_at) && !complete(p)); };
const needsFitting = (p) => { const g = gBy.get(p.id); return !g || !g.details_confirmed || g.needs_fitting; };
const live = players.filter(p => !TERMINAL.includes(p.offer_status || "") && !isEventTeam(teamBy.get(p.team_assignment)));

const pool = group === "rise"
  ? live.filter(p => RISE.includes(p.team_assignment))
  // id 266 is excluded in send-oct11-orientation-texts.mjs's fitting list too.
  : live.filter(p => !RISE.includes(p.team_assignment) && ["made", "accepted", "locked"].includes(p.offer_status) && needsFitting(p) && p.id !== 266);
const skippedDone = pool.filter(complete);
const targets = pool.filter(p => !complete(p)).sort((a, b) => a.team_assignment.localeCompare(b.team_assignment) || a.last_name.localeCompare(b.last_name));

const links = (p) => ({ commit: `${APP}/commitment?t=${p.commitment_token}`, gear: `${APP}/gear?t=${p.gear_form_token}` });
const textFor = (p) => {
  const g = p.first_name.trim(), L = links(p);
  return ascii(group === "rise"
    ? `Hi {first}, here are ${g}'s two links for today's DS Elite orientation:\n1) Commitment - ${g} and a parent each sign it: ${L.commit}\n2) Jersey & gear order - enter her sizes after the try-on: ${L.gear}\n- Drew, DS Elite`
    : `Hi {first}, here is ${g}'s DS Elite jersey & gear order link: ${L.gear}\nBring it up at her jersey try-on (today 11:30am-3pm, or Monday Oct 12, 6-8pm at the DSSC Warehouse, 15113 Fitzhugh Rd, Suite 1400) and enter her sizes once she has tried everything on.\n- Drew, DS Elite`);
};
const greet = (p) => { const n = [...new Set([p.parent_name, p.parent2_name].map(x => String(x || "").trim().split(/\s+/)[0]).filter(Boolean))]; return n.length ? "Hi " + n.join(" and ") + "," : "Hi,"; };
const btn = (href, label) => `<p style="margin:0 0 8px"><a href="${href}" style="display:inline-block;background:#e91e8c;color:#fff;padding:13px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">${label} &rarr;</a></p><p style="margin:0 0 18px;font-size:12px;color:#666">If the button doesn&rsquo;t work, copy this into your browser:<br><span style="word-break:break-all">${href}</span></p>`;
const emailFor = (p) => {
  const g = p.first_name.trim(), L = links(p), hi = greet(p);
  // Only promise a pre-filled number to girls who have one.
  const hasNum = String(p.jersey_number ?? "").trim() !== "";
  const pre = hasNum ? "Her name and number come pre-filled" : "Her name comes pre-filled", preIt = hasNum ? "them" : "it";
  // Non-Rise girls still owe the Lone Star + USAV membership (Rise is exempt).
  const se = !p.sportsengine_registered && !RISE.includes(p.team_assignment);
  const seText = se ? `One more thing: ${g}'s Lone Star + USAV membership isn't done yet. It's $55 through SportsEngine and takes a few minutes, and we need it before we can roster her for tournaments:\n${LONESTAR}\n\n` : "";
  const seHtml = se ? `<p style="margin:0 0 16px">One more thing: ${esc(g)}&rsquo;s Lone Star + USAV membership isn&rsquo;t done yet. It&rsquo;s $55 through SportsEngine and takes a few minutes, and we need it before we can roster her for tournaments:<br><a href="${LONESTAR}" style="color:#c2186f;word-break:break-all">${LONESTAR}</a></p>` : "";
  if (group === "rise") {
    const text = `${hi}\n\nHere are ${g}'s two links for today's DS Elite orientation.\n\n1) ${g}'s commitment\n${L.commit}\n${g} signs her side and a parent signs yours - separately, in your own names, on the same link. Every point has to be ticked before that side saves. We're going through it together at the meeting, so open it now and follow along. If you couldn't be there, sign whenever you're ready; the link keeps working.\n\n2) ${g}'s jersey & gear order\n${L.gear}\nOnce she has tried on the sample jerseys, enter her sizes here. ${pre} - please check ${preIt}.\n\nThank you.\n\n- Drew`;
    const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:600px">'
      + `<p style="margin:0 0 14px">${esc(hi)}</p><p style="margin:0 0 18px">Here are ${esc(g)}&rsquo;s two links for today&rsquo;s DS Elite orientation.</p>`
      + `<p style="margin:0 0 10px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">1 &middot; Commitment</p>` + btn(L.commit, `Open ${esc(g)}&rsquo;s commitment`)
      + `<p style="margin:0 0 20px">${esc(g)} signs her side and a parent signs yours &mdash; separately, in your own names, on the same link. Every point has to be ticked before that side saves. We&rsquo;re going through it together at the meeting, so open it now and follow along. If you couldn&rsquo;t be there, sign whenever you&rsquo;re ready; the link keeps working.</p>`
      + `<p style="margin:0 0 10px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">2 &middot; Jersey &amp; gear order</p>` + btn(L.gear, `${esc(g)}&rsquo;s jersey &amp; gear order`)
      + `<p style="margin:0 0 20px">Once she has tried on the sample jerseys, enter her sizes here. ${pre} &mdash; please check ${preIt}.</p>`
      + `<p style="margin:0 0 14px">Thank you.</p><p style="margin:0">&mdash; Drew</p></div>`;
    return { subject: `${g}'s DS Elite commitment and jersey order`, text, html };
  }
  const text = `${hi}\n\n${g} still needs her DS Elite jersey try-on. Come any time today, Sunday Oct 11, 11:30am-3:00pm, or Monday Oct 12, 6:00-8:00pm, at ${WHERE}. It only takes a few minutes.\n\nThis is ${g}'s jersey & gear order link. Bring it up on your phone at the try-on and enter her sizes once she has tried everything on:\n${L.gear}\n\n${seText}Thank you.\n\n- Drew`;
  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:600px">'
    + `<p style="margin:0 0 14px">${esc(hi)}</p><p style="margin:0 0 16px">${esc(g)} still needs her DS Elite jersey try-on. Come any time <b>today, Sunday Oct 11, 11:30am&ndash;3:00pm</b>, or <b>Monday Oct 12, 6:00&ndash;8:00pm</b>, at ${esc(WHERE)}. It only takes a few minutes.</p>`
    + `<p style="margin:0 0 16px">This is ${esc(g)}&rsquo;s jersey &amp; gear order link. Bring it up on your phone at the try-on and enter her sizes once she has tried everything on:</p>` + btn(L.gear, `${esc(g)}&rsquo;s jersey &amp; gear order`) + seHtml
    + `<p style="margin:0 0 14px">Thank you.</p><p style="margin:0">&mdash; Drew</p></div>`;
  return { subject: `${g}'s DS Elite jersey try-on and order link`, text, html };
};

// Build jobs.
const texts = [], emails = [], noContact = [];
for (const p of targets) {
  const body = textFor(p);
  const phones = [];
  for (const [ph, nm] of [[p.parent_phone, p.parent_name], [p.parent2_phone, p.parent2_name]]) {
    const to = e164(ph); if (!to || optedOut.has(last10(to)) || phones.some(x => x.to === to)) continue;
    phones.push({ to, name: String(nm || "").trim() });
  }
  for (const ph of phones) texts.push({ p, ...ph, body });
  const to = [...new Set([p.parent_email, p.parent_email2, p.parent_email3].map(e => String(e || "").trim().toLowerCase()).filter(e => EMAIL_RE.test(e) && !HOLD.has(e)))];
  if (to.length) emails.push({ p, to, ...emailFor(p) });
  if (!phones.length && !to.length) noContact.push(p);
}
for (const t of texts) if (t.body.length > 600 || /[^\x20-\x7E\n]/.test(t.body)) throw new Error("bad text for " + t.p.first_name + " (" + t.body.length + ")");

console.log(`GROUP ${group.toUpperCase()}: ${pool.length} players due, ${skippedDone.length} skipped (commitment complete), ${targets.length} to contact`);
console.log(`  ${texts.length} texts, ${emails.length} emails` + (noContact.length ? ` | NO CONTACT: ${noContact.map(p => p.first_name + " " + p.last_name).join(", ")}` : ""));
const byTeam = {}; for (const p of targets) (byTeam[p.team_assignment] = byTeam[p.team_assignment] || []).push(p.first_name + " " + p.last_name + (half(p) ? " (half-signed)" : ""));
for (const [t, l] of Object.entries(byTeam).sort()) console.log(`  ${t} (${l.length}): ${l.join(", ")}`);
if (skippedDone.length) console.log(`  SKIPPED, commitment complete: ${skippedDone.map(p => p.first_name + " " + p.last_name + " (" + p.team_assignment + ")").join(", ")}`);

if (!doSend) {
  if (texts[0]) console.log("\n--- SAMPLE TEXT (" + texts[0].body.length + " chars) ---\n" + texts[0].body.replace("{first}", texts[0].name.split(" ")[0] || "there"));
  const show = val("show"), ej = (show && emails.find(e => e.p.first_name.trim().toLowerCase() === show.toLowerCase())) || emails[0];
  if (ej) console.log("\n--- SAMPLE EMAIL ---\nTO: " + ej.to.join(", ") + "\nSUBJECT: " + ej.subject + "\n" + ej.text);
  console.log("\nDRY RUN - nothing sent.");
  process.exit(0);
}

// Emails: Resend holds them until --at.
let eSent = 0;
for (const j of emails) {
  const r = await fetch(APP + "/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: j.subject, body: j.text, bodyHtml: j.html, recipients: j.to, ...(at ? { scheduledAt: at, skipPush: true } : {}), sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script" }) });
  const o = await r.json().catch(() => ({}));
  if (r.ok && !o.error) eSent++; else console.log("EMAIL FAILED " + j.p.first_name + " " + j.p.last_name + ": " + (o.error || r.status));
}
console.log(`${eSent} emails ${at ? "queued for " + at : "sent"}`);
// Texts: wait here until --at, then send.
if (at) {
  const ms = new Date(at).getTime() - Date.now();
  if (ms > 0) { console.log(`texts waiting ${Math.round(ms / 60000)} min until ${at}...`); await new Promise(r => setTimeout(r, ms)); }
}
let tSent = 0;
for (const t of texts) {
  const r = await fetch(APP + "/api/send-sms", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY },
    body: JSON.stringify({ to: t.to, body: t.body, contact_name: t.name, contact_kind: "parent", player_id: t.p.id, sent_by_label: "Drew Rose" }) });
  const o = await r.json().catch(() => ({}));
  if (r.ok && !o.error) tSent++; else console.log("TEXT FAILED " + t.p.first_name + " -> " + t.to + ": " + (o.error || r.status));
}
console.log(`${tSent} texts sent at ${new Date().toLocaleTimeString("en-US", { timeZone: "America/Chicago" })} CT`);
