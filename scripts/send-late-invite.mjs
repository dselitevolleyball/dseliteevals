// A late invite: one new family joining a team mid-preseason, caught up on
// everything the team has been sent so far — rewritten as it stands today, not
// forwarded. Old dates (the June deposit deadline, the Sep lock-in, the Aug 30
// fittings) are gone; what's still live is here, with this player's own links.
//
// Built for Mollie Reed joining 15 Sapphire on 15 Sep. Schedule, S&A,
// tournaments and coaches are read from the DB so the email says what the
// SportsYou calendar says. The fee, deposit and registration link are the
// team's July invite terms — confirm before sending if they've changed.
//
// DRY RUN BY DEFAULT.
//   node scripts/send-late-invite.mjs --player 420
//   node scripts/send-late-invite.mjs --player 420 --test drew@dselitevolleyball.com
//   node scripts/send-late-invite.mjs --player 420 --send
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Per-team terms from the July invites. Only 15 Sapphire is filled in.
const TERMS = {
  "15 Sapphire": {
    level: "Regional", fee: "$4,200", deposit: "$600",
    register: "https://dselitevolleyball.sportngin.com/register/form/499416961",
    sportsyou: "7NPR-Z9SC",
    teamParents: [
      ["Ann Paclik", "Penny", "annwhitepaclik@yahoo.com"],
      ["Jonson Sandberg", "Anna", "jonson_sandberg@hotmail.com"],
      ["Kelli Murdock", "Olivia", "kellimurdock85@gmail.com"],
      ["Megan Houser", "Harper", "memhouser@gmail.com"],
    ],
  },
};

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const args = process.argv.slice(2);
const value = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const playerId = Number(value("player")), testTo = value("test"), doSend = args.includes("--send");
if (!playerId) { console.error("--player <id>"); process.exit(1); }

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: p, error } = await sb.from("players")
  .select("id, first_name, last_name, team_assignment, parent_name, parent2_name, parent_email, parent_email2, parent_email3, commitment_token, photo_upload_token, gear_form_token, school_form_token")
  .eq("id", playerId).single();
if (error) { console.error(error.message); process.exit(1); }
const team = p.team_assignment;
const terms = TERMS[team];
if (!terms) { console.error("No invite terms for " + team + " — add them to TERMS."); process.exit(1); }

const [{ data: pt }, { data: roster }, { data: pa }, { data: sa }, { data: ta }, { data: ev }] = await Promise.all([
  sb.from("practice_teams").select("head_coach, assistant_coach, third_coach").eq("team_name", team).single(),
  sb.from("coach_roster").select("first_name, last_name, email, phone"),
  sb.from("practice_assignments").select("phase, day, slot").eq("team_name", team),
  sb.from("sa_sessions").select("block, session_date, slot").eq("team_name", team).order("session_date"),
  sb.from("tournament_assignments").select("tournament_id").eq("team_id", team),
  sb.from("team_events").select("title, event_date, start_time").eq("team_name", team).gte("event_date", new Date().toISOString().slice(0, 10)).order("start_time"),
]);
const { data: tns } = await sb.from("tournaments").select("name, start_date, end_date, location, stay_over, cancelled")
  .in("id", (ta || []).map(r => r.tournament_id)).order("start_date");

// ── formatting ─────────────────────────────────────────────────────────────
const hr = (n) => (Number(n) === 12 ? 12 : Number(n) + 12);
const parse = (s) => { const m = /^(\d{1,2})\s*-\s*(\d{1,2})/.exec(String(s || "")); return m ? { a: hr(m[1]), b: hr(m[2]) } : null; };
const clock = (h) => (h > 12 ? h - 12 : h);
const span = (a, b) => clock(a) + "–" + clock(b) + "pm";
const merged = (slots) => {
  const r = slots.map(parse).filter(Boolean).sort((x, y) => x.a - y.a), out = [];
  for (const x of r) { const l = out[out.length - 1]; if (l && l.b === x.a) l.b = x.b; else out.push({ ...x }); }
  return out.map(x => span(x.a, x.b));
};
const d = (iso, o) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", ...o });
const short = (iso) => d(iso, { month: "short", day: "numeric" });
const range = (s, e) => !e || e === s ? d(s, { weekday: "short", month: "short", day: "numeric" })
  : d(s, { month: "short", day: "numeric" }) + "–" + (d(s, { month: "short" }) === d(e, { month: "short" }) ? d(e, { day: "numeric" }) : short(e));
