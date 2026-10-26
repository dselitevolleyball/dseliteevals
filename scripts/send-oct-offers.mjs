// Late DS Elite offers, 26 Oct 2026: five players joining teams mid-preseason.
//   Harper Kent → 11 Rise · Isla Melendez → 12 Rise · Lucy Burgoyne → 13 Ruby
//   Elizabeth Wolfson → 14 Emerald · Claire Cox → 15 Sapphire
//
// One email per player, built like scripts/send-late-invite.mjs: the offer and
// how to accept, then everything the team has been told so far as it stands
// today. Coaches, practices, speed & agility, tournaments and teammates are
// read from the DB, so the email says what the SportsYou calendar says. The
// player's onboarding form is the /gear form (birthday, address, both parents'
// contacts, school and school team, medical, uniform sizes), pre-filled with
// whatever we already hold.
//
// Fees, deposits and registration links are the team's invite terms (TERMS) -
// confirm them before sending. Kristen and Tionne get a copy of each (CC).
// Rise emails say nothing about shoes; Regional ones link the club shoe.
// On --send each player is marked Offered
// (offer_status 'made', offer_made_at).
//
// DRY RUN BY DEFAULT.
//   node scripts/send-oct-offers.mjs                          # print all five
//   node scripts/send-oct-offers.mjs --html preview.html      # all five as one HTML page
//   node scripts/send-oct-offers.mjs --test drew@dselitevolleyball.com
//   node scripts/send-oct-offers.mjs --send [--only 447,448]
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env (or the environment).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const PLAYER_IDS = [447, 449, 109, 448, 50];   // Harper Kent, Isla Melendez, Lucy Burgoyne, Elizabeth Wolfson, Claire Cox
const DEADLINE = "Saturday, October 31, at 6:00pm";
const WAREHOUSE = "DSSC Warehouse, 15113 Fitzhugh Rd, Suite 1400, Dripping Springs";
const REG_REGIONAL = "https://dselitevolleyball.sportngin.com/register/form/644251518";
const REG_RISE = "https://dselitevolleyball.sportngin.com/register/form/029858282";
const RISE_CAMP = "https://drippingsports.playbookapi.com/programs/more_info/class_package/77559/";
const LONESTAR = "https://memberships.sportsengine.com/org/lone-star-region-volleyball/affiliation/ds-elite-volleyball-ds-elite";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Each offer is copied to these (send-email has no cc - each gets their own copy).
const CC = ["kristen@dselitevolleyball.com", "tionne@drippingsportsclub.com"];
// Regional players buy the club shoe themselves; Rise emails don't mention shoes at all.
const SHOE_URL = "https://avoli.com/products/avoli-mid-retro-bright-copy";

// Invite terms per team. Regional: the Sept invites. Rise: the Oct 5 13 Rise late invite.
const REGIONAL = { kind: "regional", level: "Regional", fee: "Season fee: $4,200, paid in quarterly payments - no deposit.", register: REG_REGIONAL };
const RISE = { kind: "rise", level: "Rise", fee: "Season fee: $2,500. A $600 deposit holds her spot, then two payments: October 1 and January 1. (Since October 1 has passed, that payment is due when you register.)", register: REG_RISE };
const TERMS = {
  "11 Rise 1": { ...RISE, label: "11 Rise", sportsyou: "NJ7E-CSBS" },
  "12 Rise 1": { ...RISE, label: "12 Rise", sportsyou: "XP88-JSA6" },
  "13 Ruby": { ...REGIONAL, label: "13 Ruby", sportsyou: "QEZQ-T36X" },
  "14 Emerald": { ...REGIONAL, label: "14 Emerald", sportsyou: "2CUF-EANL" },
  "15 Sapphire": { ...REGIONAL, label: "15 Sapphire", sportsyou: "7NPR-Z9SC",
    teamParents: [["Ann Paclik", "Penny", "annwhitepaclik@yahoo.com"], ["Jonson Sandberg", "Anna", "jonson_sandberg@hotmail.com"], ["Kelli Murdock", "Olivia", "kellimurdock85@gmail.com"], ["Megan Houser", "Harper", "memhouser@gmail.com"]] },
};

const env = { ...process.env };
if (existsSync(new URL("../.env", import.meta.url))) for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const testTo = val("test"), doSend = args.includes("--send"), htmlOut = val("html");
const only = (val("only") || "").split(",").map(Number).filter(Boolean);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: players, error } = await sb.from("players")
  .select("id, first_name, last_name, team_assignment, parent_name, parent2_name, parent_email, parent_email2, parent_email3, commitment_token, photo_upload_token, gear_form_token")
  .in("id", only.length ? only : PLAYER_IDS);
