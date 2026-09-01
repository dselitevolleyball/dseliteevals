// Find tournaments a coach is due at with no travel booked, and tell Kristen.
//
// Moving a coach between teams silently rewrites her travel. Adding Kelli to
// 15 Ruby put her at five more tournaments that need a hotel and three that
// need flights — and nothing anywhere said so, because the staff change lives
// on practice_teams and the travel lives on coach_travel, and the two have
// never spoken to each other.
//
// A gap is: this coach is on the staff for a team, that team plays a
// tournament that needs an overnight, and there is no coach_travel row for
// her against it.
//
// Per-tournament overrides are honoured. A weekend where the assistant is
// listed as somebody else — or as TBD, which is how we mark "she can't make
// this one" — is not her trip and is not a gap.
//
// DRY RUN BY DEFAULT.
//
// Usage:
//   node scripts/coach-travel-gaps.mjs                        # every coach
//   node scripts/coach-travel-gaps.mjs --coach "Kelli Hardge"
//   node scripts/coach-travel-gaps.mjs --coach "Kelli Hardge" --send
//   node scripts/coach-travel-gaps.mjs --all-tournaments      # not just overnights
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP = "https://dseliteevals.vercel.app";
const TO = "kristen@dselitevolleyball.com";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
// Mirrors isPlaceholderCoach in src/App.jsx. "TBD" in an override means the
// slot is open, not that a person called TBD is travelling.
const PLACEHOLDER = /^(tbd|tba|n\/a|na|none|pending|sub|open|needed|\?+|-+|—)$/i;
const isPlaceholder = (c) => {
  const s = String(c || "").trim();
  return !s || PLACEHOLDER.test(s) || /new coach|floater coach|assistant coach$/i.test(s);
};
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const day = (iso) => {
  try { return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); }
  catch { return iso; }
};
const span = (a, b) => (b && b !== a) ? day(a) + "–" + day(b).replace(/^\w+ /, "") : day(a);
// Anything we'd have to fly to. Texas is a drive; everything else is a booking
// with a deadline, and those are the ones that hurt when they are found late.
const outOfState = (loc) => !!loc && !/,\s*TX\b|texas/i.test(loc);

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
const allTournaments = flag("all-tournaments");

const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const [{ data: teams }, { data: assigns }, { data: tourns }, { data: travel }] = await Promise.all([
  sb.from("practice_teams").select("team_name, head_coach, assistant_coach, third_coach"),
  sb.from("tournament_assignments").select("team_id, tournament_id, head_override, asst_override, sub_coach"),
  sb.from("tournaments").select("id, name, start_date, end_date, location, stay_over, cancelled"),
  sb.from("coach_travel").select("tournament_id, coach_name, flight_purchased, room_id, no_room_needed"),
]);

const tById = new Map((tourns || []).map(t => [t.id, t]));
const teamBy = new Map((teams || []).map(t => [t.team_name, t]));
const booked = new Set((travel || []).map(r => r.tournament_id + "|" + norm(r.coach_name)));

// Who is actually going, per tournament per team, after overrides.
const gaps = [];
for (const a of (assigns || [])) {
  const t = tById.get(a.tournament_id);
  if (!t || t.cancelled) continue;
  if (!allTournaments && !t.stay_over) continue;      // a day trip needs no booking
  const team = teamBy.get(a.team_id);
  if (!team) continue;

  const going = [
    a.head_override || team.head_coach,
    a.asst_override || team.assistant_coach,
    team.third_coach,
    a.sub_coach,
  ].filter(c => !isPlaceholder(c));

  for (const c of [...new Set(going.map(x => String(x).trim()))]) {
    if (onlyCoach && norm(c) !== norm(onlyCoach)) continue;
    if (booked.has(a.tournament_id + "|" + norm(c))) continue;
    gaps.push({
      coach: c, team: a.team_id, t,
      far: outOfState(t.location),
    });
  }
}
gaps.sort((x, y) => String(x.coach).localeCompare(String(y.coach))
  || String(x.t.start_date).localeCompare(String(y.t.start_date)));

const byCoach = new Map();
for (const g of gaps) {
  if (!byCoach.has(g.coach)) byCoach.set(g.coach, []);
  byCoach.get(g.coach).push(g);
}

