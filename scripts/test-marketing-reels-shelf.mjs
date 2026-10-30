// Offline checks for the Reels shelf (DSSC Marketing → Reels): new reels wait
// on the shelf (off the calendar, never posted), go on the calendar on a chosen
// day, come back to the shelf, and can be thrown away - and the calendar and
// the poster never see a shelf reel. Fake database, no Claude, no ffmpeg.
//
//   node scripts/test-marketing-reels-shelf.mjs

import { fakeSupabase } from "./fake-supabase.mjs";
import { SHELF_WEEK, onShelf, weekStartOf } from "../shared/marketing-plan.js";
delete process.env.ANTHROPIC_API_KEY;
const { runVideo } = await import("../api/marketing-video.js");
const { ctToday } = await import("../api/_lib/marketing-ai.js");

let failed = 0;
const check = (ok, label) => { console.log((ok ? "PASS  " : "FAIL  ") + label); if (!ok) failed++; };
const addDays = (s, n) => new Date(Date.parse(s + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const today = ctToday();
const video = { id: 7, status: "ready", active: true, release_ok: true, line: "volleyball", created_at: new Date().toISOString(), filename: "pod.mp4",
  moments: [1, 2, 3].map(i => ({ id: "m" + i, label: "Moment " + i, start: i * 3, end: i * 3 + 2.5, score: 10 - i, thumb_url: "https://x/t" + i + ".jpg" })) };
const sb = fakeSupabase({ mkt_videos: [video], mkt_items: [], mkt_settings: [{ id: 1, cadence: { social: { time: "18:30" } } }], mkt_music: [], mkt_log: [], mkt_video_collections: [] });
const who = { me: "brandon@drippingsportsclub.com" };

const made = await runVideo(sb, who, { action: "reel_create", picks: [{ video_id: 7, moment_id: "m1" }, { video_id: 7, moment_id: "m2" }] });
check(onShelf(made.item) && made.item.week_of === SHELF_WEEK && made.item.scheduled_at === null && made.item.status === "draft", "Make a reel: it lands on the shelf - no week on the calendar, no time");
const dated = await runVideo(sb, who, { action: "reel_create", picks: [{ video_id: 7, moment_id: "m3" }], day: addDays(today, 3) });
check(dated.item.week_of === weekStartOf(addDays(today, 3)) && dated.item.scheduled_at, "given a day, it still goes straight on the calendar");

// The calendar and the poster look by week and by approved + time: a shelf reel matches neither.
const weekRows = sb.db.mkt_items.filter(r => r.week_of === weekStartOf(today) || r.week_of === weekStartOf(addDays(today, 7)));
check(!weekRows.some(r => r.id === made.item.id), "no calendar week shows a shelf reel");

await runVideo(sb, who, { action: "reel_schedule", id: made.item.id, day: addDays(today, -1) }).then(() => check(false, "past day"), e => check(/today or a later day/.test(e.message), "a day in the past is refused"));
const day = addDays(today, 5);
const on = await runVideo(sb, who, { action: "reel_schedule", id: made.item.id, day, time: "17:15" });
check(on.item.week_of === weekStartOf(day) && /T22:15|T23:15/.test(on.item.scheduled_at) && on.item.status === "draft", `Put on the calendar: that week, 5:15pm Central, a draft to approve (${on.item.scheduled_at})`);
await runVideo(sb, who, { action: "reel_delete", id: made.item.id }).then(() => check(false, "delete from calendar"), e => check(/Back to the shelf/.test(e.message), "a reel on the calendar can't be deleted from the shelf"));

sb.db.mkt_items.find(r => r.id === made.item.id).status = "approved";
const back = await runVideo(sb, who, { action: "reel_shelve", id: made.item.id });
check(onShelf(back.item) && back.item.scheduled_at === null && back.item.status === "draft" && back.item.approved_by == null, "Back to the shelf: off the calendar, and approval cleared so it can't post");

sb.db.mkt_items.find(r => r.id === dated.item.id).status = "published";
await runVideo(sb, who, { action: "reel_shelve", id: dated.item.id }).then(() => check(false, "posted"), e => check(e.status === 409, "a posted reel stays where it is"));
await runVideo(sb, who, { action: "reel_schedule", id: dated.item.id, day }).then(() => check(false, "posted 2"), e => check(e.status === 409, "…and can't be rescheduled"));

await runVideo(sb, who, { action: "reel_delete", id: made.item.id });
check(!sb.db.mkt_items.some(r => r.id === made.item.id), "Delete throws a shelf reel away");
await runVideo(sb, who, { action: "reel_schedule", id: 999, day }).then(() => check(false, "gone"), e => check(e.status === 404, "a reel that's gone says so"));

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
