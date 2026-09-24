// Shoe sizes, urgently — the club shoe order goes in as one block buy and the
// discount depends on every size being in it.
//
// Non-Rise players only (Rise families are fitted on 11 October), and only the
// ones with no shoe size on file. Each family gets her own one-question link:
// /gear?t=<token>&shoe=1 — nothing else is asked, because the rest of the
// uniform is fitted in person on 11 October.
//
// DRY RUN BY DEFAULT.
//   node scripts/send-shoe-size-chase.mjs
//   node scripts/send-shoe-size-chase.mjs --test drew@dselitevolleyball.com
//   node scripts/send-shoe-size-chase.mjs --send
//   node scripts/send-shoe-size-chase.mjs --reminder --send   # URGENT second chase

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const TERMINAL = ["declined", "not_invited", "opted_out"];
// Trialling with a team, no spot yet — no uniform, no shoes.
const SKIP_IDS = [266];

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const testTo = val("test"), doSend = args.includes("--send"), reminder = args.includes("--reminder");

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [{ data: players }, { data: gear }] = await Promise.all([
  sb.from("players").select("id, first_name, last_name, team_assignment, offer_status, parent_name, parent2_name, parent_email, parent_email2, parent_email3, gear_form_token")
    .eq("season", "2026-27").neq("team_assignment", ""),
  sb.from("player_gear_orders").select("player_id, shoe_size"),
]);
const sizeBy = new Map((gear || []).map(g => [g.player_id, String(g.shoe_size || "").trim()]));
const listOf = (xs) => xs.length === 1 ? xs[0] : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];

const build = (p) => {
  const girl = p.first_name.trim();
  const link = `${APP}/gear?t=${p.gear_form_token}&shoe=1`;
  const parents = [...new Set([p.parent_name, p.parent2_name].map(x => String(x || "").trim().split(/\s+/)[0]).filter(Boolean))];
  const greet = parents.length ? "Hi " + listOf(parents) + "," : "Hi,";
  if (reminder) return buildReminder(p, girl, link, greet);
  const paras = [
    `Quick one, and it's time-sensitive: we're placing the DS Elite shoe order with Avoli right away, and we still don't have ${girl}'s size.`,
    `The whole club goes in as one order, and the bigger that single order is, the better the discount every family gets. A handful of missing sizes is what holds it up.`,
    `This link asks for one thing — her shoe size. Nothing else:`,
  ];
  const tail = [
    `Not sure of her size? There's a box to tick and we'll fit her in person.`,
    `The rest of her uniform is fitted on Sunday, 11 October — you don't need to do anything about that now.`,
  ];
  const text = `${greet}\n\n${paras.join("\n\n")}\n\n${link}\n\n${tail.map(t => "  • " + t).join("\n")}\n\nThank you — please do it today if you can.\n\nDrew Rose\nDirector, DS Elite`;
  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:600px">'
    + `<p style="margin:0 0 14px">${esc(greet)}</p>`
    + paras.map(x => `<p style="margin:0 0 14px">${esc(x)}</p>`).join("")
    + `<p style="margin:6px 0 10px"><a href="${link}" style="display:inline-block;background:#e91e8c;color:#fff;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">Give ${esc(girl)}'s shoe size &rarr;</a></p>`
    + `<p style="margin:0 0 18px;font-size:12px;color:#777;word-break:break-all">${esc(link)}</p>`
    + `<ul style="margin:0 0 16px;padding-left:20px">${tail.map(t => `<li style="margin-bottom:5px">${esc(t)}</li>`).join("")}</ul>`
    + `<p style="margin:0 0 14px"><b>Thank you — please do it today if you can.</b></p>`
    + `<p style="margin:0">Drew Rose<br>Director, DS Elite</p></div>`;
  return { subject: `Need ${girl}'s shoe size today — club shoe order going in`, text, html };
};

// Second chase, a day later, for the families that still haven't answered.
// Blunt on purpose: the Avoli order closes without her if we don't have a size.
const buildReminder = (p, girl, link, greet) => {
  const lead = `we still don't have ${girl}'s shoe size, and the DS Elite club shoe order with Avoli is going in now.`;
  const paras = [
    `If her size isn't in by the time the order is placed, she won't be able to participate in the discounted shoe program we're getting with Avoli. The order goes in as one block and can't be reopened for late sizes.`,
    `It's one question and takes ten seconds:`,
  ];
  const tail = [
    `Not sure of her size? Check a pair she wears now — the standard size she buys is fine.`,
    `The rest of her uniform is fitted on Sunday, 11 October — nothing to do about that now.`,
  ];
  const text = `${greet}\n\nURGENT — ${lead}\n\n${paras.join("\n\n")}\n\n${link}\n\n${tail.map(t => "  • " + t).join("\n")}\n\nPlease do this today.\n\nDrew Rose\nDirector, DS Elite`;
  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:600px">'
    + `<p style="margin:0 0 14px">${esc(greet)}</p>`
    + `<p style="margin:0 0 14px"><b style="color:#c62828">URGENT</b> &mdash; ${esc(lead)}</p>`
    + paras.map(x => `<p style="margin:0 0 14px">${esc(x)}</p>`).join("")
    + `<p style="margin:6px 0 10px"><a href="${link}" style="display:inline-block;background:#c62828;color:#fff;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">Give ${esc(girl)}'s shoe size now &rarr;</a></p>`
    + `<p style="margin:0 0 18px;font-size:12px;color:#777;word-break:break-all">${esc(link)}</p>`
    + `<ul style="margin:0 0 16px;padding-left:20px">${tail.map(t => `<li style="margin-bottom:5px">${esc(t)}</li>`).join("")}</ul>`
    + `<p style="margin:0 0 14px"><b>Please do this today.</b></p>`
    + `<p style="margin:0">Drew Rose<br>Director, DS Elite</p></div>`;
  return { subject: `URGENT: ${girl}'s shoe size — Avoli discounted shoe order closing`, text, html };
};

const jobs = [];
for (const p of players) {
  if (TERMINAL.includes(p.offer_status || "") || SKIP_IDS.includes(p.id)) continue;
  if (/rise/i.test(p.team_assignment)) continue;           // Rise is fitted on 11 Oct
  if (sizeBy.get(p.id)) continue;                          // already have her size
  if (!p.gear_form_token) { console.error(`NO LINK: ${p.first_name} ${p.last_name}`); continue; }
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

console.log(`${jobs.length} families with no shoe size:`);
jobs.forEach(j => console.log(`  ${j.p.team_assignment.padEnd(12)} ${j.p.first_name} ${j.p.last_name}`));

if (testTo) {
  const err = await send({ ...jobs[0], subject: "[TEST] " + jobs[0].subject }, [testTo]);
  console.log(err ? "FAILED: " + err : `test sent (${jobs[0].p.first_name})`);
} else if (doSend) {
  let ok = 0;
  for (const j of jobs) {
    const err = await send(j, j.to);
    if (err) console.error(`FAILED ${j.p.first_name} ${j.p.last_name}: ${err}`);
    else { ok++; console.log(`sent ${(j.p.first_name + " " + j.p.last_name).padEnd(22)} → ${j.to.join(", ")}`); }
  }
  console.log(`\n${ok}/${jobs.length} sent`);
} else {
  console.log("\n" + "─".repeat(70) + `\n${jobs[0].p.first_name} ${jobs[0].p.last_name} → ${jobs[0].to.join(", ")}\nSUBJECT: ${jobs[0].subject}\n` + "─".repeat(70) + "\n" + jobs[0].text);
  console.log("\nDRY RUN — --test <email> or --send.");
}
