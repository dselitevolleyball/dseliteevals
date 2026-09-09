// Orientation follow-up — HQ notification + individual email, per coach.
//
// The full run of show went out 1 September to all 28 coaches, heads and
// assistants alike. This is not that email again. It is the week-of reminder,
// and it exists to fix three things the first one left behind:
//
//   1. THE DEADLINE WAS IMPOSSIBLE. That email asked for a plan "two weeks
//      before your night". For the 14s that was 28 August and for the 15s and
//      16s it was 29 August — both already past on the day it was sent. Nobody
//      could have met it. Saying so is cheaper than pretending the coaches
//      dropped it.
//
//   2. ASSISTANTS WERE NEVER TOLD THEY MUST COME. They received the mail, but
//      every line in it was addressed to whoever runs the team. An assistant
//      reading "your time with your team" can reasonably conclude it isn't
//      about her. This one says it outright.
//
//   3. THE FIRST NIGHT IS NOW TWO DAYS AWAY and the mail said nothing about
//      when it was relative to today.
//
// Everything else is deliberately short. A coach who read the 1 September mail
// does not need the whole schedule again; a coach who didn't needs to be told
// where to find it, which is why the run of show is summarised in six lines
// rather than reprinted in forty.
//
// DRY RUN BY DEFAULT — prints one full message and stops.
//
// Usage:
//   node scripts/send-orientation-reminder.mjs                  # dry run
//   node scripts/send-orientation-reminder.mjs --coach "Ella Hinkle"
//   node scripts/send-orientation-reminder.mjs --all             # print all 28
//   node scripts/send-orientation-reminder.mjs --send
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const TODAY = "2026-09-09";

