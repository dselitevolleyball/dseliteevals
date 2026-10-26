// Regular-season practice schedule to every DS Elite family (Oct 2026), one
// email per team, built from what HQ holds - the same facts the SportsYou
// calendar feed (api/calendar.js) publishes:
//   • weekly practices from Nov 29 (a slot with active_from / active_to says
//     "through Jan 31" / "from Feb 1")
//   • days off that land on this team's practice days (practice_cancellations:
//     the in-house tournament, NCAA outing, holidays, spring break, Easter)
//   • Sundays with no practice because the team is at a tournament that
//     weekend (same Fri-Sun rule as the feed)
//   • regular-season speed & agility dates, and the coaches
//
// Audience: families of players on a real (non-event) team with an accepted /
// locked offer. Pending offers ('made') are left out - their offer email just
// told them all of this.
//
// PLAN overrides the DB for the preview while a schedule change waits for
// approval (14 Sapphire: Monday nights through January, then Thursdays). With
// --send the DB must already say the same thing, or the script stops.
//
// DRY RUN BY DEFAULT.
//   node scripts/send-season-schedule.mjs                       # summary per team
//   node scripts/send-season-schedule.mjs --html preview.html   # every team's email as one page
//   node scripts/send-season-schedule.mjs --test drew@dselitevolleyball.com [--team "14 Sapphire"]
//   node scripts/send-season-schedule.mjs --send [--team "14 Sapphire"]
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (.env or the environment).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { isEventTeam } from "../shared/event-teams.js";

const APP = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const SEASON_START = "2026-11-29", SEASON_END = "2027-05-06";
const WAREHOUSE = "DSSC Warehouse, 15113 Fitzhugh Rd, Suite 1400, Dripping Springs";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Schedule changes waiting on approval: what the team's regular-season slots will be.
const PLAN = {
  "14 Sapphire": {
    slots: [
      { day: "Sun", slot: "1-3pm" },
      { day: "Mon", slot: "7-9pm", active_to: "2027-01-31" },
      { day: "Thu", slot: "7-9pm", active_from: "2027-02-01" },
    ],
    note: "One change for 14 Sapphire: through January, the weeknight practice is on Monday nights while basketball has the courts on Thursdays. Once basketball season is over, we move to Thursday nights from February 1.",
  },
};

const env = { ...process.env };
if (existsSync(new URL("../.env", import.meta.url))) for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const testTo = val("test"), doSend = args.includes("--send"), htmlOut = val("html"), onlyTeam = val("team");
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const all = async (table, sel, f = (q) => q) => { const out = []; for (let i = 0; ; i += 1000) { const { data, error } = await f(sb.from(table).select(sel)).range(i, i + 999); if (error) throw new Error(table + ": " + error.message); out.push(...data); if (data.length < 1000) break; } return out; };
const [teams, assigns, sa, tAssign, tns, cancels, events, players, roster] = await Promise.all([
  all("practice_teams", "team_name, level, practices_per_week, head_coach, assistant_coach, third_coach"),
  all("practice_assignments", "team_name, phase, day, slot, active_from, active_to", q => q.eq("phase", "season")),
  all("sa_sessions", "team_name, block, session_date, slot", q => q.gte("session_date", SEASON_START).lte("session_date", SEASON_END)),
  all("tournament_assignments", "team_id, tournament_id, status"),
  all("tournaments", "id, name, start_date, end_date, cancelled"),
  all("practice_cancellations", "practice_date, reason, team_name", q => q.gte("practice_date", SEASON_START).lte("practice_date", SEASON_END)),
  all("team_events", "team_name, title, event_date, start_time", q => q.gte("event_date", SEASON_START).lte("event_date", SEASON_END)),
  all("players", "id, first_name, last_name, team_assignment, offer_status, parent_name, parent2_name, parent_email, parent_email2, parent_email3"),
  all("coach_roster", "first_name, last_name, email, phone"),
]);

