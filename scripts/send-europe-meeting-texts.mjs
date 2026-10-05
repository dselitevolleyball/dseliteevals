// Europe trip (Croatia Girls Global Challenge) interest meeting texts,
// Sun 11 Oct 2026 3:30pm, DSSC Warehouse + Zoom. Each family gets its own
// RSVP / add-to-calendar link (/meet?t=players.global_token).
//   interested — said Yes or Maybe on the interest form
//   noanswer   — haven't filled the form in yet
// Families who said No are left out. Parents (both) and the player's own
// phone; STOP opt-outs skipped. From the DS Elite number. Plain ASCII, each
// text well under 600 characters (carrier limits).
//
// DRY RUN BY DEFAULT (prints every text).
//   node scripts/send-europe-meeting-texts.mjs
//   node scripts/send-europe-meeting-texts.mjs --test +15122029099
//   node scripts/send-europe-meeting-texts.mjs --send

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { GC_TEAMS } from "../shared/global-challenge.js";

const APP = "https://dseliteevals.vercel.app";
const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const testTo = val("test"), doSend = args.includes("--send");
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const e164 = (s) => { const d = String(s || "").replace(/\D/g, ""); return d.length === 10 ? "+1" + d : d.length === 11 && d[0] === "1" ? "+" + d : null; };
const first = (s) => String(s || "").trim().split(/\s+/)[0];
const [{ data: players }, { data: answers }, { data: outs }] = await Promise.all([
  sb.from("players").select("id, first_name, last_name, team_assignment, offer_status, parent_name, parent2_name, parent_phone, parent2_phone, player_phone, global_token").in("team_assignment", GC_TEAMS),
  sb.from("global_challenge_interest").select("player_id, interest"),
  sb.from("sms_optouts").select("phone").eq("brand", "dse"),
]);
const opted = new Set((outs || []).map(o => String(o.phone).replace(/\D/g, "").slice(-10)));
const ans = new Map((answers || []).map(a => [a.player_id, a.interest]));

const WHEN = "this Sunday, Oct 11 at 3:30pm";
const WHERE = "the DSSC Warehouse (15113 Fitzhugh Rd)";
const text = (group, kind, p, parentFirst) => {
  const girl = first(p.first_name), link = `${APP}/meet?t=${p.global_token}`;
  if (group === "interested") return kind === "player"
    ? `Hi ${girl}, it's Coach Drew. Thanks for your interest in the Europe trip (Croatia Global Challenge, July 2027)! We're holding an interest meeting ${WHEN} at ${WHERE}. Hunter and I will be there to answer questions - bring a parent! If you can't make it in person, you can join on Zoom. RSVP and add it to your calendar here: ${link}`
    : `Hi ${parentFirst || "there"}, it's Drew with DS Elite. Thanks for your interest in the Europe trip for ${girl} (Croatia Global Challenge, July 2027)! We're holding an interest meeting ${WHEN} at ${WHERE}. Hunter and I will be there to answer questions - parents and players are both welcome. If you can't make it in person, you can join on Zoom. Please RSVP and add it to your calendar here: ${link}`;
  return kind === "player"
    ? `Hi ${girl}, it's Coach Drew. Want to learn more about the Europe trip (Croatia Global Challenge, July 2027)? We're hosting an interest meeting ${WHEN} - in person at ${WHERE} and on Zoom. Hunter and I will walk through the trip and answer questions - bring a parent! RSVP and add it to your calendar here: ${link}`
    : `Hi ${parentFirst || "there"}, it's Drew with DS Elite. Want to learn more about the Europe trip for ${girl} (Croatia Global Challenge, July 2027)? We're hosting an interest meeting ${WHEN} - in person at ${WHERE} and on Zoom. Hunter and I will walk through the trip and answer questions. RSVP and add it to your calendar here: ${link}`;
};

const jobs = { interested: [], noanswer: [] };
const seen = new Set();
for (const p of players || []) {
  if (/declin|releas|withdr/i.test(p.offer_status || "") || !p.global_token) continue;
  const a = ans.get(p.id);
  const group = a === "yes" || a === "maybe" ? "interested" : a ? null : "noanswer";
  if (!group) continue;
  for (const [ph, nm, kind] of [[p.parent_phone, p.parent_name, "parent"], [p.parent2_phone, p.parent2_name, "parent"], [p.player_phone, `${p.first_name} ${p.last_name}`, "player"]]) {
    const to = e164(ph); if (!to) continue;
    const key = group + to; if (seen.has(key)) continue; seen.add(key);   // siblings share a parent: one text
    if (opted.has(to.slice(-10))) { console.log("skip (opted out):", nm, to); continue; }
    const body = text(group, kind, p, kind === "parent" ? first(nm) : "");
    if (/[^\x00-\x7F]/.test(body) || body.length > 600) throw new Error("text not ASCII/short: " + body);
    jobs[group].push({ to, name: nm || p.first_name + "'s parent", kind, player_id: p.id, team: p.team_assignment, body });
  }
}
console.log(`interested: ${jobs.interested.length} texts · not yet answered: ${jobs.noanswer.length} texts`);

// One personalised text at a time (a group send needs identical wording).
// Anyone who already got a /meet link today is skipped, so re-running is safe.
const { data: already } = await sb.from("sms_messages").select("body, thread_id, sms_threads(phone)").ilike("body", "%/meet?t=%").gte("created_at", new Date(Date.now() - 86400000).toISOString());
const done = new Set((already || []).map(m => m.sms_threads?.phone).filter(Boolean));
const send = async (j) => {
  if (done.has(j.to)) return { skipped: true };
  const r = await fetch(APP + "/api/send-sms", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY },
    body: JSON.stringify({ to: j.to, body: j.body, contact_name: j.name, contact_kind: j.kind, player_id: j.player_id, team_name: j.team, sent_by_label: "Drew Rose" }) });
  const o = await r.json().catch(() => ({})); return r.ok && !o.error ? { sent: 1 } : { error: o.error || r.status };
};
if (testTo) { for (const g of ["interested", "noanswer"]) for (const k of ["parent", "player"]) { const j = jobs[g].find(x => x.kind === k); if (j) console.log(g, k, JSON.stringify(await send({ ...j, to: testTo, name: "Drew (test)" }))); } }
else if (doSend) {
  console.log("already texted today:", done.size);
  for (const g of ["interested", "noanswer"]) {
    let ok = 0, skip = 0; const failed = [];
    for (const j of jobs[g]) { const o = await send(j); if (o.sent) ok++; else if (o.skipped) skip++; else failed.push(j.name + " " + j.to + ": " + o.error); }
    console.log(g + ":", ok, "sent,", skip, "already had it", failed.length ? "| failed: " + failed.join("; ") : "");
  }
} else for (const g of ["interested", "noanswer"]) for (const j of jobs[g]) console.log(`\n[${g} · ${j.kind}] ${j.name} ${j.to}\n${j.body}`);