if (error) { console.error(error.message); process.exit(1); }
const { data: roster } = await sb.from("coach_roster").select("first_name, last_name, email, phone");
const today = new Date().toISOString().slice(0, 10);

// ── formatting ─────────────────────────────────────────────────────────────
const hr = (n) => (Number(n) === 12 ? 12 : Number(n) + 12);
const parse = (s) => { const m = /^(\d{1,2})\s*-\s*(\d{1,2})/.exec(String(s || "")); return m ? { a: hr(m[1]), b: hr(m[2]) } : null; };
const clock = (h) => (h > 12 ? h - 12 : h);
const span = (a, b) => clock(a) + "-" + clock(b) + "pm";
const merged = (slots) => {
  const r = slots.map(parse).filter(Boolean).sort((x, y) => x.a - y.a), out = [];
  for (const x of r) { const l = out[out.length - 1]; if (l && l.b === x.a) l.b = x.b; else out.push({ ...x }); }
  return out.map(x => span(x.a, x.b));
};
const d = (iso, o) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", ...o });
const short = (iso) => d(iso, { month: "short", day: "numeric" });
const range = (s, e) => !e || e === s ? d(s, { weekday: "short", month: "short", day: "numeric" })
  : d(s, { month: "short", day: "numeric" }) + "-" + (d(s, { month: "short" }) === d(e, { month: "short" }) ? d(e, { day: "numeric" }) : short(e));
const phone = (s) => { const x = String(s || "").replace(/\D/g, "").slice(-10); return x.length === 10 ? `(${x.slice(0, 3)}) ${x.slice(3, 6)}-${x.slice(6)}` : ""; };
const nm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const listOf = (xs) => xs.length === 1 ? xs[0] : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1" style="color:#c2186f">$1</a>');