// ── helpers ────────────────────────────────────────────────────────────────
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PLURAL = { Sun: "Sundays", Mon: "Mondays", Tue: "Tuesdays", Wed: "Wednesdays", Thu: "Thursdays", Fri: "Fridays", Sat: "Saturdays" };
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (iso) => DAYS[new Date(iso + "T12:00:00Z").getUTCDay()];
const fmt = (iso, o = { weekday: "short", month: "short", day: "numeric" }) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", ...o });
const md = (iso) => fmt(iso, { month: "short", day: "numeric" });
const hr = (n) => (Number(n) === 12 ? 12 : Number(n) + 12);
const parse = (s) => { const m = /^(\d{1,2})\s*-\s*(\d{1,2})/.exec(String(s || "")); return m ? [hr(m[1]), hr(m[2])] : null; };
const clock = (h) => (h > 12 ? h - 12 : h);
const span = (s) => { const p = parse(s); return p ? `${clock(p[0])}-${clock(p[1])}pm` : s; };
const merge = (slots) => { const r = slots.map(parse).filter(Boolean).sort((a, b) => a[0] - b[0]), out = []; for (const x of r) { const l = out[out.length - 1]; if (l && l[1] === x[0]) l[1] = x[1]; else out.push([...x]); } return out; };
const phone = (s) => { const x = String(s || "").replace(/\D/g, "").slice(-10); return x.length === 10 ? `(${x.slice(0, 3)}) ${x.slice(3, 6)}-${x.slice(6)}` : ""; };
const nm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const listOf = (xs) => xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
const label = (t) => t.replace(/^(\d+ Rise) 1$/, "$1");
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const activeOn = (a, d) => (!a.active_from || d >= String(a.active_from).slice(0, 10)) && (!a.active_to || d <= String(a.active_to).slice(0, 10));
const firstOn = (from, day) => { let d = from; while (dow(d) !== day) d = addDays(d, 1); return d; };
const datesOf = (day, from, to) => { const out = []; for (let d = firstOn(from, day); d <= to; d = addDays(d, 7)) out.push(d); return out; };
const tnById = new Map(tns.map(t => [t.id, t]));

