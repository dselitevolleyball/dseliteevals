// Post-tryout invites, 19 Sep 2026. One email per family, built from the DB so
// the schedule, coaches and tournaments match what the team's own families were
// already told.
//
// Three shapes:
//   regional — a spot on a club team; fee, registration link, full schedule
//   rise     — a spot on a Rise team; Rise fee, Rise link, camp until the season
//   practice — no spot yet; come practice with the team and we'll talk after
//
// Everyone has until Sunday 20 Sep at 6:00pm to accept. Teams marked
// startTomorrow can practice with the team the same day they accept.
//
// DRY RUN BY DEFAULT.
//   node scripts/send-team-invites.mjs                 # previews every email
//   node scripts/send-team-invites.mjs --team "12 Ruby"
//   node scripts/send-team-invites.mjs --test drew@dselitevolleyball.com
//   node scripts/send-team-invites.mjs --send

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const DEADLINE = "tomorrow, Sunday, September 20, at 6:00pm";
const WAREHOUSE = "DSSC Warehouse, 15113 Fitzhugh Rd, Suite 1400, Dripping Springs";
const REG_REGIONAL = "https://dselitevolleyball.sportngin.com/register/form/644251518";
const REG_RISE = "https://dselitevolleyball.sportngin.com/register/form/029858282";
const RISE_CAMP = "https://drippingsports.playbookapi.com/programs/more_info/class_package/77559/";
const LONESTAR = "https://memberships.sportsengine.com/org/lone-star-region-volleyball/affiliation/ds-elite-volleyball-ds-elite";

// Per-team: how the email reads, the fee, and who it goes to.
// players: player name → optional per-player extras.
const PLAN = [
  { team: "12 Ruby", label: "12 Ruby", kind: "regional", fee: "$4,200", sportsyou: "XJAV-9C6Y", startTomorrow: true,
    players: { "Ava Boyle": {}, "Sydney Breckner": {} } },
  { team: "12 Rise 1", label: "12 Rise", kind: "rise", fee: "$2,400",
    players: { "Lilyana Oleksy": {}, "Ameliya Abbasova": {}, "Marlo Oswald": {}, "Morgan Haiges": {} } },
  { team: "11 Rise 1", label: "11 Rise", kind: "rise", fee: "$2,400",
    players: { "Juliet Afflixio": {}, "Charlee Hostetler": {}, "Ava Scarborough": {}, "Addison Ballman": {}, "Claire Davis": {}, "Sloan Scott": {} } },
  { team: "13 Rise 1", label: "13 Rise", kind: "rise", fee: "$2,400",
    players: { "Layla Brown": {}, "Julia Darcy": {}, "Alaina Donahue": {}, "Brooklyn Hostetler": {}, "Alex Jensen": {}, "Rose McIlrath": {}, "Adalyn Shepard": {}, "Brecklyn Thomas": {} } },
  // 13 Diamond is at Flex tomorrow, not the Warehouse.
  { team: "13 Diamond", label: "13 Diamond", kind: "practice", where: "DSSC Flex, 13673 Fitzhugh Rd, Suite 200, Dripping Springs", when: "3–5pm",
    players: { "Hadley Spencer": {} } },
  { team: "14 Emerald", label: "14 Emerald", kind: "regional", fee: "$4,200", sportsyou: "2CUF-EANL", startTomorrow: true,
    players: { "Juliette Nunez": {}, "Emery Roberts": {},
      "Camille Tisdale": { discount: "EA2B468VXL", discountNote: "As a coaching family, Camille's season fee is 50% off — use code EA2B468VXL when you register." } } },
  { team: "14 Topaz", label: "14 Topaz", kind: "regional", fee: "$4,200", sportsyou: "UYVD-WHUF", startTomorrow: true,
    players: { "Emily Schwarzlose": { email: "diana.schwarzlose@gmail.com" } } },
];

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const testTo = val("test"), doSend = args.includes("--send"), onlyTeam = val("team"), htmlOut = val("html");

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const TEAMS = PLAN.map(p => p.team);
const [{ data: teams }, { data: roster }, { data: pas }, { data: sas }, { data: tas }, { data: players }] = await Promise.all([
  sb.from("practice_teams").select("*").in("team_name", TEAMS),
  sb.from("coach_roster").select("first_name, last_name, email, phone"),
  sb.from("practice_assignments").select("team_name, phase, day, slot").in("team_name", TEAMS),
  sb.from("sa_sessions").select("team_name, block, session_date, slot").in("team_name", TEAMS).order("session_date"),
  sb.from("tournament_assignments").select("tournament_id, team_id").in("team_id", TEAMS),
  sb.from("players").select("id, first_name, last_name, team_assignment, offer_status, parent_name, parent2_name, parent_email, parent_email2, parent_email3, gear_form_token").eq("season", "2026-27"),
]);
const { data: tns } = await sb.from("tournaments").select("id, name, start_date, end_date, location, stay_over, cancelled")
  .in("id", [...new Set(tas.map(r => r.tournament_id))]).order("start_date");

