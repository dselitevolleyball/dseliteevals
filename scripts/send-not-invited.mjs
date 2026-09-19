// For the girls we can't place after the 19 Sep tryout: a short, honest note,
// and a real invitation to keep training with us.
//
// DRY RUN BY DEFAULT.
//   node scripts/send-not-invited.mjs
//   node scripts/send-not-invited.mjs --test drew@dselitevolleyball.com
//   node scripts/send-not-invited.mjs --send
//   node scripts/send-not-invited.mjs --html out.json   # data for the review page

import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const RISE_CAMP = "https://drippingsports.playbookapi.com/programs/more_info/class_package/77559/";
const NAMES = ["Sarine Schutz", "Charlotte John", "Madilyn Walston"];

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const testTo = val("test"), doSend = args.includes("--send"), htmlOut = val("html");

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: players } = await sb.from("players")
  .select("first_name, last_name, usav_div, parent_name, parent2_name, parent_email, parent_email2, parent_email3")
  .eq("season", "2026-27");
const nm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const listOf = (xs) => xs.length === 1 ? xs[0] : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];

const build = (p) => {
  const girl = p.first_name.trim();
  const parents = [...new Set([p.parent_name, p.parent2_name].map(x => String(x || "").trim().split(/\s+/)[0]).filter(Boolean))];
  const greet = parents.length ? "Hi " + listOf(parents) + "," : "Hi,";
  const paras = [
    `Thank you for bringing ${girl} to tryouts today. Our coaches enjoyed having her on the court, and she should be proud of how she competed.`,
    `We aren't able to offer her a spot on a team this season. Those are hard calls, and they're about the number of places we have, not about how much we think of her as a player.`,
    `Here's the part we mean sincerely: please keep her playing with us. Rise Fall Camp runs on Saturdays at the Warehouse through the start of the season, and it's exactly where a player makes the jump — real reps, good coaching, and other girls working on the same things.`,
  ];
  const tail = [
    `DSSC also runs skills training and clinics through the year, and our coaches would be glad to keep working with her. If a spot opens on a roster, we'll be in touch.`,
    `We'd love to see her back in the gym soon.`,
  ];
  const text = `${greet}\n\n${paras.join("\n\n")}\n\nSign up for Rise Fall Camp: ${RISE_CAMP}\n\n${tail.join("\n\n")}\n\nSee you on the court,\n\nDrew Rose\nDirector, DS Elite`;
  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:620px">'
    + `<p style="margin:0 0 14px">${esc(greet)}</p>`
    + paras.map(x => `<p style="margin:0 0 14px">${esc(x)}</p>`).join("")
    + `<p style="margin:4px 0 8px"><a href="${RISE_CAMP}" style="display:inline-block;background:#e91e8c;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:700">Sign up for Rise Fall Camp &rarr;</a></p>`
    + `<p style="margin:0 0 18px;font-size:12px;color:#777;word-break:break-all">${esc(RISE_CAMP)}</p>`
    + tail.map(x => `<p style="margin:0 0 14px">${esc(x)}</p>`).join("")
    + `<p style="margin:16px 0 0">See you on the court,</p><p style="margin:10px 0 0">Drew Rose<br>Director, DS Elite</p></div>`;
  return { subject: `Thank you for coming out today, ${girl}`, text, html };
};

const jobs = [];
for (const name of NAMES) {
  const p = players.find(x => nm(x.first_name + x.last_name) === nm(name));
  if (!p) { console.error("NOT IN APP: " + name); continue; }
  const to = [...new Set([p.parent_email, p.parent_email2, p.parent_email3].map(e => String(e || "").trim().toLowerCase()).filter(e => EMAIL_RE.test(e)))];
  if (!to.length) { console.error("NO EMAIL: " + name); continue; }
  jobs.push({ p, to, ...build(p) });
}

const send = async (m, recipients) => {
  const r = await fetch(APP + "/api/send-email", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: m.subject, body: m.text, bodyHtml: m.html, recipients, replyTo: SENDER.email,
      sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script", skipPush: true }),
  });
  const o = await r.json().catch(() => ({}));
  return r.ok && !o.error ? null : (o.error || String(r.status));
};

console.log(`${jobs.length} notes: ${jobs.map(j => j.p.first_name + " " + j.p.last_name).join(", ")}`);
if (htmlOut) {
  writeFileSync(htmlOut, JSON.stringify(jobs.map(j => ({ group: "Not offered a spot", kind: "nooffer",
    player: `${j.p.first_name} ${j.p.last_name}`, to: j.to, subject: j.subject, html: j.html })), null, 1));
  console.log("wrote " + htmlOut);
} else if (testTo) {
  const err = await send({ ...jobs[0], subject: "[TEST] " + jobs[0].subject }, [testTo]);
  console.log(err ? "FAILED: " + err : `test sent (${jobs[0].p.first_name}'s wording)`);
} else if (doSend) {
  let ok = 0;
  for (const j of jobs) {
    const err = await send(j, j.to);
    if (err) console.error(`FAILED ${j.p.first_name}: ${err}`);
    else { ok++; console.log(`sent ${(j.p.first_name + " " + j.p.last_name).padEnd(20)} → ${j.to.join(", ")}`); }
  }
  console.log(`\n${ok}/${jobs.length} sent`);
} else {
  console.log("\n" + "═".repeat(74) + `\n${jobs[0].p.first_name} ${jobs[0].p.last_name} → ${jobs[0].to.join(", ")}\nSUBJECT: ${jobs[0].subject}\n` + "─".repeat(74) + "\n" + jobs[0].text);
  console.log("\nDRY RUN — --test <email> or --send.");
}
