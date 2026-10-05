// Late 13 Rise invites, 5 Oct 2026: Adriana Mandola and Harper Conley.
// The 19 Sep 13 Rise invite (scripts/send-team-invites.mjs, $2,500) brought
// up to date with what the team has been told since — Rise orientation is
// this Sunday, Oct 11 (scripts/send-rise-orientation.mjs). Schedule, coaches,
// roster and tournaments are read from the DB.
//
// DRY RUN BY DEFAULT (prints the emails).
//   node scripts/send-rise13-late-invite.mjs
//   node scripts/send-rise13-late-invite.mjs --html out.html     # first email as HTML
//   node scripts/send-rise13-late-invite.mjs --test drew@dselitevolleyball.com
//   node scripts/send-rise13-late-invite.mjs --send

import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const TEAM = "13 Rise 1", T = "13 Rise";
const PLAYER_IDS = [442, 443];   // Adriana Mandola, Harper Conley
const DEADLINE = "Friday, October 9, at 6:00pm";
const WAREHOUSE = "DSSC Warehouse, 15113 Fitzhugh Rd, Suite 1400, Dripping Springs";
const REG_RISE = "https://dselitevolleyball.sportngin.com/register/form/029858282";
const RISE_CAMP = "https://drippingsports.playbookapi.com/programs/more_info/class_package/77559/";
const LONESTAR = "https://memberships.sportsengine.com/org/lone-star-region-volleyball/affiliation/ds-elite-volleyball-ds-elite";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const testTo = val("test"), doSend = args.includes("--send"), htmlOut = val("html");
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const [{ data: team }, { data: coaches }, { data: pas }, { data: roster }, { data: invitees }] = await Promise.all([
  sb.from("practice_teams").select("*").eq("team_name", TEAM).single(),
  sb.from("coach_roster").select("first_name, last_name, email, phone"),
  sb.from("practice_assignments").select("day, slot, phase").eq("team_name", TEAM).eq("phase", "season"),
  sb.from("players").select("first_name, last_name, offer_status").eq("team_assignment", TEAM),
  sb.from("players").select("id, first_name, last_name, parent_name, parent2_name, parent_email, parent_email2, gear_form_token").in("id", PLAYER_IDS),
]);

const hr = (n) => (Number(n) === 12 ? 12 : Number(n) + 12);
const parse = (s) => { const m = /^(\d{1,2})\s*-\s*(\d{1,2})/.exec(String(s || "")); return m ? { a: hr(m[1]), b: hr(m[2]) } : null; };
const clock = (h) => (h > 12 ? h - 12 : h);
const span = (a, b) => clock(a) + "-" + clock(b) + "pm";
const phone = (s) => { const x = String(s || "").replace(/\D/g, "").slice(-10); return x.length === 10 ? `(${x.slice(0, 3)}) ${x.slice(3, 6)}-${x.slice(6)}` : ""; };
const nm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const listOf = (xs) => xs.length === 1 ? xs[0] : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
const coachLines = [["Head coach", team.head_coach], ["Assistant coach", team.assistant_coach], ["Coach", team.third_coach]].filter(([, n]) => n).map(([role, n]) => {
  const r = coaches.find(x => nm(x.first_name + x.last_name) === nm(n));
  return `${n} - ${role}${r?.phone ? " · " + phone(r.phone) : ""}${r?.email ? " · " + r.email.toLowerCase() : ""}`;
});
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
const sched = DAYS.flatMap(dy => pas.filter(p => p.day === dy).map(p => parse(p.slot)).filter(Boolean).map(x => dy + " " + span(x.a, x.b)));
const teammates = roster.filter(p => ["accepted", "locked"].includes(p.offer_status)).map(p => `${p.first_name} ${p.last_name}`).sort((a, b) => a.localeCompare(b));