const phone = (s) => { const x = String(s || "").replace(/\D/g, "").slice(-10); return x.length === 10 ? `(${x.slice(0, 3)}) ${x.slice(3, 6)}-${x.slice(6)}` : ""; };
const girl = p.first_name.trim();
const names = [...new Set([p.parent_name, p.parent2_name].map(n => String(n || "").trim().split(/\s+/)[0]).filter(Boolean))];
const greet = names.length ? "Hi " + names.join(" and ") + "," : "Hi,";

const coaches = [["Head coach", pt.head_coach], ["Assistant coach", pt.assistant_coach], ["Coach", pt.third_coach]]
  .filter(([, n]) => n).map(([role, n]) => {
    const r = (roster || []).find(x => `${x.first_name} ${x.last_name}`.trim().toLowerCase() === n.trim().toLowerCase());
    return { role, name: n, email: r?.email || "", phone: phone(r?.phone) };
  });

const byPhase = (ph, day) => merged((pa || []).filter(r => r.phase === ph && r.day === day).map(r => r.slot));
const saIn = (block) => (sa || []).filter(s => s.block === block);
const schedule = [];
{
  const f1 = byPhase("fall1", "Sun"), s1 = saIn("fall1");
  if (f1.length || s1.length) schedule.push(["Fall 1 · Sundays through Oct 11", [...f1.map(x => x + " practice"), ...(s1.length ? [span(parse(s1[0].slot).a, parse(s1[0].slot).b) + " speed & agility"] : [])].join(", ")]);
  const f2 = byPhase("fall2", "Sun"), s2 = saIn("fall2");
  if (f2.length || s2.length) schedule.push(["Fall 2 · Sundays Oct 18 – Nov 15", [...f2.map(x => x + " practice"), ...(s2.length ? [span(parse(s2[0].slot).a, parse(s2[0].slot).b) + " speed & agility with Reach Performance"] : [])].join(", ")]);
  const ss = byPhase("season", "Sun"), sw = byPhase("season", "Wed");
  if (ss.length || sw.length) schedule.push(["Regular season · from late November", [...ss.map(x => "Sun " + x), ...sw.map(x => "Wed " + x)].join(" · ")]);
}
const seasonSA = [...saIn("season1"), ...saIn("season2")].sort((a, b) => a.session_date.localeCompare(b.session_date))
  .map(s => d(s.session_date, { weekday: "short", month: "short", day: "numeric" }) + ", " + span(parse(s.slot).a, parse(s.slot).b));
const inHouse = (ev || []).filter(e => /tournament/i.test(e.title));
const inHouseLine = inHouse.length
  ? `${d(inHouse[0].event_date, { weekday: "long", month: "long", day: "numeric" })} — DS Elite in-house tournament at the Warehouse, ${clock(Number(inHouse[0].start_time.slice(0, 2)))}–${clock(Number(inHouse[inHouse.length - 1].start_time.slice(0, 2)) + 1)}pm (three matches plus one hour working a court).`
  : "";
