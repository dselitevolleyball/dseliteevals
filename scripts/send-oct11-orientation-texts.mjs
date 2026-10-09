// Texts for Sunday Oct 11, 2026 (Drew, Oct 9): Rise orientation + jersey try-ons.
//   rise     - families on 11/12/13 Rise: orientation is mandatory (try-ons 11:30, meeting 12:00)
//   late     - players on other teams who joined after their age group's orientation
//              night: come to the 12:00 meeting (and try-ons from 11:30)
//   fitting  - other players with no jersey try-on/sizes yet: come any time 11:30-3:00
//   coaches  - the Rise teams' coaches
// One text per phone, greeting only that person ({first}), ASCII, under 600 chars.
// Skips STOP opt-outs and event teams (14 Crystal).
//
//   node scripts/send-oct11-orientation-texts.mjs            # dry run
//   node scripts/send-oct11-orientation-texts.mjs --send

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { isEventTeam } from "../shared/event-teams.js";

const APP = "https://dseliteevals.vercel.app";
const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const doSend = process.argv.includes("--send");
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const RISE = ["11 Rise 1", "12 Rise 1", "13 Rise 1"];
const TERMINAL = ["declined", "not_invited", "opted_out"];
const WHERE = "the DSSC Warehouse (15113 Fitzhugh Rd, Suite 1400, Dripping Springs)";
const SIGN = " - Drew, DS Elite";
const MONDAY = "Can't make Sunday? The last jersey try-on is Monday, Oct 12, 6-8pm at the Warehouse.";

const [{ data: players }, { data: gear }, { data: nights }, { data: teams }, { data: roster }, { data: outs }] = await Promise.all([
  sb.from("players").select("id, first_name, last_name, team_assignment, offer_status, parent_name, parent2_name, parent_phone, parent2_phone, created_at, offer_decision_at").eq("season", "2026-27").neq("team_assignment", ""),
  sb.from("player_gear_orders").select("player_id, details_confirmed, needs_fitting"),
  sb.from("orientation_nights").select("night_date, ages, teams, cancelled"),
  sb.from("practice_teams").select("team_name, head_coach, assistant_coach, third_coach, practices_per_week"),
  sb.from("coach_roster").select("first_name, last_name, phone"),
  sb.from("sms_optouts").select("phone"),
]);
const ascii = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E\n]/g, "");
const last10 = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const e164 = (p) => { const d = last10(p); return d.length === 10 ? "+1" + d : null; };
const optedOut = new Set((outs || []).map(o => last10(o.phone)));
const teamBy = new Map(teams.map(t => [t.team_name, t]));
const gearBy = new Map(gear.map(g => [g.player_id, g]));
const needsFitting = (p) => { const g = gearBy.get(p.id); return !g || !g.details_confirmed || g.needs_fitting; };
const ageOf = (team) => parseInt(team) || null;
const nightFor = (team) => nights.filter(n => !n.cancelled && (n.ages || []).includes(String(ageOf(team)))).map(n => n.night_date).sort()[0] || null;
const joined = (p) => [p.created_at, p.offer_decision_at].filter(Boolean).map(x => String(x).slice(0, 10)).sort().pop();
const live = players.filter(p => !TERMINAL.includes(p.offer_status || "") && !isEventTeam(teamBy.get(p.team_assignment)));
const short = (t) => t.replace(/ 1$/, "");
const listOf = (xs) => xs.length <= 1 ? (xs[0] || "") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];

