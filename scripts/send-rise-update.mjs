// For families already ON 11 Rise and 12 Rise: who's joining them after the
// 19 Sep tryout, and a nudge to Rise Fall Camp on Saturdays.
//
// Goes only to players whose offer is accepted — the girls being offered spots
// get their own invite (scripts/send-team-invites.mjs).
//
// DRY RUN BY DEFAULT.
//   node scripts/send-rise-update.mjs
//   node scripts/send-rise-update.mjs --test drew@dselitevolleyball.com
//   node scripts/send-rise-update.mjs --send

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const RISE_CAMP = "https://drippingsports.playbookapi.com/programs/more_info/class_package/77559/";
const TEAMS = { "11 Rise 1": "11 Rise", "12 Rise 1": "12 Rise" };

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const args = process.argv.slice(2);
const testTo = (() => { const i = args.indexOf("--test"); return i >= 0 ? args[i + 1] : null; })();
const htmlOut = (() => { const i = args.indexOf("--html"); return i >= 0 ? args[i + 1] : null; })();
const doSend = args.includes("--send");

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [{ data: players }, { data: teams }, { data: roster }] = await Promise.all([
  sb.from("players").select("first_name, last_name, team_assignment, offer_status, parent_name, parent2_name, parent_email, parent_email2, parent_email3").in("team_assignment", Object.keys(TEAMS)),
  sb.from("practice_teams").select("team_name, head_coach, assistant_coach, third_coach").in("team_name", Object.keys(TEAMS)),
  sb.from("coach_roster").select("first_name, last_name, email, phone"),
]);
const { data: pas } = await sb.from("practice_assignments").select("team_name, phase, day, slot").in("team_name", Object.keys(TEAMS));

const hr = (n) => (Number(n) === 12 ? 12 : Number(n) + 12);
const parse = (s) => { const m = /^(\d{1,2})\s*-\s*(\d{1,2})/.exec(String(s || "")); return m ? { a: hr(m[1]), b: hr(m[2]) } : null; };
const clock = (h) => (h > 12 ? h - 12 : h);
const merge = (slots) => { const r = slots.map(parse).filter(Boolean).sort((x, y) => x.a - y.a), out = []; for (const x of r) { const l = out[out.length - 1]; if (l && l.b === x.a) l.b = x.b; else out.push({ ...x }); } return out.map(x => clock(x.a) + "–" + clock(x.b) + "pm"); };
const nm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const phone = (s) => { const x = String(s || "").replace(/\D/g, "").slice(-10); return x.length === 10 ? `(${x.slice(0, 3)}) ${x.slice(3, 6)}-${x.slice(6)}` : ""; };
const listOf = (xs) => xs.length === 1 ? xs[0] : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];

const build = (team, p) => {
  const T = TEAMS[team];
  const girl = p.first_name.trim();
  const parents = [...new Set([p.parent_name, p.parent2_name].map(x => String(x || "").trim().split(/\s+/)[0]).filter(Boolean))];
  const greet = parents.length ? "Hi " + listOf(parents) + "," : "Hi,";
  const joining = players.filter(x => x.team_assignment === team && x.offer_status === "made").map(x => `${x.first_name} ${x.last_name}`).sort();
  const t = teams.find(x => x.team_name === team) || {};
  const coaches = [["Head coach", t.head_coach], ["Assistant coach", t.assistant_coach], ["Coach", t.third_coach]]
    .filter(([, n]) => n).map(([role, n]) => { const r = roster.find(x => nm(x.first_name + x.last_name) === nm(n)); return `${n} — ${role}${r?.phone ? " · " + phone(r.phone) : ""}${r?.email ? " · " + r.email.toLowerCase() : ""}`; });
  const ss = merge(pas.filter(x => x.team_name === team && x.phase === "season" && x.day === "Sun").map(x => x.slot)).map(s => "Sun " + s);
  const others = ["Mon", "Tue", "Wed", "Thu", "Fri"].flatMap(dy => merge(pas.filter(x => x.team_name === team && x.phase === "season" && x.day === dy).map(x => x.slot)).map(s => dy + " " + s));

  const blocks = [
    [`The ${T} roster so far`, [
      ...players.filter(x => x.team_assignment === team && ["accepted", "made"].includes(x.offer_status))
        .map(x => `${x.first_name} ${x.last_name}`)
        .sort((a, b) => a.localeCompare(b)),
      `A few of these spots are still being confirmed — those families have until tomorrow, Sunday, September 20, at 6:00pm — so the roster may shift slightly.`,
    ]],
    [`Your ${T} coaches`, coaches],
    ["Rise Fall Camp — Saturdays", [
      `Team practice starts the weekend after Thanksgiving${ss.length || others.length ? ` (${[...ss, ...others].join(" · ")})` : ""}.`,
      `Until then, Rise Fall Camp runs on Saturdays at the Warehouse — it's the best way for ${girl} to keep touching a volleyball between now and the season, and to get to know her new teammates.`,
      `Sign up here: ${RISE_CAMP}`,
    ]],
    ["Uniforms", [
      `Uniform fittings will be scheduled at a later date. For Rise teams that evening also covers orientation and the commitment meeting — we'll send the date as soon as it's set.`,
    ]],
  ];
  const outro = `Any questions at all, just reply to this email. We're looking forward to this season.`;
  const intro = [
    `Great news — after today's tryout we've offered spots to the players below, and ${T} is filling out nicely.`,
    `${girl} is already on the team, so there's nothing you need to do about her place.`,
  ];
  const link = (s) => esc(s).replace(/(https?:\/\/\S+)/g, '<a href="$1" style="color:#c2186f">$1</a>');
  const text = `${greet}\n\n${intro.join("\n\n")}\n\n`
    + blocks.map(([h, items]) => `${h.toUpperCase()}\n${items.map(i => "  • " + i).join("\n")}`).join("\n\n")
    + `\n\n${outro}\n\nSee you on the court,\n\nDrew Rose\nDirector, DS Elite`;
  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:620px">'
    + `<p style="margin:0 0 14px">${esc(greet)}</p>`
    + intro.map(x => `<p style="margin:0 0 14px">${esc(x)}</p>`).join("")
    + blocks.map(([h, items]) => `<p style="margin:24px 0 6px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">${esc(h)}</p>`
        + `<ul style="margin:0 0 10px;padding-left:20px">${items.map(i => `<li style="margin-bottom:5px">${link(i)}</li>`).join("")}</ul>`).join("")
    + `<p style="margin:20px 0 0">${esc(outro)}</p><p style="margin:14px 0 0">See you on the court,</p><p style="margin:10px 0 0">Drew Rose<br>Director, DS Elite</p></div>`;
  return { subject: `${T} — your team is filling out, and Rise camp on Saturdays`, text, html };
};