console.log(`${gaps.length} unbooked trip${gaps.length === 1 ? "" : "s"} across ${byCoach.size} coach${byCoach.size === 1 ? "" : "es"}` +
  (onlyCoach ? ` (filtered to ${onlyCoach})` : "") +
  (allTournaments ? " (every tournament)" : " (overnights only)"));
for (const [coach, list] of [...byCoach.entries()].sort()) {
  const far = list.filter(g => g.far).length;
  console.log(`\n  ${coach} — ${list.length} unbooked${far ? `, ${far} out of state` : ""}`);
  list.forEach(g => console.log(`     ${span(g.t.start_date, g.t.end_date).padEnd(14)}${g.team.padEnd(12)}` +
    `${String(g.t.name).trim().slice(0, 38).padEnd(40)}${g.t.location || ""}${g.far ? "   ✈" : ""}`));
}

if (!doSend) { console.log("\nDRY RUN — nothing sent. Add --send to email Kristen."); }
else if (!gaps.length) { console.log("\nNothing to send."); }
else {
  const rows = (list) => list.map(g =>
    `<tr><td style="padding:7px 10px;border-bottom:1px solid #eee;white-space:nowrap;font-weight:600">${esc(span(g.t.start_date, g.t.end_date))}</td>` +
    `<td style="padding:7px 10px;border-bottom:1px solid #eee;white-space:nowrap">${esc(g.team)}</td>` +
    `<td style="padding:7px 10px;border-bottom:1px solid #eee">${esc(String(g.t.name).trim())}</td>` +
    `<td style="padding:7px 10px;border-bottom:1px solid #eee;white-space:nowrap">${esc(g.t.location || "")}` +
    `${g.far ? ' <b style="color:#b62d2d">flights</b>' : ""}</td></tr>`).join("");

  const sections = [...byCoach.entries()].sort().map(([coach, list]) => {
    const far = list.filter(g => g.far).length;
    return `<p style="margin:26px 0 8px;font-weight:700;font-size:15px">${esc(coach)} — ${list.length} unbooked` +
      `${far ? `, <span style="color:#b62d2d">${far} needing flights</span>` : ""}</p>` +
      `<table style="border-collapse:collapse;width:100%;font-size:14px"><tbody>${rows(list)}</tbody></table>`;
  }).join("");

  const text = [...byCoach.entries()].sort().map(([coach, list]) =>
    coach + " — " + list.length + " unbooked:\n" +
    list.map(g => "  " + span(g.t.start_date, g.t.end_date) + "  " + g.team + "  " +
      String(g.t.name).trim() + " — " + (g.t.location || "") + (g.far ? "  (FLIGHTS)" : "")).join("\n")
  ).join("\n\n");

  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:640px">'
    + '<p style="margin:0 0 14px">Kristen,</p>'
    + `<p style="margin:0 0 14px">Coaching has changed, and these tournaments now need travel booked that didn&rsquo;t before. Each line is a coach who is due at a tournament that needs an overnight, with no travel record against it.</p>`
    + sections
    + `<p style="margin:22px 0 8px"><a href="${APP}/?view=travel" style="display:inline-block;background:#e91e8c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">Open the travel board &rarr;</a></p>`
    + '<p style="margin:0 0 14px;font-size:13px;color:#666">Weekends where the assistant is listed as somebody else, or as TBD, are left out — those are not her trips.</p>'
    + '<p style="margin:0">Drew</p></div>';

  const r = await fetch(APP + "/api/send-email", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: onlyCoach
        ? `Travel to book: ${onlyCoach} — ${gaps.length} tournament${gaps.length === 1 ? "" : "s"}`
        : `Travel to book — ${gaps.length} unbooked trips`,
      body: "Kristen,\n\nCoaching has changed and these tournaments now need travel booked that didn't before.\n\n" + text +
        "\n\nWeekends where the assistant is listed as somebody else, or as TBD, are left out — those aren't her trips.\n\nDrew",
      bodyHtml: html, recipients: [TO],
      sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script",
    }),
  });
  const out = await r.json().catch(() => ({}));
  console.log(out.error ? ("\nFAILED: " + out.error) : ("\nSent to " + TO));
}