// Kind per player.
const kindOf = (p) => {
  if (RISE.includes(p.team_assignment)) return "rise";
  const night = nightFor(p.team_assignment);
  if (night && joined(p) > night && ["made", "accepted", "locked"].includes(p.offer_status)) return "late";
  if (needsFitting(p) && ["made", "accepted", "locked"].includes(p.offer_status) && p.id !== 266) return "fitting";
  return null;
};
// Group by phone: one text per parent phone, naming every girl of theirs in that group.
const byPhone = new Map();
for (const p of live) {
  const kind = kindOf(p); if (!kind) continue;
  for (const [ph, nm] of [[p.parent_phone, p.parent_name], [p.parent2_phone, p.parent2_name]]) {
    const to = e164(ph); if (!to || optedOut.has(last10(to))) continue;
    const k = to + "|" + kind;
    if (!byPhone.has(k)) byPhone.set(k, { to, name: String(nm || "").trim(), kind, kids: [] });
    const e = byPhone.get(k); if (!e.kids.some(x => x.id === p.id)) e.kids.push(p);
  }
}
const body = (e) => {
  const girls = listOf(e.kids.map(k => k.first_name.trim()));
  const teamsTxt = listOf([...new Set(e.kids.map(k => short(k.team_assignment)))]);
  if (e.kind === "rise") return `Hi {first}, reminder from DS Elite: ${teamsTxt} orientation is this Sunday, Oct 11 at ${WHERE}. Jersey try-ons at 11:30am, then orientation and the team commitment at 12:00pm, done by 1:00. It's mandatory for ${girls}, with a parent for the first part. Bring knee pads and water. If you truly can't make it, the last jersey try-on is Monday, Oct 12, 6-8pm at the Warehouse.` + SIGN;
  if (e.kind === "late") return `Hi {first}, since ${girls} joined ${teamsTxt} after the team's orientation night, please come to our orientation this Sunday, Oct 11 at 12:00pm at ${WHERE}. Jersey try-ons start at 11:30am if she still needs one. A parent should come too. ${MONDAY}` + SIGN;
  return `Hi {first}, ${girls} still needs ${e.kids.length > 1 ? "their" : "her"} DS Elite jersey try-on. Come any time this Sunday, Oct 11 between 11:30am and 3:00pm at ${WHERE}. It only takes a few minutes, and we can't order ${e.kids.length > 1 ? "their uniforms" : "her uniform"} without it. ${MONDAY}` + SIGN;
};
const jobs = [...byPhone.values()].map(e => ({ ...e, text: ascii(body(e)) }));

// Rise coaches.
const nm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
for (const t of RISE) {
  const pt = teamBy.get(t) || {};
  for (const c of [pt.head_coach, pt.assistant_coach, pt.third_coach].filter(Boolean)) {
    const r = roster.find(x => nm(x.first_name + x.last_name) === nm(c));
    const to = e164(r?.phone); if (!to || optedOut.has(last10(to))) { console.log("  (no phone for coach " + c + ")"); continue; }
    const have = jobs.find(j => j.to === to && j.kind === "coach");
    if (have) { have.teams.push(short(t)); continue; }
    jobs.push({ to, name: c, kind: "coach", teams: [short(t)], kids: [] });
  }
}
for (const j of jobs.filter(j => j.kind === "coach")) j.text = ascii(`Hi {first}, Rise orientation is this Sunday, Oct 11 at ${WHERE}. Jersey try-ons at 11:30am, orientation and the team commitment at 12:00pm, done by 1:00. Please be there for ${listOf(j.teams)}. Other players will be in for jersey try-ons until 3:00, and the last try-on is Monday, Oct 12, 6-8pm.` + SIGN);

for (const j of jobs) if (j.text.length > 600 || /[^\x20-\x7E\n]/.test(j.text)) throw new Error("bad text for " + j.to);
const count = (k) => jobs.filter(j => j.kind === k);
console.log(`Texts: ${jobs.length}  (rise ${count("rise").length}, late joiners ${count("late").length}, try-on only ${count("fitting").length}, coaches ${count("coach").length})`);
for (const k of ["rise", "late", "fitting", "coach"]) {
  const g = count(k); if (!g.length) continue;
  console.log(`\n== ${k} == e.g. to ${g[0].name || g[0].to}:\n${g[0].text.replace("{first}", (g[0].name.split(/\s+/)[0] || "there"))}`);
  if (k !== "rise") console.log("  players: " + [...new Set(g.flatMap(j => j.kids.map(p => `${p.first_name} ${p.last_name} (${short(p.team_assignment)})`)))].join(", ") + (k === "coach" ? g.map(j => j.name).join(", ") : ""));
}
if (!doSend) { console.log("\nDRY RUN. Add --send."); process.exit(0); }

let ok = 0; const failed = [];
for (const j of jobs) {
  const r = await fetch(APP + "/api/send-sms", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY },
    body: JSON.stringify({ to: j.to, body: j.text, contact_name: j.name || null, contact_kind: j.kind === "coach" ? "coach" : "parent", player_id: j.kids[0]?.id || null, team_name: j.kids[0]?.team_assignment || null, sent_by_label: "Drew Rose" }) });
  const o = await r.json().catch(() => ({}));
  if (r.ok && !o.error) ok++; else failed.push(j.to + " " + (o.error || r.status));
}
console.log(`\nSent ${ok} of ${jobs.length}.` + (failed.length ? "\nFailed: " + failed.join("; ") : ""));
