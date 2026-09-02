// Orientation night, plus the kickoff chase, in one message per coach.
//
// Two topics that would otherwise be two emails a week apart, which is how the
// second one gets ignored. The orientation half is identical for everyone; the
// kickoff half is not, because "please fill in the form" is the wrong thing to
// say to a coach who filled it in a fortnight ago.
//
// Four states, four different closings:
//   no answer      — the form, and the ask
//   not scheduled  — they promised a date by X; that date is the thing chased
//   scheduled      — thank them, unless the date falls outside Sept/Oct, which
//                    is the expectation, in which case say so
//   held           — thank them and say nothing else
//
// Rise teams are excluded from the kickoff half only. They still come to
// orientation — the 11s and 12s night is theirs too — they just don't run a
// kickoff party.
//
// DRY RUN BY DEFAULT.
//
// Usage:
//   node scripts/send-orientation.mjs                    # dry run
//   node scripts/send-orientation.mjs --coach "Tara Fisher"
//   node scripts/send-orientation.mjs --send
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const isRise = (t) => /\brise\b/i.test(String(t || ""));
const PLACEHOLDER = /^(tbd|tba|n\/a|na|none|pending|sub|open|needed|\?+|-+|—)$/i;
const isPlaceholder = (c) => {
  const s = String(c || "").trim();
  return !s || PLACEHOLDER.test(s) || /new coach|floater coach|assistant coach$/i.test(s);
};
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Age group → the night that group attends.
const NIGHTS = [
  { ages: ["14"],       label: "Friday, September 11",  date: "2026-09-11" },
  { ages: ["15", "16"], label: "Saturday, September 12", date: "2026-09-12" },
  { ages: ["13"],       label: "Friday, September 18",  date: "2026-09-18" },
  { ages: ["11", "12"], label: "Friday, September 25",  date: "2026-09-25" },
];
const nightFor = (team) => {
  const age = String(team || "").trim().split(/\s+/)[0];
  return NIGHTS.find(n => n.ages.includes(age)) || null;
};
const fmtDate = (iso) => {
  if (!iso) return "";
  try { return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }); }
  catch { return iso; }
};
// The window Drew expects a kickoff to land in.
const inWindow = (iso) => !!iso && iso >= "2026-09-01" && iso <= "2026-10-31";

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
const onlyCoach = value("coach");

const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const [{ data: teams }, { data: kicks }, { data: roster }, { data: accounts }] = await Promise.all([
  sb.from("practice_teams").select("team_name, head_coach, assistant_coach, third_coach, kickoff_form_token"),
  sb.from("team_kickoffs").select("*"),
  sb.from("coach_roster").select("first_name, last_name, email"),
  sb.from("coaches").select("display_name, email"),
]);

const kickBy = new Map((kicks || []).map(k => [k.team_name, k]));
const emailFor = new Map();
const put = (name, email) => {
  const k = norm(name), e = String(email || "").trim().toLowerCase();
  if (!k || !EMAIL_RE.test(e) || emailFor.has(k)) return;
  emailFor.set(k, e);
};
(accounts || []).forEach(a => put(a.display_name, a.email));
(roster || []).forEach(r => put(`${r.first_name || ""} ${r.last_name || ""}`, r.email));

// One entry per coach, carrying every team they are on.
const byCoach = new Map();
for (const t of (teams || [])) {
  for (const [role, name] of [["head", t.head_coach], ["assistant", t.assistant_coach], ["third", t.third_coach]]) {
    if (isPlaceholder(name)) continue;
    const k = norm(name);
    if (!byCoach.has(k)) byCoach.set(k, { name: String(name).trim(), teams: [] });
    byCoach.get(k).teams.push({ team: t.team_name, role, token: t.kickoff_form_token });
  }
}