function build(teamName) {
  const t = teams.find(x => x.team_name === teamName), T = label(teamName);
  const plan = PLAN[teamName];
  const slots = plan ? plan.slots : assigns.filter(a => a.team_name === teamName);
  // Weekly lines: one per day (and per date window), hours merged.
  const byKey = new Map();
  for (const a of slots) { const k = [a.day, a.active_from || "", a.active_to || ""].join("|"); (byKey.get(k) || byKey.set(k, []).get(k)).push(a.slot); }
  const weekly = [...byKey.entries()].sort((a, b) => DAYS.indexOf(a[0].split("|")[0]) - DAYS.indexOf(b[0].split("|")[0]) || a[0].localeCompare(b[0])).map(([k, list]) => {
    const [day, from, to] = k.split("|");
    const when = merge(list).map(([s, e]) => `${clock(s)}-${clock(e)}pm`).join(" and ");
    return `${PLURAL[day]}, ${when}${to ? ` - through ${fmt(to, { month: "long", day: "numeric" })}` : ""}${from ? ` - from ${fmt(from, { month: "long", day: "numeric" })}` : ""}`;
  });
  // Every date this team would practice, to see which days off actually hit it.
  const practiceDates = new Set(slots.flatMap(a => datesOf(a.day, SEASON_START, SEASON_END).filter(d => activeOn(a, d))));
  // Days off, grouped into runs (same reason, under a week apart) across every
  // date the club or this team is off - so the holiday break reads as one range -
  // and kept only where a run lands on one of this team's practice days.
  const mine = cancels.filter(c => !c.team_name || c.team_name === teamName).sort((a, b) => a.practice_date.localeCompare(b.practice_date));
  const reasonOf = (c) => /in-house/i.test(c.reason || "") ? "DS Elite in-house tournament" : /ncaa/i.test(c.reason || "") ? "NCAA Championship group outing at the Alamodome" : (c.reason || "No practice");
  const runs = [];
  for (const c of mine) {
    const reason = reasonOf(c), g = runs[runs.length - 1];
    if (g && g.reason === reason && c.practice_date <= addDays(g.to, 7)) { g.to = c.practice_date; g.dates.push(c.practice_date); }
    else runs.push({ reason, from: c.practice_date, to: c.practice_date, dates: [c.practice_date] });
  }
  const groups = runs.filter(g => g.dates.some(d => practiceDates.has(d)));
  const offs = mine.filter(c => practiceDates.has(c.practice_date));
  const offLines = groups.map(g => `${g.from === g.to ? fmt(g.from) : `${fmt(g.from)} - ${fmt(g.to)}`}: ${g.reason}${/holiday/i.test(g.reason) ? " break" : ""}`);
  // Tournament weekends: no Sunday practice (same rule as the feed).
  const goneSun = new Set();
  for (const a of tAssign.filter(x => x.team_id === teamName)) {
    const tn = tnById.get(a.tournament_id);
    if (!tn || tn.cancelled || !tn.start_date || a.status === "dropped") continue;
    const end = tn.end_date || tn.start_date;
    if (!(end > tn.start_date || a.status === "locked")) continue;
    for (let s = firstOn(tn.start_date, "Sun"); s <= addDays(end, 2); s = addDays(s, 7)) if (practiceDates.has(s) && !offs.some(c => c.practice_date === s)) goneSun.add(s);
  }
  const tourneySundays = [...goneSun].sort();
  // The in-house tournament (team_events on Nov 29).
  const inHouse = events.filter(e => e.team_name === teamName && /tournament/i.test(e.title)).sort((a, b) => a.start_time.localeCompare(b.start_time));
  const inHouseLine = inHouse.length ? `${fmt(inHouse[0].event_date, { weekday: "long", month: "long", day: "numeric" })}: DS Elite in-house tournament at the Warehouse - ${inHouse.map(e => `${clock(Number(e.start_time.slice(0, 2)))}${Number(e.start_time.slice(0, 2)) >= 12 ? "pm" : "am"} ${e.title.replace(/^Tournament\s*—\s*/, "").replace(/^vs /, "vs ").replace(/^WORK /, "working ")}`).join(", ")}.` : "";
  const saDates = sa.filter(s => s.team_name === teamName).sort((a, b) => a.session_date.localeCompare(b.session_date)).map(s => `${fmt(s.session_date)}, ${span(s.slot)}`);
  const coaches = [["Head coach", t.head_coach], ["Assistant coach", t.assistant_coach], ["Coach", t.third_coach]].filter(([, n]) => n).map(([role, n]) => {
    const r = roster.find(x => nm(x.first_name + x.last_name) === nm(n));
    return `${n} - ${role}${r?.phone ? " · " + phone(r.phone) : ""}${r?.email ? " · " + r.email.toLowerCase() : ""}`;
  });
  const blocks = [
    ["Weekly practices, from Sunday, November 29", [...weekly, `All at the ${WAREHOUSE}. SportsYou shows the court for each one.`]],
    ...(plan?.note ? [["What's changed", [plan.note]]] : []),
    ["No practice on these dates", [
      ...(inHouseLine ? [inHouseLine] : []),
      ...offLines.filter(l => !(inHouseLine && /in-house/.test(l))),
      ...(tourneySundays.length ? [`Tournament weekends (no Sunday practice): ${tourneySundays.map(md).join(", ")}`] : []),
    ]],
    ...(saDates.length ? [["Speed & agility with Reach Performance", [`Five sessions in the regular season, each an hour right before or after practice:`, ...saDates]]] : []),
    [`Your ${T} coaches`, coaches],
  ];
  const intro = [
    `The regular season starts the weekend after Thanksgiving, and here is ${T}'s practice schedule for it. Everything below is already on the ${T} calendar in SportsYou, which is always the final word if anything changes.`,
  ];
  return { T, blocks, intro, subject: `${T}: regular-season practice schedule`, weekly, offLines, tourneySundays, saDates };
}

const render = (team, greet) => {
  const outro = "If anything doesn't work for your family, talk to your coach or just reply to this email.";
  const text = `${greet}\n\n${team.intro.join("\n\n")}\n\n` + team.blocks.map(([h, items]) => `${h.toUpperCase()}\n${items.map(i => "  • " + i).join("\n")}`).join("\n\n") + `\n\n${outro}\n\nSee you in the gym,\n\nDrew Rose\nDirector, DS Elite`;
  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:620px">'
    + `<p style="margin:0 0 14px">${esc(greet)}</p>` + team.intro.map(x => `<p style="margin:0 0 14px">${esc(x)}</p>`).join("")
    + team.blocks.map(([h, items]) => `<p style="margin:24px 0 6px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">${esc(h)}</p><ul style="margin:0 0 10px;padding-left:20px">${items.map(i => `<li style="margin-bottom:5px">${esc(i)}</li>`).join("")}</ul>`).join("")
    + `<p style="margin:20px 0 0">${esc(outro)}</p><p style="margin:14px 0 0">See you in the gym,</p><p style="margin:10px 0 0">Drew Rose<br>Director, DS Elite</p></div>`;
  return { text, html };
};

// ── who gets which email ───────────────────────────────────────────────────
const realTeams = teams.filter(t => !isEventTeam(t) && (!onlyTeam || t.team_name === onlyTeam)).map(t => t.team_name)
  .sort((a, b) => (parseInt(a) || 99) - (parseInt(b) || 99) || a.localeCompare(b));