// ── formatting ─────────────────────────────────────────────────────────────
const hr = (n) => (Number(n) === 12 ? 12 : Number(n) + 12);
const parse = (s) => { const m = /^(\d{1,2})\s*-\s*(\d{1,2})/.exec(String(s || "")); return m ? { a: hr(m[1]), b: hr(m[2]) } : null; };
const clock = (h) => (h > 12 ? h - 12 : h);
const span = (a, b) => clock(a) + "–" + clock(b) + "pm";
const merge = (slots) => {
  const r = slots.map(parse).filter(Boolean).sort((x, y) => x.a - y.a), out = [];
  for (const x of r) { const l = out[out.length - 1]; if (l && l.b === x.a) l.b = x.b; else out.push({ ...x }); }
  return out.map(x => span(x.a, x.b));
};
const d = (iso, o) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", ...o });
const range = (s, e) => !e || e === s ? d(s, { weekday: "short", month: "short", day: "numeric" })
  : d(s, { month: "short", day: "numeric" }) + "–" + (d(s, { month: "short" }) === d(e, { month: "short" }) ? d(e, { day: "numeric" }) : d(e, { month: "short", day: "numeric" }));
const cleanName = (s) => s.replace(/\s+—\s+(Oklahoma City|Dallas|Houston)\b.*$/, "").replace(/Girls Junior National Qualifier/, "National Qualifier").replace(/\s*--\s*14\/15's$/, "").replace(/\s{2,}/g, " ").trim();
const phone = (s) => { const x = String(s || "").replace(/\D/g, "").slice(-10); return x.length === 10 ? `(${x.slice(0, 3)}) ${x.slice(3, 6)}-${x.slice(6)}` : ""; };
const nm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const listOf = (xs) => xs.length === 1 ? xs[0] : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];

const coachesOf = (team) => {
  const t = teams.find(x => x.team_name === team) || {};
  return [["Head coach", t.head_coach], ["Assistant coach", t.assistant_coach], ["Coach", t.third_coach]]
    .filter(([, n]) => n).map(([role, n]) => {
      const r = roster.find(x => nm(x.first_name + x.last_name) === nm(n));
      return `${n} — ${role}${r?.phone ? " · " + phone(r.phone) : ""}${r?.email ? " · " + r.email.toLowerCase() : ""}`;
    });
};
const dayOf = (team, phase, day) => merge(pas.filter(p => p.team_name === team && p.phase === phase && p.day === day).map(p => p.slot));
const saOf = (team, block) => sas.filter(s => s.team_name === team && s.block === block);
const tourneysOf = (team) => tas.filter(a => a.team_id === team).map(a => tns.find(t => t.id === a.tournament_id))
  .filter(t => t && !t.cancelled).sort((a, b) => a.start_date.localeCompare(b.start_date))
  .map(t => `${range(t.start_date, t.end_date)} — ${cleanName(t.name)} (${t.location})${t.stay_over ? " · overnight" : ""}`);