const jobs = [];
for (const team of Object.keys(TEAMS)) {
  for (const p of players.filter(x => x.team_assignment === team && x.offer_status === "accepted")) {
    const to = [...new Set([p.parent_email, p.parent_email2, p.parent_email3].map(e => String(e || "").trim().toLowerCase()).filter(e => EMAIL_RE.test(e)))];
    if (!to.length) { console.error(`NO EMAIL: ${p.first_name} ${p.last_name}`); continue; }
    jobs.push({ team, p, to, ...build(team, p) });
  }
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

console.log(`${jobs.length} emails: ` + Object.keys(TEAMS).map(t => `${TEAMS[t]} ${jobs.filter(j => j.team === t).length}`).join(", "));
if (htmlOut && htmlOut.endsWith(".json")) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(htmlOut, JSON.stringify(jobs.map(j => ({ group: TEAMS[j.team] + " (current families)", kind: "update", player: j.p.first_name + " " + j.p.last_name, to: j.to, subject: j.subject, html: j.html })), null, 1));
  console.log("wrote " + htmlOut);
} else if (htmlOut) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(htmlOut, jobs.map(j => `<div style="background:#fff;border:1px solid #ddd;border-radius:12px;padding:18px;margin:0 0 18px;max-width:700px"><div style="font-size:12px;color:#666">${esc(TEAMS[j.team])} · to ${esc(j.to.join(", "))}</div><div style="font-size:16px;font-weight:700;margin:4px 0 12px">${esc(j.subject)}</div><hr style="border:none;border-top:1px solid #eee">${j.html}</div>`).join(""));
  console.log("wrote " + htmlOut);
} else if (testTo) {
  for (const t of Object.keys(TEAMS)) {
    const j = jobs.find(x => x.team === t);
    if (!j) continue;
    const err = await send({ ...j, subject: `[TEST ${TEAMS[t]}] ${j.subject}` }, [testTo]);
    console.log(err ? `FAILED ${TEAMS[t]}: ${err}` : `test sent: ${TEAMS[t]} (${j.p.first_name})`);
  }
} else if (doSend) {
  let ok = 0;
  for (const j of jobs) {
    const err = await send(j, j.to);
    if (err) console.error(`FAILED ${j.p.first_name} ${j.p.last_name}: ${err}`);
    else { ok++; console.log(`sent ${TEAMS[j.team].padEnd(9)} ${(j.p.first_name + " " + j.p.last_name).padEnd(22)} → ${j.to.join(", ")}`); }
  }
  console.log(`\n${ok}/${jobs.length} sent`);
} else {
  for (const t of Object.keys(TEAMS)) {
    const j = jobs.find(x => x.team === t);
    if (j) console.log("\n" + "═".repeat(74) + `\n${TEAMS[t]} — ${j.p.first_name} ${j.p.last_name} → ${j.to.join(", ")}\nSUBJECT: ${j.subject}\n` + "─".repeat(74) + "\n" + j.text);
  }
  console.log("\nDRY RUN — --test <email> or --send.");
}
