// Rise orientation + jersey try-ons, Sun 11 Oct 2026.
//
// Two audiences:
//   rise   — every player on 11/12/13 Rise. Mandatory: try-ons at 11:30,
//            orientation and the commitment meeting at 12:00.
//   makeup — players on other teams who never got fitted in August, invited
//            to the 11:30 try-on only.
//
// DRY RUN BY DEFAULT.
//   node scripts/send-rise-orientation.mjs
//   node scripts/send-rise-orientation.mjs --test drew@dselitevolleyball.com
//   node scripts/send-rise-orientation.mjs --send
//   node scripts/send-rise-orientation.mjs --events   # add it to team calendars

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const WHEN = "Sunday, October 11";
const WHERE = "DSSC Warehouse, 15113 Fitzhugh Rd, Suite 1400, Dripping Springs";
const RISE_TEAMS = ["11 Rise 1", "12 Rise 1", "13 Rise 1"];
const TERMINAL = ["declined", "not_invited", "opted_out"];

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const testTo = val("test"), doSend = args.includes("--send"), doEvents = args.includes("--events");
const onlyKind = val("only"); // rise | makeup

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [{ data: players }, { data: gear }] = await Promise.all([
  sb.from("players").select("id, first_name, last_name, team_assignment, offer_status, parent_name, parent2_name, parent_email, parent_email2, parent_email3")
    .eq("season", "2026-27").neq("team_assignment", ""),
  sb.from("player_gear_orders").select("player_id, details_confirmed, needs_fitting"),
]);
const gearBy = new Map((gear || []).map(g => [g.player_id, g]));
const live = players.filter(p => !TERMINAL.includes(p.offer_status || ""));
const needsFitting = (p) => { const g = gearBy.get(p.id); return !g || !g.details_confirmed || g.needs_fitting; };
const listOf = (xs) => xs.length === 1 ? xs[0] : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];

const build = (p, kind) => {
  const girl = p.first_name.trim();
  const team = p.team_assignment.replace(/ 1$/, "");
  const parents = [...new Set([p.parent_name, p.parent2_name].map(x => String(x || "").trim().split(/\s+/)[0]).filter(Boolean))];
  const greet = parents.length ? "Hi " + listOf(parents) + "," : "Hi,";
  let subject, intro, blocks, outro;

  if (kind === "rise") {
    subject = `${team} orientation — ${WHEN}, and it's mandatory`;
    intro = [
      `Put this on your calendar: ${team}'s orientation is ${WHEN} at the ${WHERE}. This one is mandatory for every Rise player.`,
      `It's the night the season really starts — ${girl} gets fitted for her uniform, we go through what the year looks like together, and the team signs the DS Elite commitment.`,
    ];
    blocks = [
      ["The schedule", [
        `11:30am — jersey and uniform try-ons`,
        `12:00pm — orientation, the DS Elite commitment, and team time`,
        `We'll be done by 1:00pm.`,
      ]],
      ["Who needs to be there", [
        `${girl} — required.`,
        `A parent for the first part: the commitment is signed by the player and a parent, and orientation is where we walk families through the season.`,
      ]],
      ["What to bring", [`Knee pads and a water bottle`, `Her pink DS Elite shirt if she has one`]],
    ];
    outro = `If ${girl} genuinely can't make it, reply to this email and tell me now — not the week of — and we'll sort out her uniform sizes another way.`;
  } else {
    subject = `${girl}'s make-up jersey try-on — ${WHEN}, 11:30am`;
    intro = [
      `${girl} still needs to be fitted for her uniform, so we've set aside a make-up try-on: ${WHEN} at 11:30am, at the ${WHERE}.`,
      `It only takes a few minutes. We're running Rise orientation that day, and the try-ons at 11:30 are open to any DS Elite player who missed the August fittings — ${girl} just needs the fitting, not the rest of the day.`,
    ];
    blocks = [["What to know", [
      `11:30am — try-ons start. Come any time between 11:30 and 12:30.`,
      `Nothing to bring; she'll try on sizes and we'll record them.`,
      `Her uniform can't be ordered until we have her sizes, so please don't skip it.`,
    ]]];
    outro = `If that time doesn't work, reply and we'll find another window for her.`;
  }

  const text = `${greet}\n\n${intro.join("\n\n")}\n\n`
    + blocks.map(([h, items]) => `${h.toUpperCase()}\n${items.map(i => "  • " + i).join("\n")}`).join("\n\n")
    + `\n\n${outro}\n\nSee you on the court,\n\nDrew Rose\nDirector, DS Elite`;
  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:620px">'
    + `<p style="margin:0 0 14px">${esc(greet)}</p>`
    + intro.map(x => `<p style="margin:0 0 14px">${esc(x)}</p>`).join("")
    + blocks.map(([h, items]) => `<p style="margin:24px 0 6px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">${esc(h)}</p>`
        + `<ul style="margin:0 0 10px;padding-left:20px">${items.map(i => `<li style="margin-bottom:5px">${esc(i)}</li>`).join("")}</ul>`).join("")
    + `<p style="margin:20px 0 0">${esc(outro)}</p><p style="margin:14px 0 0">See you on the court,</p><p style="margin:10px 0 0">Drew Rose<br>Director, DS Elite</p></div>`;
  return { subject, text, html };
};