// ── The message ─────────────────────────────────────────────────────────────
const ORIENT_TEXT = `Orientation is split across four nights by age group. All four run 6–10 PM at DSSC.

  Friday, September 11 — 14s
  Saturday, September 12 — 15s and 16s
  Friday, September 18 — 13s
  Friday, September 25 — 11s and 12s

Here's how each one runs.

5:30 — arrive. We set the court, the spaces, and the parent seating before families walk in.

6:00–7:00 — commitment meeting. Everyone on the court, players and parents. Myself and Coach T cover standards and expectations, our cheer coach teaches the DS Elite cheers to the whole group with team demos, and we close with logistics and the signed commitment. Sit with your team and do the cheers. If the coaches don't, the players won't.

7:10–9:00 — your time with your team. You get one 20-minute cheer session; I'll send your slot. The other 90 minutes are yours. Two things to fill them with:

1. Your own parent and player meeting — if you haven't already had one. If you have, skip it. If you haven't, this is your window: your schedule, your tournament plan, your expectations, how you'll communicate, and questions. Anything team-specific belongs here rather than in the club hour. Budget about 30 minutes.

2. Team building — whatever's left, or the full 90 if you've already met. The goal is that your players leave actually knowing each other. Use any part of DSSC that's open: a court, upstairs, outside. Plan two or three things:
   - Something that gets them talking, and go past "what's your favorite color"
   - Something hard they have to solve together, where they'll fail a few times first
   - Something they make together they can bring to tournaments

If your cheer slot lands mid-night, don't try to split either one across it — put the meeting in one half and activities in the other.

9:00–10:00 — glow volleyball. Everyone, coaches included. You're playing. Plan on it.

What I need back from you two weeks before your night:

1. Your plan for the 90 minutes — one paragraph. Tell me whether you've already had your parent meeting.
2. Which space you're using
3. Any supplies you need from the club`;

const ORIENT_HTML = `
<p style="margin:0 0 14px">Orientation is split across four nights by age group. All four run <b>6&ndash;10 PM at DSSC</b>.</p>
<ul style="margin:0 0 16px;padding-left:20px">
  <li style="margin-bottom:5px"><b>Friday, September 11</b> &mdash; 14s</li>
  <li style="margin-bottom:5px"><b>Saturday, September 12</b> &mdash; 15s and 16s</li>
  <li style="margin-bottom:5px"><b>Friday, September 18</b> &mdash; 13s</li>
  <li><b>Friday, September 25</b> &mdash; 11s and 12s</li>
</ul>
<p style="margin:0 0 14px">Here&rsquo;s how each one runs.</p>
<p style="margin:0 0 12px"><b>5:30 &mdash; arrive.</b> We set the court, the spaces, and the parent seating before families walk in.</p>
<p style="margin:0 0 12px"><b>6:00&ndash;7:00 &mdash; commitment meeting.</b> Everyone on the court, players and parents. Myself and Coach T cover standards and expectations, our cheer coach teaches the DS Elite cheers to the whole group with team demos, and we close with logistics and the signed commitment. <b>Sit with your team and do the cheers. If the coaches don&rsquo;t, the players won&rsquo;t.</b></p>
<p style="margin:0 0 10px"><b>7:10&ndash;9:00 &mdash; your time with your team.</b> You get one 20-minute cheer session; I&rsquo;ll send your slot. The other 90 minutes are yours. Two things to fill them with:</p>
<ol style="margin:0 0 14px;padding-left:22px">
  <li style="margin-bottom:9px"><b>Your own parent and player meeting</b> &mdash; if you haven&rsquo;t already had one. If you have, skip it. If you haven&rsquo;t, this is your window: your schedule, your tournament plan, your expectations, how you&rsquo;ll communicate, and questions. Anything team-specific belongs here rather than in the club hour. Budget about 30 minutes.</li>
  <li><b>Team building</b> &mdash; whatever&rsquo;s left, or the full 90 if you&rsquo;ve already met. The goal is that your players leave actually knowing each other. Use any part of DSSC that&rsquo;s open: a court, upstairs, outside. Plan two or three things:
    <ul style="margin:7px 0 0;padding-left:20px">
      <li style="margin-bottom:4px">Something that gets them talking, and go past &ldquo;what&rsquo;s your favorite color&rdquo;</li>
      <li style="margin-bottom:4px">Something hard they have to solve together, where they&rsquo;ll fail a few times first</li>
      <li>Something they make together they can bring to tournaments</li>
    </ul>
  </li>
</ol>
<p style="margin:0 0 12px">If your cheer slot lands mid-night, don&rsquo;t try to split either one across it &mdash; put the meeting in one half and activities in the other.</p>
<p style="margin:0 0 14px"><b>9:00&ndash;10:00 &mdash; glow volleyball.</b> Everyone, coaches included. You&rsquo;re playing. Plan on it.</p>
<p style="margin:0 0 10px"><b>What I need back from you two weeks before your night:</b></p>
<ol style="margin:0 0 16px;padding-left:22px">
  <li style="margin-bottom:5px">Your plan for the 90 minutes &mdash; one paragraph. Tell me whether you&rsquo;ve already had your parent meeting.</li>
  <li style="margin-bottom:5px">Which space you&rsquo;re using</li>
  <li>Any supplies you need from the club</li>
</ol>`;