// Fall/regular-season practice lines for a club team.
const regionalSchedule = (team) => {
  const out = [];
  const f1 = dayOf(team, "fall1", "Sun"), f2 = dayOf(team, "fall2", "Sun"), sa2 = saOf(team, "fall2")[0];
  if (f1.length) out.push(`Fall 1 — Sundays through Oct 11: ${f1.join(", ")}`);
  if (f2.length || sa2) out.push(`Fall 2 — Sundays Oct 18 to Nov 15: ${[sa2 ? span(parse(sa2.slot).a, parse(sa2.slot).b) + " speed & agility" : null, ...f2.map(x => x + " practice")].filter(Boolean).join(", ")}`);
  const ss = dayOf(team, "season", "Sun"), others = ["Mon", "Tue", "Wed", "Thu", "Fri"].flatMap(dy => dayOf(team, "season", dy).map(s => dy + " " + s));
  if (ss.length || others.length) out.push(`Regular season — from Sunday, Nov 29: ${[...ss.map(s => "Sun " + s), ...others].join(" · ")}`);
  const season = [...saOf(team, "season1"), ...saOf(team, "season2")];
  if (season.length) out.push(`Speed & agility in season: ${season.map(s => d(s.session_date, { month: "short", day: "numeric" }) + " " + span(parse(s.slot).a, parse(s.slot).b)).join(" · ")}`);
  return out;
};
const riseSchedule = (team) => {
  const ss = dayOf(team, "season", "Sun"), others = ["Mon", "Tue", "Wed", "Thu", "Fri"].flatMap(dy => dayOf(team, "season", dy).map(s => dy + " " + s));
  return [`Practice starts the weekend after Thanksgiving: ${[...ss.map(s => "Sun " + s), ...others].join(" · ")}`,
          `Until then, every Rise player is welcome at Rise Fall Camp on Saturdays.`];
};