async function teamData(team) {
  const [{ data: pt }, { data: pa }, { data: sa }, { data: ta }, { data: ev }, { data: mates }] = await Promise.all([
    sb.from("practice_teams").select("head_coach, assistant_coach, third_coach").eq("team_name", team).single(),
    sb.from("practice_assignments").select("phase, day, slot").eq("team_name", team),
    sb.from("sa_sessions").select("block, session_date, slot").eq("team_name", team).gte("session_date", today).order("session_date"),
    sb.from("tournament_assignments").select("tournament_id").eq("team_id", team),
    sb.from("team_events").select("title, event_date, start_time").eq("team_name", team).gte("event_date", today).order("start_time"),
    sb.from("players").select("first_name, last_name, offer_status").eq("team_assignment", team),
  ]);
  const { data: tns } = await sb.from("tournaments").select("name, start_date, end_date, location, stay_over, cancelled").in("id", (ta || []).map(r => r.tournament_id)).order("start_date");
  const coaches = [["Head coach", pt.head_coach], ["Assistant coach", pt.assistant_coach], ["Coach", pt.third_coach]].filter(([, n]) => n).map(([role, n]) => {
    const r = (roster || []).find(x => nm(x.first_name + x.last_name) === nm(n));
    return `${n} - ${role}${r?.phone ? " · " + phone(r.phone) : ""}${r?.email ? " · " + r.email.toLowerCase() : ""}`;
  });
  const byPhase = (ph, day) => merged((pa || []).filter(r => r.phase === ph && r.day === day).map(r => r.slot));
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const season = DAYS.flatMap(dy => byPhase("season", dy).map(x => `${dy} ${x}`));
  const fall2 = byPhase("fall2", "Sun");
  const saBy = (b) => (sa || []).filter(s => s.block === b);
  const fall2SA = saBy("fall2");
  const seasonSA = [...saBy("season1"), ...saBy("season2")].map(s => `${d(s.session_date, { weekday: "short", month: "short", day: "numeric" })}, ${span(parse(s.slot).a, parse(s.slot).b)}`);
  const inHouse = (ev || []).filter(e => /tournament/i.test(e.title));
  const tourneys = (tns || []).filter(t => !t.cancelled && (t.end_date || t.start_date) >= today).map(t => {
    const where = /oklahoma city/i.test(t.name) ? "Oklahoma City, OK" : t.location;
    const name = t.name.replace(/\s+—\s+Oklahoma City.*$/, "").replace(/\s*--\s*\d+\/\d+'s$/, "").replace(/\s+#\s+/, " #").trim();
    return `${range(t.start_date, t.end_date)} - ${name}${where ? ` (${where})` : ""}${t.stay_over ? " · overnight" : ""}`;
  });
  const teammates = (mates || []).filter(p => ["accepted", "locked"].includes(p.offer_status)).map(p => `${p.first_name} ${p.last_name}`).sort((a, b) => a.localeCompare(b));
  return { coaches, season, fall2, fall2SA, seasonSA, inHouse, tourneys, teammates };
}

function build(p, t, T) {
  const girl = p.first_name.trim(), team = T.label;
  const parents = [...new Set([p.parent_name, p.parent2_name].map(x => String(x || "").trim().split(/\s+/)[0]).filter(Boolean))];
  const greet = parents.length ? `Hi ${listOf(parents)},` : "Hi there,";
  const gear = testTo ? `${APP}/gear?preview=1` : `${APP}/gear?t=${p.gear_form_token}`;
  const commit = testTo ? `${APP}/commitment?preview=1` : `${APP}/commitment?t=${p.commitment_token}`;
  const photos = testTo ? `${APP}/photos?preview=1` : `${APP}/photos?t=${p.photo_upload_token}`;
  const sched = T.kind === "rise" ? [
    `Team practices start the weekend after Thanksgiving: ${t.season.join(" · ")}, at the ${WAREHOUSE}.`,
    `Until then, every Rise player is welcome at Rise Fall Camp on Saturdays at the Warehouse - the best way for ${girl} to get going and meet her teammates. Sign up: ${RISE_CAMP}`,
  ] : [
    ...(t.fall2.length ? [`Fall practices (optional but strongly encouraged - this is where the team is being built): Sundays through Nov 15, ${t.fall2.join(", ")}${t.fall2SA.length ? `, plus speed & agility with Reach Performance ${span(parse(t.fall2SA[0].slot).a, parse(t.fall2SA[0].slot).b)}` : ""}.`] : []),
    `Regular season, from late November: ${t.season.join(" · ")}.`,
    `All practices are at the ${WAREHOUSE}; SportsYou has the exact court for each one.`,
    ...(t.inHouse.length ? [`${d(t.inHouse[0].event_date, { weekday: "long", month: "long", day: "numeric" })}: DS Elite in-house tournament at the Warehouse.`] : []),
  ];
  const blocks = [
    ["Accepting her spot", [
      T.fee,
      `It covers practices, coaching, tournament entry fees, court fees and her uniform${T.kind === "rise" ? "" : " (shoes not included)"}.`,
      `Register here by ${DEADLINE}: ${T.register}`,
    ]],
    ["Her onboarding form - please fill this in right away", [
      `One form for everything we need: ${girl}'s birthday and address, both parents' names, emails and phones, her own phone and email, her position, anything medical or allergies we should know, her school and any school team, and her uniform sizes so we can order it. Whatever we already have is filled in - just check it and add the rest: ${gear}`,
    ]],
    [`Your ${team} coaches`, t.coaches],
    ["Join SportsYou", [
      `All team communication and the team calendar run through SportsYou. Download the app and join ${team} with code ${T.sportsyou} - every practice and tournament is already on the calendar, and it updates itself when anything changes. Each parent can join, and ${girl} can too.`,
    ]],
    ["Practice schedule", sched],
    ...(T.kind === "regional" && t.seasonSA.length ? [["Speed & agility · regular season", [`Five sessions with Reach Performance, each an hour right before or after practice: ${t.seasonSA.join("; ")}.`]]] : []),
    ["Tournaments", t.tourneys.length ? [...t.tourneys, "We'll send hotel and stay-to-play details before each overnight event - please don't book rooms yet."] : ["About six tournaments across the season, finishing at Lone Star Regionals. We'll confirm the full schedule shortly."]],
    ...(t.teammates.length ? [[`Her ${team} teammates`, [t.teammates.join(", ")]]] : []),
    ...(T.teamParents ? [["Team parents", [`These parents handle family communication and tournament logistics for ${team} - a great first call for "how does this work" questions:`, ...T.teamParents.map(([n, kid, e]) => `${n} (${kid}'s parent) - ${e}`)]]] : []),
    ["Once you've registered", [
      `Lone Star + USAV membership ($55) is required before she can be rostered or play a tournament: ${LONESTAR}`,
      `The DS Elite commitment: ${girl} and a parent each sign it, in your own names. The team went through it together at orientation: ${commit}`,
      ...(T.kind === "rise" ? [] : [`Shoes: our club shoe is the Avoli Mid Supersonic Pink ($180), which families buy on their own from Avoli. It's restocking in November - if it shows sold out, tap "Notify me" for an alert when it's back. Any white volleyball shoe works until then: ${SHOE_URL}`]),
      `Scorekeeping: every player needs to be scorekeeping certified. Coach Kristen has the details in SportsYou - kristen@dselitevolleyball.com.`,
      `Team photos: ${girl}'s own link for sharing photos of ${team} all season: ${photos}`,
    ]],
  ];
  const intro = [
    `Congratulations! We'd love for ${girl} to join ${team} for the 2026-27 DS Elite season. We think she'll be a great fit for this group, and there's a spot for her now.`,
    `The team has already started, so this email catches you up on everything the other families have been sent. It's long - please read it through and keep it. If we haven't heard from you by ${DEADLINE}, we'll offer the place to another player.`,
  ];
  const outro = `We're excited to have ${girl} with us. Any questions at all, just reply to this email.`;
  const subject = `${girl} is invited to join DS Elite ${team}!`;
  const text = `${greet}\n\n${intro.join("\n\n")}\n\n` + blocks.map(([h, items]) => `${h.toUpperCase()}\n${items.map(i => "  • " + i).join("\n")}`).join("\n\n") + `\n\n${outro}\n\nSee you on the court,\n\nDrew Rose\nDirector, DS Elite`;
  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:620px">'
    + `<p style="margin:0 0 14px">${esc(greet)}</p>` + intro.map(x => `<p style="margin:0 0 14px">${esc(x)}</p>`).join("")
    + blocks.map(([h, items]) => `<p style="margin:24px 0 6px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">${esc(h)}</p><ul style="margin:0 0 10px;padding-left:20px">${items.map(i => `<li style="margin-bottom:5px">${linkify(i)}</li>`).join("")}</ul>`).join("")
    + `<p style="margin:20px 0 0">${esc(outro)}</p><p style="margin:14px 0 0">See you on the court,</p><p style="margin:10px 0 0">Drew Rose<br>Director, DS Elite</p></div>`;
  return { subject, text, html };
}

const jobs = [];
for (const p of players.sort((a, b) => PLAYER_IDS.indexOf(a.id) - PLAYER_IDS.indexOf(b.id))) {
  const T = TERMS[p.team_assignment];
  if (!T) { console.error(`No terms for ${p.team_assignment} (${p.first_name} ${p.last_name})`); process.exit(1); }
  const to = [...new Set([p.parent_email, p.parent_email2, p.parent_email3].map(e => String(e || "").trim().toLowerCase()).filter(e => EMAIL_RE.test(e)))];
  jobs.push({ p, to, ...build(p, await teamData(p.team_assignment), T) });
}

const send = async (j, recipients, subject = j.subject) => {
  const r = await fetch(APP + "/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject, body: j.text, bodyHtml: j.html, recipients, replyTo: SENDER.email, sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script", skipPush: true }) });
  const o = await r.json().catch(() => ({})); return r.ok && o.ok ? null : (o.error || String(r.status));
};

