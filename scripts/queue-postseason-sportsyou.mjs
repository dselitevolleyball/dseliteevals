// Queue the Oct 2026 post-season plan posts (AAU wave announcement + USAV bid
// fallback) for 12-15 Diamond into sportsyou_outbox. Nothing posts until Drew
// clicks the "Post to SportsYou" bookmarklet on sportsyou.com.
// Run: node scripts/queue-postseason-sportsyou.mjs   (skips teams already queued)
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const env = Object.fromEntries(fs.readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
  .map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/)).filter(Boolean).map(m => [m[1], m[2]]));
const sb = createClient(env.SUPABASE_URL || env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const BATCH = "postseason-2026-10-07";
const TRAVEL_AAU = "TRAVEL: AAU is not stay-to-play, but teams typically secure a hotel block, which gives us much more flexibility on cancellations. For flights, please choose tickets you can change, in case we switch events.";
const CLOSE = "Both events are on our team calendar here in SportsYou, marked tentative. Questions? Reach out anytime.";
const AAU_INTRO = "AAU has released its 2027 Junior Nationals wave schedule (Orlando, FL - Orange County Convention Center). Here is our plan for the post-season:";
const when = (dates, age) => `WHEN WILL WE KNOW? Bids are earned at national qualifier tournaments during the season, and at the latest at Lone Star Regionals (${dates} for ${age}), so we may not know until then.`;

const posts = {
  "15 Diamond": [
    "AAU Wave Announcement + Post-Season Plan - 15 Diamond", AAU_INTRO,
    "PLAN: We will register for AAU Nationals Wave 3 - June 21-24 in Orlando.",
    "IF WE EARN A BID: We will drop AAU and go back to Las Vegas for USAV Girls Junior Nationals - June 27-30.",
    when("May 15-16", "15s"), TRAVEL_AAU, CLOSE],
  "14 Diamond": [
    "AAU Wave Announcement + Post-Season Plan - 14 Diamond", AAU_INTRO,
    "PLAN: We will register for AAU Nationals Wave 2 - June 17-20 in Orlando.",
    "IF WE EARN A BID: We will drop AAU and go to USAV Girls Junior Nationals in Las Vegas - June 27-30.",
    when("May 8-9", "14s"), TRAVEL_AAU, CLOSE],
  "13 Diamond": [
    "AAU Wave Announcement + Post-Season Plan - 13 Diamond", AAU_INTRO,
    "PLAN: We will register for AAU Nationals Wave 1 - June 13-16 in Orlando.",
    "IF WE EARN A BID: We will drop AAU and go to USAV Girls Junior Nationals in Chicago - June 18-21.",
    when("May 8-9", "13s"), TRAVEL_AAU, CLOSE],
  "12 Diamond": [
    "Post-Season Plan - 12 Diamond", "Here is our plan for the post-season:",
    "PLAN: We will register for the USAV Girls Club Championships - June 5-7 in Anaheim, CA.",
    "IF WE EARN A BID: We will drop the Club Championships and go to USAV Girls Junior Nationals in Chicago - June 18-21.",
    when("May 8-9", "12s"),
    "TRAVEL: For flights, please choose tickets you can change, in case we switch events. We will share hotel details as soon as they are set.",
    CLOSE],
};

const { data: existing } = await sb.from("sportsyou_outbox").select("team_name").eq("batch_id", BATCH).neq("status", "cancelled");
const have = new Set((existing || []).map(r => r.team_name));
const rows = Object.entries(posts).filter(([t]) => !have.has(t)).map(([team_name, parts]) => ({
  team_name, subject: parts[0], message: parts.join("\n\n"), queued_by: "Drew Rose", batch_id: BATCH,
}));
if (!rows.length) { console.log("Already queued."); process.exit(0); }
const { data, error } = await sb.from("sportsyou_outbox").insert(rows).select("id, team_name, status");
if (error) { console.error(error.message); process.exit(1); }
console.table(data);
