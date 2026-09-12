// SportsYou: the Fall 1 speed and agility block with Reach Performance.
//
// Five consecutive Sundays — 13, 20, 27 September and 4, 11 October — during
// which eight teams have a one-hour Reach session butted against their normal
// Sunday practice. Every time is already correct in SportsYou; what families
// don't know is that their Sunday just got an hour longer, and only for five
// weeks.
//
// Each team's own hour, and whether it lands before or after their practice,
// is read from sa_sessions and practice_assignments rather than typed here, so
// a slot moved in the app is the slot in the message. A team with no Fall 1
// Reach session is not posted to at all — Drew asked for the impacted teams
// only, and a "your schedule is changing" post to a team whose schedule isn't
// is how people stop reading them.
//
// Queues into sportsyou_outbox. Nothing reaches SportsYou until Drew runs the
// bookmarklet in a logged-in tab.
//
// DRY RUN BY DEFAULT.
//
// Usage:
//   node scripts/post-reach-fall1.mjs           # show every post
//   node scripts/post-reach-fall1.mjs --queue
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BLOCK = "fall1";
const QUEUED_BY = "Drew Rose";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const doQueue = process.argv.includes("--queue");
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const [{ data: sa }, { data: pa }] = await Promise.all([
  sb.from("sa_sessions").select("team_name, slot, session_date").eq("block", BLOCK).order("session_date"),
  sb.from("practice_assignments").select("team_name, slot, day, phase").eq("phase", BLOCK).eq("day", "Sun"),
]);
if (!sa?.length) { console.error("No " + BLOCK + " speed & agility sessions found."); process.exit(1); }

// 1-2pm → { start: 13, end: 14 }. Afternoon/evening throughout, so 12 is noon
// and everything else is pm.
const parse = (slot) => {
  const m = /^(\d{1,2})\s*-\s*(\d{1,2})/.exec(String(slot || ""));
  if (!m) return null;
  const h = (n) => (Number(n) === 12 ? 12 : Number(n) + 12);
  return { start: h(m[1]), end: h(m[2]) };
};
const label = (h) => { const x = h > 12 ? h - 12 : h; return x + (h >= 12 ? "pm" : "am"); };
const fmtDate = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

const dates = [...new Set(sa.map(s => s.session_date))].sort();
const dateList = dates.map(fmtDate);
const datesSentence = dateList.slice(0, -1).join(", ") + " and " + dateList[dateList.length - 1];
const lastDate = fmtDate(dates[dates.length - 1]);

const teams = [...new Set(sa.map(s => s.team_name))].sort();
const posts = [];
for (const team of teams) {
  const saSlot = sa.find(s => s.team_name === team)?.slot;
  const practices = (pa || []).filter(p => p.team_name === team).map(p => p.slot);
  const s = parse(saSlot);
  // The practice block this hour actually touches: the one that ends when Reach
  // starts, or starts when it ends. A team with several Sunday slots would
  // otherwise be described against the wrong one.
  const adjacent = practices.map(parse).filter(Boolean)
    .find(p => p.end === s.start || p.start === s.end);
  const before = adjacent ? s.end === adjacent.start : null;
  const window = adjacent
    ? label(Math.min(s.start, adjacent.start)) + " to " + label(Math.max(s.end, adjacent.end))
    : null;

  const where = adjacent
    ? `Your Reach hour is ${saSlot}, ${before ? "straight before" : "straight after"} your ${practices.join(" and ")} practice. For these five Sundays your time at DSSC is ${window}.`
    : `Your Reach hour is ${saSlot}.`;

  const message = `${team} families — heads up, your Sundays change for the next five weeks.

Speed and agility training with Reach Performance starts tomorrow and runs five Sundays in a row: ${datesSentence}.

${where}

The times are already loaded in SportsYou, so your team calendar is correct — just look before you leave. After ${lastDate} it stops and Sundays go back to practice only.`;

  posts.push({ team_name: team, subject: "Speed & agility with Reach Performance — 5 Sundays, starts tomorrow", message });
}

console.log(`${posts.length} teams impacted in ${BLOCK}: ${teams.join(", ")}`);
console.log(`Dates: ${datesSentence}\n`);
for (const p of posts) {
  console.log("─".repeat(70) + "\n" + p.team_name + " · " + p.subject + "\n" + "─".repeat(70));
  console.log(p.message + "\n");
}

if (!doQueue) {
  console.log("DRY RUN — nothing queued. Re-run with --queue.");
} else {
  const { error } = await sb.from("sportsyou_outbox").insert(posts.map(p => ({
    ...p, status: "pending", queued_by: QUEUED_BY, queued_at: new Date().toISOString(),
  })));
  if (error) { console.error("Queue failed: " + error.message); process.exit(1); }
  const { count } = await sb.from("sportsyou_outbox").select("id", { count: "exact", head: true }).eq("status", "pending");
  console.log(`Queued ${posts.length}. ${count} posts now pending — run the SportsYou bookmarklet to send them.`);
}