const jobs = [];
for (const p of live) {
  // Hadley Spencer (#266) is trialling with 13 Diamond and has no spot yet — no uniform.
  const kind = RISE_TEAMS.includes(p.team_assignment) ? "rise"
    : (needsFitting(p) && p.id !== 266 && ["made", "accepted", "locked"].includes(p.offer_status) ? "makeup" : null);
  if (onlyKind && kind !== onlyKind) continue;
  if (!kind) continue;
  const to = [...new Set([p.parent_email, p.parent_email2, p.parent_email3].map(e => String(e || "").trim().toLowerCase()).filter(e => EMAIL_RE.test(e)))];
  if (!to.length) { console.error(`NO EMAIL: ${p.first_name} ${p.last_name} (${p.team_assignment})`); continue; }
  jobs.push({ p, kind, to, ...build(p, kind) });
}
jobs.sort((a, b) => a.kind.localeCompare(b.kind) || a.p.team_assignment.localeCompare(b.p.team_assignment));

const send = async (m, recipients) => {
  const r = await fetch(APP + "/api/send-email", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: m.subject, body: m.text, bodyHtml: m.html, recipients, replyTo: SENDER.email,
      sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script", skipPush: true }),
  });
  const o = await r.json().catch(() => ({}));
  return r.ok && !o.error ? null : (o.error || String(r.status));
};

// Put it on the three Rise team calendars (SportsYou reads these).
if (doEvents) {
  for (const team of RISE_TEAMS) {
    const row = { team_name: team, title: "Orientation + jersey try-ons (mandatory)", event_date: "2026-10-11",
      start_time: "11:30", duration_min: 90, location: "DSSC Warehouse",
      description: "Jersey and uniform try-ons at 11:30am; orientation, the DS Elite commitment and team time at 12:00pm, finishing at 1:00pm. Mandatory for all Rise players. A parent is needed for the first part." };
    const { data: had } = await sb.from("team_events").select("id").eq("team_name", team).eq("event_date", row.event_date).ilike("title", "Orientation%").maybeSingle();
    const { error } = had ? await sb.from("team_events").update(row).eq("id", had.id) : await sb.from("team_events").insert(row);
    console.log(error ? `ERR ${team}: ${error.message}` : `${had ? "updated" : "added"} calendar event for ${team}`);
  }
}

const byKind = (k) => jobs.filter(j => j.kind === k);
console.log(`${jobs.length} emails — Rise ${byKind("rise").length}, make-up try-ons ${byKind("makeup").length}`);
for (const k of ["rise", "makeup"]) {
  const g = {};
  byKind(k).forEach(j => { (g[j.p.team_assignment] = g[j.p.team_assignment] || []).push(j.p.first_name + " " + j.p.last_name); });
  Object.entries(g).sort().forEach(([t, xs]) => console.log(`  ${k.padEnd(7)} ${t.padEnd(12)} ${xs.length}: ${xs.join(", ")}`));
}

if (testTo) {
  for (const k of ["rise", "makeup"]) {
    const j = byKind(k)[0];
    if (!j) continue;
    const err = await send({ ...j, subject: `[TEST ${k}] ${j.subject}` }, [testTo]);
    console.log(err ? `FAILED ${k}: ${err}` : `test sent: ${k} (${j.p.first_name})`);
  }
} else if (doSend) {
  let ok = 0;
  for (const j of jobs) {
    const err = await send(j, j.to);
    if (err) console.error(`FAILED ${j.p.first_name} ${j.p.last_name}: ${err}`);
    else { ok++; console.log(`sent ${j.kind.padEnd(7)} ${(j.p.first_name + " " + j.p.last_name).padEnd(22)} → ${j.to.join(", ")}`); }
  }
  console.log(`\n${ok}/${jobs.length} sent`);
} else if (!doEvents) {
  for (const k of ["rise", "makeup"]) {
    const j = byKind(k)[0];
    if (j) console.log("\n" + "═".repeat(72) + `\n${k} — ${j.p.first_name} ${j.p.last_name} → ${j.to.join(", ")}\nSUBJECT: ${j.subject}\n` + "─".repeat(72) + "\n" + j.text);
  }
  console.log("\nDRY RUN — --test <email>, --send, or --events.");
}