if (htmlOut) {
  writeFileSync(htmlOut, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DS Elite offers - preview</title><body style="margin:0;background:#f4f4f4;padding:16px">`
    + jobs.map(j => `<div style="background:#fff;max-width:660px;margin:0 auto 28px;padding:22px;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08)"><div style="font:13px -apple-system,sans-serif;color:#666;border-bottom:1px solid #eee;padding-bottom:10px;margin-bottom:16px"><b>To:</b> ${esc(j.to.join(", "))}<br><b>Copy:</b> ${esc(CC.join(", "))}<br><b>Subject:</b> ${esc(j.subject)}</div>${j.html}</div>`).join("") + "</body>");
  console.log("wrote " + htmlOut);
}
if (testTo) { for (const j of jobs) console.log(j.p.first_name, (await send(j, [testTo], "[TEST] " + j.subject)) || "test sent to " + testTo); }
else if (doSend) {
  for (const j of jobs) {
    if (!j.to.length || !j.p.gear_form_token) { console.log(j.p.first_name, "SKIPPED - no email or form link"); continue; }
    const e = await send(j, [...j.to, ...CC.filter(c => !j.to.includes(c))]);
    if (!e) await sb.from("players").update({ offer_status: "made", offer_made_at: new Date().toISOString() }).eq("id", j.p.id);
    console.log(j.p.first_name, "→", j.to.join(", "), "· copy to", CC.join(", "), e || "sent · marked Offered");
  }
} else if (!htmlOut) for (const j of jobs) console.log("\n" + "═".repeat(72) + `\n${j.p.first_name} ${j.p.last_name} → ${j.to.join(", ")}\nSUBJECT: ${j.subject}\n` + "─".repeat(72) + "\n" + j.text);