const PLACEHOLDER = /^(tbd|tba|n\/a|na|none|pending|sub|open|needed|\?+|-+|—)$/i;
const isPlaceholder = (c) => {
  const s = String(c || "").trim();
  return !s || PLACEHOLDER.test(s) || /new coach|floater coach|assistant coach$/i.test(s);
};
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const NIGHTS = [
  { ages: ["14"],       label: "Friday, September 11",   date: "2026-09-11" },
  { ages: ["15", "16"], label: "Saturday, September 12", date: "2026-09-12" },
  { ages: ["13"],       label: "Friday, September 18",   date: "2026-09-18" },
  { ages: ["11", "12"], label: "Friday, September 25",   date: "2026-09-25" },
];
const nightFor = (team) => NIGHTS.find(n => n.ages.includes(String(team || "").trim().split(/\s+/)[0])) || null;
const daysOut = (iso) => Math.round((new Date(iso + "T00:00:00Z") - new Date(TODAY + "T00:00:00Z")) / 86400000);
// "this Friday" reads as a date a coach can act on; "in 2 days" reads as a number.
const whenPhrase = (iso) => {
  const d = daysOut(iso);
  if (d <= 0) return "today";
  if (d === 1) return "tomorrow";
  if (d <= 6) return "this " + new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  if (d <= 13) return "a week " + (new Date(iso + "T12:00:00Z").getUTCDay() === 6 ? "on Saturday" : "on Friday");
  return "in " + d + " days";
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
const showAll = flag("all");
const onlyCoach = value("coach");

const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const [{ data: teams }, { data: roster }, { data: accounts }] = await Promise.all([
  sb.from("practice_teams").select("team_name, head_coach, assistant_coach, third_coach"),
  sb.from("coach_roster").select("first_name, last_name, email"),
  sb.from("coaches").select("display_name, email"),
]);

const emailFor = new Map();
const put = (name, email) => {
  const k = norm(name), e = String(email || "").trim().toLowerCase();
  if (!k || !EMAIL_RE.test(e) || emailFor.has(k)) return;
  emailFor.set(k, e);
};
(accounts || []).forEach(a => put(a.display_name, a.email));
(roster || []).forEach(r => put(`${r.first_name || ""} ${r.last_name || ""}`, r.email));

// One entry per person, carrying every team and the role they hold on it.
const byCoach = new Map();
for (const t of (teams || [])) {
  for (const [role, name] of [["head", t.head_coach], ["assistant", t.assistant_coach], ["third", t.third_coach]]) {
    if (isPlaceholder(name)) continue;
    const k = norm(name);
    if (!byCoach.has(k)) byCoach.set(k, { name: String(name).trim(), teams: [] });
    byCoach.get(k).teams.push({ team: t.team_name, role });
  }
}

const build = (c) => {
  const first = c.name.split(/\s+/)[0];
  const nightMap = new Map();
  for (const t of c.teams) {
    const n = nightFor(t.team);
    const key = n ? n.label : "TBC";
    if (!nightMap.has(key)) nightMap.set(key, { label: key, date: n ? n.date : "9999", teams: [] });
    nightMap.get(key).teams.push(t);
  }
  const nights = [...nightMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  nights.forEach(n => n.teams.sort((a, b) => a.team.localeCompare(b.team)));

  const soonest = nights[0];
  const onlyAssistant = c.teams.every(t => t.role !== "head");
  const multi = nights.length > 1;

  const nightLines = nights.map(n =>
    `  ${n.label} (${whenPhrase(n.date)}) — ${n.teams.map(t => t.team + (t.role === "head" ? "" : " (assistant)")).join(", ")}`);

  // The assistants paragraph only appears for someone who is only ever an
  // assistant. A head coach does not need to be told she is expected.
  const assistantLine = onlyAssistant
    ? `You're an assistant, so to be explicit: yes, this means you. Both coaches on the court, all night. The 90 minutes with your team is the two of you running it together, not you watching your head coach run it.`
    : `Bring your assistant. Both coaches on the court, all night — the 90 minutes with your team is the two of you running it together.`;

  // A head coach has no head coach to tell, and an assistant has no assistant.
  const absenceLine = onlyAssistant
    ? `If you cannot be there, tell Coach T and your head coach now, not on the night.`
    : `If you cannot be there, tell Coach T and your assistant now, not on the night.`;

  const planAsk = onlyAssistant
    ? `Your head coach owes me a plan for your team's 90 minutes. Make sure it's happening — the two of you should be agreeing it, not one of you writing it.`
    : `I still need your plan for the 90 minutes — one paragraph, whether you've already had your parent meeting, which space you're using, and any supplies you need from the club. I asked for that two weeks out, which for the first two nights had already passed by the time I sent it. My fault, not yours. Just send it now.`;

  const text = `Hi ${first},

Orientation starts ${whenPhrase(NIGHTS[0].date)}. Your night${multi ? "s" : ""}:

${nightLines.join("\n")}

${assistantLine}

${absenceLine}

${planAsk}

You are paid for the evening. Clock in the same way you would for a normal practice.

How the night runs:

  5:00  — as many of you as can make it. Chairs out, light decorating, court and parent seating set before families walk in.
  5:30  — everyone else on site.
  6:00  — commitment meeting, everyone on the court. Sit with your team and do the cheers. If you don't, they won't.
  7:10  — 90 minutes with your team, pizza included. Your 20-minute cheer slot falls somewhere in here.
  9:00  — glow volleyball. You're playing. Plan on it.
  10:00 — done.

In those 90 minutes: your parent and player meeting if you haven't had one, and plan a couple of team building exercises either way. You can use any part of DSSC — a court, upstairs, outside.

Cheer slots go out separately once they're set.

Two rules for the night: no team sits idle, and no player stands alone.

— Drew`;

  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:600px">'
    + `<p style="margin:0 0 14px">Hi ${esc(first)},</p>`
    + `<p style="margin:0 0 10px">Orientation starts <b>${esc(whenPhrase(NIGHTS[0].date))}</b>. Your night${multi ? "s" : ""}:</p>`
    + `<ul style="margin:0 0 18px;padding-left:20px">`
    + nights.map(n => `<li style="margin-bottom:5px"><b>${esc(n.label)}</b> <span style="color:#c2186f;font-weight:700">(${esc(whenPhrase(n.date))})</span> &mdash; ${esc(n.teams.map(t => t.team + (t.role === "head" ? "" : " (assistant)")).join(", "))}</li>`).join("")
    + `</ul>`
    + `<p style="margin:0 0 14px">${esc(assistantLine)}</p>`
    + `<p style="margin:0 0 14px"><b>${esc(absenceLine)}</b></p>`
    + `<p style="margin:0 0 16px;padding:12px 14px;background:#fff4f9;border-left:3px solid #e91e8c;border-radius:0 6px 6px 0">${esc(planAsk)}</p>`
    + `<p style="margin:0 0 16px;padding:12px 14px;background:#f0fdf4;border-left:3px solid #22c55e;border-radius:0 6px 6px 0"><b>You are paid for the evening.</b> Clock in the same way you would for a normal practice.</p>`
    + `<p style="margin:0 0 8px"><b>How the night runs:</b></p>`
    + `<table style="border-collapse:collapse;font-size:14px;margin:0 0 16px">`
    + [["5:00", "<b>As many of you as can make it.</b> Chairs out, light decorating, court and parent seating set before families walk in."],
       ["5:30", "Everyone else on site."],
       ["6:00", "<b>Commitment meeting</b>, everyone on the court. Sit with your team and do the cheers. If you don&rsquo;t, they won&rsquo;t."],
       ["7:10", "<b>90 minutes with your team, pizza included.</b> Your 20-minute cheer slot falls somewhere in here."],
       ["9:00", "<b>Glow volleyball.</b> You&rsquo;re playing. Plan on it."],
       ["10:00", "Done."]].map(([t, d]) =>
       `<tr><td style="padding:5px 12px 5px 0;vertical-align:top;font-weight:700;white-space:nowrap;color:#c2186f">${t}</td><td style="padding:5px 0">${d}</td></tr>`).join("")
    + `</table>`
    + `<p style="margin:0 0 14px">In those 90 minutes: your parent and player meeting if you haven&rsquo;t had one, and <b>plan a couple of team building exercises</b> either way. You can use any part of DSSC &mdash; a court, upstairs, outside.</p>`
    + `<p style="margin:0 0 14px;font-size:14px;color:#555">Cheer slots go out separately once they&rsquo;re set.</p>`
    + `<p style="margin:0 0 14px"><b>Two rules for the night: no team sits idle, and no player stands alone.</b></p>`
    + '<p style="margin:0">&mdash; Drew</p></div>';

  return {
    subject: `Orientation ${whenPhrase(soonest.date)} — what I still need from you`,
    text, html,
    push: {
      title: "Orientation " + whenPhrase(soonest.date),
      body: soonest.label + ", 5:30 arrival. Both coaches on the court. Send me your plan for the 90 minutes.",
      url: APP + "/?view=home",
    },
  };
};

const list = [...byCoach.values()]
  .filter(c => !onlyCoach || norm(c.name) === norm(onlyCoach))
  .sort((a, b) => a.name.localeCompare(b.name));
const jobs = list.map(c => ({ coach: c, to: emailFor.get(norm(c.name)), ...build(c) }));
const sendable = jobs.filter(j => j.to);

if (!doSend) {
  console.log(`${jobs.length} coaches · ${sendable.length} reachable\n`);
  const heads = jobs.filter(j => j.coach.teams.some(t => t.role === "head")).length;
  console.log(`${heads} with a head-coach role · ${jobs.length - heads} assistant-only (they get the "yes, this means you" line)\n`);
  const show = showAll || onlyCoach ? jobs : [
    jobs.find(j => j.coach.teams.every(t => t.role !== "head")),
    jobs.find(j => j.coach.teams.some(t => t.role === "head")),
  ].filter(Boolean);
  for (const j of show) {
    console.log("─".repeat(72));
    console.log(j.coach.name + "  <" + (j.to || "NO EMAIL") + ">");
    console.log("SUBJECT: " + j.subject);
    console.log("─".repeat(72));
    console.log(j.text + "\n");
  }
  console.log("DRY RUN — nothing sent. Re-run with --send.");
} else {
  let sent = 0, failed = 0, pushed = 0;
  for (const j of sendable) {
    // Notification first — it's the one that reaches a coach standing on a
    // court. skipEmail because we send our own below.
    try {
      const pr = await fetch(APP + "/api/send-push", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...j.push, skipEmail: true, sentBy: SENDER.name,
          audience: { type: "email", email: j.to } }),
      });
      const po = await pr.json().catch(() => ({}));
      if (pr.ok && po.sent) pushed += po.sent;
    } catch { /* no device subscribed still gets the email */ }

    const r = await fetch(APP + "/api/send-email", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: j.subject, body: j.text, bodyHtml: j.html,
        recipients: [j.to], sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script" }),
    });
    const o = await r.json().catch(() => ({}));
    if (!r.ok || o.error) { failed++; console.error("FAILED " + j.coach.name + ": " + (o.error || r.status)); continue; }
    sent++;
    console.log("sent " + j.coach.name.padEnd(22) + "→ " + j.to);
  }
  console.log(`\nDone. ${sent} emailed, ${pushed} notifications, ${failed} failed.`);
}