// ── one email ──────────────────────────────────────────────────────────────
const build = (plan, p, extras) => {
  const girl = p.first_name.trim();
  const parents = [...new Set([p.parent_name, p.parent2_name].map(x => String(x || "").trim().split(/\s+/)[0]).filter(Boolean))];
  const greet = parents.length ? "Hi " + listOf(parents) + "," : "Hi,";
  const T = plan.label, rise = plan.kind === "rise";
  const gear = p.gear_form_token ? `${APP}/gear?t=${p.gear_form_token}` : null;
  const blocks = [];
  let subject, intro, outro;

  if (plan.kind === "practice") {
    const tomorrow = plan.when || merge(pas.filter(x => x.team_name === plan.team && x.phase === "fall1" && x.day === "Sun").map(x => x.slot)).join(", ");
    subject = `${girl} — an invitation to practice with ${T}`;
    intro = [
      `Thank you for bringing ${girl} to tryouts today — our coaches really enjoyed watching her play.`,
      `We'd like to invite ${girl} to practice with ${T} tomorrow, Sunday, September 20, ${tomorrow}, at ${plan.where || "the " + WAREHOUSE}. This isn't a roster spot yet: it's a chance for her to train with the team and for our coaches to see her in that group. After some time together we'd look at offering her a spot.`,
      `There's nothing to pay or register for right now. Just bring her in a pink DS Elite shirt if she has one, with knee pads and a water bottle.`,
    ];
    blocks.push([`Your ${T} coaches`, coachesOf(plan.team)]);
    blocks.push([`What ${T}'s season looks like`, [...regionalSchedule(plan.team), `Tournaments: ${tourneysOf(plan.team).length} this season, including a national qualifier.`]]);
    outro = `If tomorrow doesn't work, just reply and we'll find another practice. We're glad she's interested.`;
  } else {
    subject = `${girl} is invited to join DS Elite ${T}!`;
    intro = [
      `Congratulations! We'd love for ${girl} to join ${T} for the 2026-27 DS Elite season. Our coaches were impressed with her at tryouts today, and we think she'll be a great fit for this group.`,
      `Please register by ${DEADLINE} to accept her spot. If we don't hear from you by then, we'll offer the place to another player.`,
    ];
    if (extras.discountNote) intro.push(extras.discountNote);
    blocks.push(["Accepting her spot", [
      `Season fee: ${plan.fee}${extras.discount ? ` (use code ${extras.discount} for 50% off)` : ""}, paid in quarterly payments — no deposit.`,
      rise ? `It covers practices, coaching, tournament entry fees, court fees and her uniform (shoes not included).`
           : `It covers practices, coaching, tournament entry fees, court fees, her uniform package (shoes not included) and two blocks of strength and conditioning.`,
      `Register here: ${rise ? REG_RISE : REG_REGIONAL}`,
    ]]);
    blocks.push([`Your ${T} coaches`, coachesOf(plan.team).length ? coachesOf(plan.team) : ["We're finalising the coaching staff for this team and will introduce them shortly."]]);
    blocks.push(["Practice", rise ? riseSchedule(plan.team) : regionalSchedule(plan.team)]);
    // The Rise rosters are being built this weekend, so show the whole group —
    // who's already accepted, and who else is being invited alongside her.
    if (rise) blocks.push([`The ${T} roster so far`, [
      ...players.filter(x => x.team_assignment === plan.team && ["accepted", "made"].includes(x.offer_status))
        .map(x => `${x.first_name} ${x.last_name}${x.offer_status === "made" ? " — invited, deciding this weekend" : ""}`)
        .sort((a, b) => a.localeCompare(b)),
      `Anyone marked "deciding this weekend" has the same deadline you do, so the roster may shift slightly.`,
    ]]);
    if (rise) blocks.push(["Rise Fall Camp", [
      `Saturdays through the start of the season, at the Warehouse. It's the best way for ${girl} to get going right now.`,
      `Sign up: ${RISE_CAMP}`,
    ]]);
    const tourneys = tourneysOf(plan.team);
    blocks.push(["Tournaments", rise
      ? [`About six tournaments across the season — four one-day and two two-day events — finishing at ${tourneys.length ? tourneys[tourneys.length - 1].split(" — ")[1].replace(/ · overnight$/, "") : "Lone Star Regionals"}. We will confirm the full schedule shortly.`]
      : [...tourneys, `Overnight events are stay-to-play — we'll send hotel details closer to each one, so please don't book on your own.`]]);
    const next = [];
    if (plan.startTomorrow) next.unshift(`As soon as you register, ${girl} can practice with the team — starting tomorrow.`);
    if (plan.sportsyou) next.push(`SportsYou is where all team communication and the team calendar live. Download the app and join ${T} with code ${plan.sportsyou}.`);
    next.push(`Lone Star + USAV membership ($55) is required before she can be rostered or play a tournament: ${LONESTAR}`);
    if (gear) next.push(`Her player details and uniform sizes: ${gear}`);
    next.push(rise
      ? `Uniform fittings will be scheduled at a later date. For Rise teams that evening also covers orientation and the commitment meeting — we'll send the date as soon as it's set.`
      : `Uniform fittings will be scheduled at a later date — we'll send the date as soon as it's set.`);
    next.push(`Our club shoe is the Avoli Mid Supersonic Pink, out in November — please wait for our word before buying. Any white volleyball shoe works until then.`);
    next.push(`Club logos for spirit wear: ${APP}/logos`);
    blocks.push(["Once you've registered", next]);
    outro = `We're excited to have ${girl} with us. Any questions at all, just reply to this email.`;
  }

  const link = (s) => esc(s).replace(/(https?:\/\/\S+)/g, '<a href="$1" style="color:#c2186f">$1</a>');
  const text = `${greet}\n\n${intro.join("\n\n")}\n\n`
    + blocks.map(([h, items]) => `${h.toUpperCase()}\n${items.map(i => "  • " + i).join("\n")}`).join("\n\n")
    + `\n\n${outro}\n\nSee you on the court,\n\nDrew Rose\nDirector, DS Elite`;
  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:620px">'
    + `<p style="margin:0 0 14px">${esc(greet)}</p>`
    + intro.map(x => `<p style="margin:0 0 14px">${esc(x)}</p>`).join("")
    + blocks.map(([h, items]) =>
        `<p style="margin:24px 0 6px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">${esc(h)}</p>`
        + `<ul style="margin:0 0 10px;padding-left:20px">${items.map(i => `<li style="margin-bottom:5px">${link(i)}</li>`).join("")}</ul>`).join("")
    + `<p style="margin:20px 0 0">${esc(outro)}</p>`
    + `<p style="margin:14px 0 0">See you on the court,</p><p style="margin:10px 0 0">Drew Rose<br>Director, DS Elite</p></div>`;
  return { subject, text, html };
};