const tourneys = (tns || []).filter(t => !t.cancelled).map(t => {
  const where = /oklahoma city/i.test(t.name) ? "Oklahoma City, OK" : t.location;
  const name = t.name.replace(/\s+—\s+Oklahoma City$/, "").replace(/\s*--\s*14\/15's$/, "").replace(/\s+#\s+/, " #").trim();
  return `${range(t.start_date, t.end_date)} — ${name} (${where})${t.stay_over ? " · overnight" : ""}`;
});

const L = {
  commit: testTo ? `${APP}/commitment?preview=1` : `${APP}/commitment?t=${p.commitment_token}`,
  photos: testTo ? `${APP}/photos?preview=1` : `${APP}/photos?t=${p.photo_upload_token}`,
  gear: testTo ? `${APP}/gear?preview=1` : `${APP}/gear?t=${p.gear_form_token}`,
  school: `${APP}/school?t=${p.school_form_token}`,
  lonestar: "https://memberships.sportsengine.com/org/lone-star-region-volleyball/affiliation/ds-elite-volleyball-ds-elite",
};

// ── the email: [heading, paragraphs[], optional list, optional link] ───────
const S = [
  [null, [
    `Congratulations — we're excited to invite ${girl} to join ${team} for the 2026-27 DS Elite season!`,
    `The team has been together since July, so this email catches you up on everything the other families have already received. It's long — please read it through and keep it.`,
  ]],
  ["Accepting your spot", [
    `${team} is a ${terms.level} team. The season fee is ${terms.fee}, and it covers practices, coaching, tournament entry fees, court fees, the uniform package (shoes not included) and two blocks of strength and conditioning. There's no deposit — the fee is paid in quarterly payments.`,
    `Please register here to accept ${girl}'s spot:`,
  ], null, [terms.register, "Register and accept"]],
  [`Your ${team} coaches`, [], coaches.map(c => `${c.name} — ${c.role}${c.phone ? " · " + c.phone : ""}${c.email ? " · " + c.email : ""}`)],
  ["1. Join SportsYou — do this first", [
    `All team communication and the team calendar run through SportsYou: practice reminders, schedule changes and announcements. Download the SportsYou app and join ${team} with code ${terms.sportsyou}. Every practice, speed & agility session and tournament is already on the team calendar there, with locations, and it updates itself when anything changes.`,
  ]],
  ["2. Lone Star + USAV membership", [
    `Required for every player — we can't officially roster ${girl} or take her to a tournament without it. It's $55 through SportsEngine:`,
  ], [
    "Click Get Started and select (or create) your player's profile",
    "When \"Invite a Parent/Guardian\" pops up, click Skip for now",
    "Choose Player/Athlete, then \"26-27 LoneStar Junior Player\"",
    "Accept the waivers; check the club shows \"DS Elite Volleyball\"; pay",
    "Confirm SportsEngine shows your player as Eligible for the 26-27 season",
  ], [L.lonestar, "Buy the membership"]],
  ["3. Uniform sizes", [
    `The rest of the team was fitted at the end of August, so we need ${girl}'s sizes as soon as possible to get her uniform ordered. One change the team already knows about: our spandex shorts are now Baden volleyball shorts, which only come in a 3" inseam.`,
    `This form takes her sizes along with her details — contact info, school and school team, and anything medical we should know. If she made a school team this fall, it's where you tell us so we can plan around her school schedule:`,
  ], null, [L.gear, `Fill in ${girl}'s details and sizes`]],
  ["4. Shoes", [
    `Our club shoe this season is the new Avoli Mid Supersonic Pink, a new colorway releasing in November. Don't buy it yet — we'll tell everyone when it's time. Until then any volleyball shoe is fine. If ${girl} is smaller than Avoli's smallest size (5.5), any white volleyball shoe is the rule.`,
  ]],
  ["5. The DS Elite commitment", [
    `The team went through our commitment together at orientation on Sept 12. ${girl} and a parent each sign it, separately and in your own names, on this link. Every point has to be ticked before that side saves, and it works whenever you're ready:`,
  ], null, [L.commit, `Open ${girl}'s commitment`]],
  ["6. Practice schedule", [
    `Practices through November are optional but strongly encouraged — this is where the team is being built. Practices are at the DSSC Warehouse; SportsYou has the exact location for each one.`,
  ], [
    ...schedule.map(([k, v]) => `${k}: ${v}`),
    ...(inHouseLine ? [inHouseLine] : []),
  ]],
  ["Speed & agility · regular season", [
    `During the regular season the team does five speed & agility sessions, each one hour directly before or after practice:`,
  ], seasonSA],
  ["7. Tournament schedule", [
    `We'll send hotel and stay-to-play details closer to each overnight event — please don't book rooms yet. If you're buying flights early, choose refundable or changeable fares.`,
  ], tourneys],
  ["8. Team parents", [
    `These parents volunteered to handle family communication and tournament logistics for ${team}. They're a great first call for "how does this work" questions:`,
  ], terms.teamParents.map(([n, kid, e]) => `${n} (${kid}'s parent) — ${e}`)],
  ["9. Two more quick things", [
    `Scorekeeping: every player needs to be scorekeeping certified. Coach Kristen has posted the details in SportsYou and is the person to ask — kristen@dselitevolleyball.com.`,
    `Team photos: this is ${girl}'s own link for sharing photos of ${team}. Pick the tournament from the dropdown and upload as many as you like. Bookmark it — it's the same link all year.`,
  ], null, [L.photos, `Upload ${team} photos`]],
  [null, [
    `We're really glad to have ${girl} and your family with us. If you have any questions at all, just reply to this email.`,
    `Welcome to ${team}!`,
  ]],
];

let text = greet + "\n\n";
let html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:620px">'
  + `<p style="margin:0 0 14px">${esc(greet)}</p>`;
for (const [head, paras, list, link] of S) {
  if (head) {
    text += head.toUpperCase() + "\n\n";
    html += `<p style="margin:28px 0 10px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">${esc(head)}</p>`;
  }
  for (const para of paras) { text += para + "\n\n"; html += `<p style="margin:0 0 12px">${esc(para)}</p>`; }
  if (list?.length) {
    text += list.map(x => "  • " + x).join("\n") + "\n\n";
    html += `<ul style="margin:0 0 14px;padding-left:20px">${list.map(x => `<li style="margin-bottom:5px">${esc(x)}</li>`).join("")}</ul>`;
  }
  if (link) {
    text += link[0] + "\n\n";
    html += `<p style="margin:4px 0 6px"><a href="${link[0]}" style="display:inline-block;background:#e91e8c;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:700">${esc(link[1])} &rarr;</a></p>`
      + `<p style="margin:0 0 16px;font-size:12px;color:#777;word-break:break-all">${esc(link[0])}</p>`;
  }
}
text += "See you on the court,\n\nDrew Rose\nDirector, DS Elite";
html += '<p style="margin:18px 0 0">See you on the court,</p><p style="margin:12px 0 0">Drew Rose<br>Director, DS Elite</p></div>';

const subject = `Welcome to ${team}, ${girl} — your DS Elite invite and everything to get started`;
const to = [...new Set([p.parent_email, p.parent_email2, p.parent_email3].map(e => String(e || "").trim().toLowerCase()).filter(e => EMAIL_RE.test(e)))];

const send = async (subj, recipients) => {
  const r = await fetch(APP + "/api/send-email", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: subj, body: text, bodyHtml: html, recipients, sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script", skipPush: true }),
  });
  const o = await r.json().catch(() => ({}));
  return r.ok && !o.error ? null : (o.error || String(r.status));
};

console.log(`${p.first_name} ${p.last_name} · ${team} → ${to.join(", ") || "NO EMAIL"}\n${"─".repeat(72)}\nSUBJECT: ${subject}\n${"─".repeat(72)}\n${text}`);
if (testTo) { const e = await send("[TEST] " + subject, [testTo]); console.log(e ? "FAILED: " + e : "\ntest sent to " + testTo + " (preview links for commitment, photos, gear)"); }
else if (doSend) {
  if (!to.length || !p.commitment_token || !p.gear_form_token) { console.error("Missing email or tokens."); process.exit(1); }
  // send-email has no cc; each address gets its own copy, which is what a cc is for here.
  const cc = (value("cc") || "").split(",").map(s => s.trim().toLowerCase()).filter(e => EMAIL_RE.test(e) && !to.includes(e));
  const e = await send(subject, [...to, ...cc]); console.log(e ? "FAILED: " + e : "\nsent to " + to.join(", ") + (cc.length ? " · copy to " + cc.join(", ") : ""));
} else console.log("\nDRY RUN — --test <email> or --send.");