const build = (p) => {
  const girl = p.first_name.trim();
  const parents = [...new Set([p.parent_name, p.parent2_name].map(x => String(x || "").trim().split(/\s+/)[0]).filter(Boolean))];
  const greet = parents.length ? "Hi " + listOf(parents) + "," : "Hi,";
  const subject = `${girl} is invited to join DS Elite ${T}!`;
  const intro = [
    `Congratulations! We'd love for ${girl} to join ${T} for the 2026-27 DS Elite season. We think she'll be a great fit for this group, and there's a spot for her now.`,
    `Please register by ${DEADLINE} to accept her spot, so she can join the team at Rise orientation this Sunday. If we don't hear from you by then, we'll offer the place to another player.`,
  ];
  const blocks = [
    ["Accepting her spot", [
      `Season fee: $2,500. A $600 deposit holds her spot, then two payments: October 1 and January 1. (Since October 1 has passed, that payment is due when you register.)`,
      `It covers practices, coaching, tournament entry fees, court fees and her uniform (shoes not included).`,
      `Register here: ${REG_RISE}`,
    ]],
    ["Rise orientation - this Sunday, October 11 (mandatory)", [
      `At the ${WAREHOUSE}.`,
      `11:30am - jersey and uniform try-ons`,
      `12:00pm - orientation, the DS Elite commitment, and team time. We'll be done by 1:00pm.`,
      `${girl} is required, with a parent for the first part: the commitment is signed by the player and a parent, and it's where we walk families through the season.`,
      `Bring knee pads and a water bottle, and a pink DS Elite shirt if she has one.`,
    ]],
    [`Your ${T} coaches`, coachLines],
    ["Practice", [
      `Practice starts the weekend after Thanksgiving: ${sched.join(" · ")}`,
      `Until then, every Rise player is welcome at Rise Fall Camp on Saturdays at the Warehouse - the best way for ${girl} to get going and meet her teammates. Sign up: ${RISE_CAMP}`,
    ]],
    [`Her ${T} teammates`, teammates],
    ["Tournaments", [`About six tournaments across the season - four one-day and two two-day events - finishing at Lone Star Regionals. We'll confirm the full schedule shortly.`]],
    ["Once you've registered", [
      `Lone Star + USAV membership ($55) is required before she can be rostered or play a tournament: ${LONESTAR}`,
      ...(p.gear_form_token ? [`Her player details and uniform sizes: ${APP}/gear?t=${p.gear_form_token}`] : []),
      `Our club shoe is the Avoli Mid Supersonic Pink, out in November - please wait for our word before buying. Any white volleyball shoe works until then.`,
      `Club logos for spirit wear: ${APP}/logos`,
    ]],
  ];
  const outro = `We're excited to have ${girl} with us. Any questions at all, just reply to this email.`;
  const link = (s) => esc(s).replace(/(https?:\/\/\S+)/g, '<a href="$1" style="color:#c2186f">$1</a>');
  const text = `${greet}\n\n${intro.join("\n\n")}\n\n` + blocks.map(([h, items]) => `${h.toUpperCase()}\n${items.map(i => "  • " + i).join("\n")}`).join("\n\n") + `\n\n${outro}\n\nSee you on the court,\n\nDrew Rose\nDirector, DS Elite`;
  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:620px">'
    + `<p style="margin:0 0 14px">${esc(greet)}</p>` + intro.map(x => `<p style="margin:0 0 14px">${esc(x)}</p>`).join("")
    + blocks.map(([h, items]) => `<p style="margin:24px 0 6px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">${esc(h)}</p><ul style="margin:0 0 10px;padding-left:20px">${items.map(i => `<li style="margin-bottom:5px">${link(i)}</li>`).join("")}</ul>`).join("")
    + `<p style="margin:20px 0 0">${esc(outro)}</p><p style="margin:14px 0 0">See you on the court,</p><p style="margin:10px 0 0">Drew Rose<br>Director, DS Elite</p></div>`;
  return { subject, text, html };
};

const jobs = invitees.map(p => ({ p, to: [...new Set([p.parent_email, p.parent_email2].map(e => String(e || "").trim().toLowerCase()).filter(Boolean))], ...build(p) }));
const send = async (j, recipients) => {
  const r = await fetch(APP + "/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: j.subject, body: j.text, bodyHtml: j.html, recipients, replyTo: SENDER.email }) });
  const o = await r.json().catch(() => ({})); return r.ok && o.ok ? null : (o.error || r.status);
};
if (htmlOut) writeFileSync(htmlOut, jobs[0].html);
if (testTo) { for (const j of jobs) console.log(j.p.first_name, (await send({ ...j, subject: "[TEST] " + j.subject }, [testTo])) || "test sent"); }
else if (doSend) { for (const j of jobs) console.log(j.p.first_name, "→", j.to.join(", "), (await send(j, j.to)) || "sent"); }
else for (const j of jobs) console.log("\n" + "═".repeat(72) + `\n${j.p.first_name} ${j.p.last_name} → ${j.to.join(", ")}\nSUBJECT: ${j.subject}\n` + "─".repeat(72) + "\n" + j.text);