const jobs = [];
for (const teamName of realTeams) {
  const team = build(teamName);
  const fams = new Map();   // email → { names:Set, girls:Set }
  for (const p of players.filter(x => x.team_assignment === teamName && ["accepted", "locked"].includes(x.offer_status))) {
    const parents = [p.parent_name, p.parent2_name].map(x => String(x || "").trim().split(/\s+/)[0]).filter(Boolean);
    for (const e of [p.parent_email, p.parent_email2, p.parent_email3].map(x => String(x || "").trim().toLowerCase()).filter(x => EMAIL_RE.test(x))) {
      const f = fams.get(e) || { names: new Set(), girls: new Set() };
      parents.forEach(n => f.names.add(n)); f.girls.add(p.first_name.trim()); fams.set(e, f);
    }
  }
  jobs.push({ teamName, team, fams });
}

const send = async (subject, body, recipients) => {
  const r = await fetch(APP + "/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject, body: body.text, bodyHtml: body.html, recipients, replyTo: SENDER.email, sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script", skipPush: true }) });
  const o = await r.json().catch(() => ({})); return r.ok && o.ok ? null : (o.error || String(r.status));
};
const greetFor = (f) => f && f.names.size ? `Hi ${listOf([...f.names])},` : "Hi there,";

if (htmlOut) {
  writeFileSync(htmlOut, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Regular-season schedule emails - preview</title><body style="margin:0;background:#f4f4f4;padding:16px;font-family:-apple-system,sans-serif">`
    + `<div style="max-width:660px;margin:0 auto 18px;font-size:14px;color:#333"><b>${jobs.length} teams · ${jobs.reduce((n, j) => n + j.fams.size, 0)} family email addresses.</b> Each family gets its own team's email, greeted by name. Jump to: ${jobs.map(j => `<a href="#${encodeURIComponent(j.teamName)}">${esc(j.team.T)}</a>`).join(" · ")}</div>`
    + jobs.map(j => { const first = [...j.fams.values()][0]; const b = render(j.team, greetFor(first)); return `<div id="${encodeURIComponent(j.teamName)}" style="background:#fff;max-width:660px;margin:0 auto 28px;padding:22px;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08)"><div style="font-size:13px;color:#666;border-bottom:1px solid #eee;padding-bottom:10px;margin-bottom:16px"><b>To:</b> ${j.fams.size} ${esc(j.team.T)} family addresses${PLAN[j.teamName] ? ' · <span style="color:#c2186f;font-weight:700">schedule change waiting for your OK</span>' : ""}<br><b>Subject:</b> ${esc(j.team.subject)}</div>${b.html}</div>`; }).join("") + "</body>");
  console.log("wrote " + htmlOut);
}
if (testTo) {
  for (const j of jobs) { const first = [...j.fams.values()][0]; console.log(j.team.T, (await send("[TEST] " + j.team.subject, render(j.team, greetFor(first)), [testTo])) || "test sent"); }
} else if (doSend) {
  // A planned change must be in the DB first, so SportsYou and the email agree.
  for (const [team, plan] of Object.entries(PLAN)) {
    if (onlyTeam && onlyTeam !== team) continue;
    const have = assigns.filter(a => a.team_name === team).map(a => [a.day, a.slot, a.active_from || "", a.active_to || ""].join("|")).sort().join(",");
    const want = plan.slots.map(a => [a.day, a.slot, a.active_from || "", a.active_to || ""].join("|")).sort().join(",");
    if (have !== want) { console.error(`${team}: HQ's schedule doesn't match the planned change yet - apply it first.\n  HQ:   ${have}\n  plan: ${want}`); process.exit(1); }
  }
  let sent = 0, failed = 0;
  for (const j of jobs) for (const [email, f] of j.fams) {
    const e = await send(j.team.subject, render(j.team, greetFor(f)), [email]);
    if (e) { failed++; console.log(j.team.T, email, "FAILED", e); } else sent++;
  }
  console.log(`sent ${sent}${failed ? `, ${failed} failed` : ""}`);
} else if (!htmlOut) for (const j of jobs) console.log(`${j.team.T.padEnd(12)} ${String(j.fams.size).padStart(3)} addresses · ${j.team.weekly.join(" | ")} · off: ${j.team.offLines.length} · tourney Sundays: ${j.team.tourneySundays.length} · S&A: ${j.team.saDates.length}`);