// ── jobs ───────────────────────────────────────────────────────────────────
const jobs = [];
for (const plan of PLAN) {
  if (onlyTeam && plan.team !== onlyTeam && plan.label !== onlyTeam) continue;
  for (const [name, extras] of Object.entries(plan.players)) {
    const p = players.find(x => nm(x.first_name + x.last_name) === nm(name));
    if (!p) { console.error(`NOT IN APP: ${name} (${plan.label})`); continue; }
    const to = [...new Set([extras.email, p.parent_email, p.parent_email2, p.parent_email3]
      .map(e => String(e || "").trim().toLowerCase()).filter(e => EMAIL_RE.test(e)))];
    if (!to.length) { console.error(`NO EMAIL: ${name} (${plan.label})`); continue; }
    jobs.push({ plan, p, to, ...build(plan, p, extras) });
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

console.log(`${jobs.length} emails · ${jobs.reduce((n, j) => n + j.to.length, 0)} addresses`);
for (const p of PLAN) {
  const mine = jobs.filter(j => j.plan.team === p.team);
  if (mine.length) console.log(`  ${p.label.padEnd(12)} ${p.kind.padEnd(9)} ${mine.map(j => j.p.first_name + " " + j.p.last_name).join(", ")}`);
}

// --html writes every email to one page, so they can be read without sending;
// a .json path writes the same emails as data for a review page.
if (htmlOut && htmlOut.endsWith(".json")) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(htmlOut, JSON.stringify(jobs.map(j => ({ group: j.plan.label, kind: j.plan.kind, player: `${j.p.first_name} ${j.p.last_name}`, to: j.to, subject: j.subject, html: j.html })), null, 1));
  console.log("wrote " + htmlOut);
} else if (htmlOut) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(htmlOut, '<!doctype html><meta charset="utf-8"><title>DS Elite invites — review</title>'
    + '<body style="background:#f4f2f3;font-family:-apple-system,Segoe UI,sans-serif;margin:0;padding:24px">'
    + `<h1 style="font-size:20px">${jobs.length} invites — nothing sent yet</h1>`
    + jobs.map(j => `<div style="background:#fff;border:1px solid #ddd;border-radius:12px;padding:18px;margin:0 0 18px;max-width:700px">`
        + `<div style="font-size:12px;color:#666">${esc(j.plan.label)} · to ${esc(j.to.join(", "))}</div>`
        + `<div style="font-size:16px;font-weight:700;margin:4px 0 12px">${esc(j.subject)}</div><hr style="border:none;border-top:1px solid #eee">${j.html}</div>`).join("")
    + "</body>");
  console.log("wrote " + htmlOut);
} else if (testTo) {
  for (const t of PLAN) {
    const j = jobs.find(x => x.plan.team === t.team);
    if (!j) continue;
    const err = await send({ ...j, subject: `[TEST ${t.label}] ${j.subject}` }, [testTo]);
    console.log(err ? `FAILED ${t.label}: ${err}` : `test sent: ${t.label} (${j.p.first_name})`);
  }
} else if (doSend) {
  let ok = 0;
  for (const j of jobs) {
    const err = await send(j, j.to);
    if (err) console.error(`FAILED ${j.p.first_name} ${j.p.last_name}: ${err}`);
    else { ok++; console.log(`sent ${j.plan.label.padEnd(12)} ${(j.p.first_name + " " + j.p.last_name).padEnd(22)} → ${j.to.join(", ")}`); }
  }
  console.log(`\n${ok}/${jobs.length} sent`);
} else {
  // One sample per team normally; every email when a single team is named.
  for (const t of PLAN) {
    const mine = jobs.filter(x => x.plan.team === t.team);
    for (const j of (onlyTeam ? mine : mine.slice(0, 1))) {
      console.log("\n" + "═".repeat(74) + `\n${t.label} — ${j.p.first_name} ${j.p.last_name} → ${j.to.join(", ")}\nSUBJECT: ${j.subject}\n` + "─".repeat(74) + "\n" + j.text);
    }
  }
  console.log("\nDRY RUN — --test <email> or --send.");
}