// The kickoff half, which depends on what this coach has already told us.
function kickoffFor(c) {
  const heads = c.teams.filter(t => t.role === "head" && !isRise(t.team));
  if (!heads.length) return null;
  const parts = heads.map(t => {
    const k = kickBy.get(t.team);
    const link = t.token ? `${APP}/kickoff?t=${t.token}` : null;
    if (!k) return { team: t.team, state: "none", link,
      text: `I still don't have your kickoff form for ${t.team}. That's the one telling me who your team parent is and when your kickoff party is or was.`,
      html: `I still don&rsquo;t have your kickoff form for <b>${esc(t.team)}</b> &mdash; who your team parent is, and when your kickoff party is or was.` };
    if (k.kickoff_status === "held") return { team: t.team, state: "held", link: null,
      text: `${t.team} is done — you had yours on ${fmtDate(k.kickoff_date)}. Nothing needed.`,
      html: `<b>${esc(t.team)}</b> is done &mdash; you had yours on ${esc(fmtDate(k.kickoff_date))}. Nothing needed.` };
    if (k.kickoff_status === "scheduled") {
      const ok = inWindow(k.kickoff_date);
      return { team: t.team, state: ok ? "ok" : "late", link: ok ? null : link,
        text: ok
          ? `${t.team} is booked for ${fmtDate(k.kickoff_date)}. Good.`
          : `${t.team} is booked for ${fmtDate(k.kickoff_date)}, which is later than I'd like — I'm expecting these in September or October so the team is together early. Can you and your team parent bring it forward? Update the same link once you have a new date.`,
        html: ok
          ? `<b>${esc(t.team)}</b> is booked for ${esc(fmtDate(k.kickoff_date))}. Good.`
          : `<b>${esc(t.team)}</b> is booked for <b>${esc(fmtDate(k.kickoff_date))}</b>, which is later than I&rsquo;d like &mdash; I&rsquo;m expecting these in <b>September or October</b> so the team is together early. Can you and your team parent bring it forward? Update the same link once you have a new date.` };
    }
    return { team: t.team, state: "unscheduled", link,
      text: `${t.team} still isn't scheduled — you said you'd have a date by ${fmtDate(k.plan_by)}. Get hold of your team parent and pick a day in September or October, then update the same link.`,
      html: `<b>${esc(t.team)}</b> still isn&rsquo;t scheduled &mdash; you said you&rsquo;d have a date by <b>${esc(fmtDate(k.plan_by))}</b>. Get hold of your team parent and pick a day in <b>September or October</b>, then update the same link.` };
  });
  return parts;
}

const list = [...byCoach.values()]
  .filter(c => !onlyCoach || norm(c.name) === norm(onlyCoach))
  .sort((a, b) => a.name.localeCompare(b.name));

const jobs = [];
for (const c of list) {
  const to = emailFor.get(norm(c.name));
  // Group this coach's teams under the night each attends, earliest first —
  // a coach with a 14s team and a 15s team reads them in the order they happen.
  const nightMap = new Map();
  for (const t of c.teams) {
    const n = nightFor(t.team);
    const key = n ? n.label : "TBC";
    if (!nightMap.has(key)) nightMap.set(key, { label: key, date: n ? n.date : "9999", teams: [] });
    nightMap.get(key).teams.push(t.team);
  }
  const nights = [...nightMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  nights.forEach(n => n.teams.sort());
  jobs.push({ coach: c, to, nights, kick: kickoffFor(c) });
}

const sendable = jobs.filter(j => j.to);
const unreachable = jobs.filter(j => !j.to).map(j => j.coach.name);

console.log(`${jobs.length} coaches · ${sendable.length} reachable`);
if (unreachable.length) console.log(`⚠ no email: ${unreachable.join(", ")}`);
const chase = sendable.filter(j => (j.kick || []).some(k => k.state !== "held" && k.state !== "ok"));
console.log(`${chase.length} still need something on the kickoff:`);
chase.forEach(j => console.log("   " + j.coach.name.padEnd(22) +
  (j.kick || []).filter(k => k.state !== "held" && k.state !== "ok").map(k => k.team + " (" + k.state + ")").join(", ")));

const build = (j) => {
  const first = j.coach.name.split(/\s+/)[0];
  const nightLines = j.nights.map(n => `  ${n.label} — ${n.teams.join(", ")}`).join("\n");
  const kickText = !j.kick ? "" :
    "\n\nYOUR KICKOFF PARTY\n\n" + j.kick.map(k => k.text + (k.link ? "\n" + k.link : "")).join("\n\n");
  const text = `Hi ${first},

Your night${j.nights.length > 1 ? "s" : ""}:
${nightLines}

${ORIENT_TEXT}${kickText}

Two rules for the night: no team sits idle, and no player stands alone.

— Drew`;

  const kickHtml = !j.kick ? "" :
    `<p style="margin:26px 0 10px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">Your kickoff party</p>` +
    j.kick.map(k => `<p style="margin:0 0 12px">${k.html}</p>` +
      (k.link ? `<p style="margin:0 0 16px"><a href="${k.link}" style="display:inline-block;background:#e91e8c;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:700">Open ${esc(k.team)}&rsquo;s form &rarr;</a></p>` : "")).join("");

  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:620px">'
    + `<p style="margin:0 0 14px">Hi ${esc(first)},</p>`
    + `<p style="margin:0 0 6px"><b>Your night${j.nights.length > 1 ? "s" : ""}:</b></p>`
    + `<ul style="margin:0 0 18px;padding-left:20px">` +
      j.nights.map(n => `<li style="margin-bottom:4px"><b>${esc(n.label)}</b> &mdash; ${esc(n.teams.join(", "))}</li>`).join("") +
      `</ul>`
    + ORIENT_HTML + kickHtml
    + `<p style="margin:22px 0 14px"><b>Two rules for the night: no team sits idle, and no player stands alone.</b></p>`
    + '<p style="margin:0">&mdash; Drew</p></div>';
  return { text, html };
};

if (!doSend) {
  const sample = sendable.find(j => (j.kick || []).some(k => k.state === "late")) || sendable[0];
  if (sample) {
    console.log(`\n─── ${sample.coach.name} <${sample.to}> ──────────────────`);
    console.log(build(sample).text);
  }
  console.log("\nDRY RUN — nothing sent. Re-run with --send.");
} else {
  let sent = 0, failed = 0;
  for (const j of sendable) {
    const { text, html } = build(j);
    const r = await fetch(APP + "/api/send-email", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: "Orientation night — your plan, and your kickoff party",
        body: text, bodyHtml: html, recipients: [j.to],
        sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script",
      }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok || out.error) { failed++; console.error("FAILED " + j.coach.name + ": " + (out.error || r.status)); continue; }
    sent++;
    console.log("sent " + j.coach.name.padEnd(22) + "→ " + j.to);
  }
  console.log(`\nDone. ${sent} sent, ${failed} failed.`);
}
