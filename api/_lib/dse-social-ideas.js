// DS Elite Social: fun ideas (Drew, Oct 29 2026: "a fun ideas social post for
// the DS Elite program - holidays, upcoming tournaments, schedules of
// tournaments when they are posted, birthdays of coaches, memes and viral
// posts and things").
//
// Ideas live in dse_social_ideas (migrations/20261110_dse_social_ideas.sql).
// Two sources:
//   From the club's own data, every day (syncIdeas):
//     birthday    a coach on this season's teams has a birthday in the next
//                 two weeks (coach_roster.dob - the day only, never the year
//                 or an age), with their staff photo
//     tournament  DS Elite teams play a tournament in the next 12 days: the
//                 teams going, the dates, the city
//     schedule    a tournament's schedule has been posted on AES / OTTO (the
//                 Tournament Hub sync flips tournament_feeds.published)
//     holiday     a holiday or volleyball-worthy day in the next three weeks
//   From Claude, weekly or on demand (brainstorm): memes, trends, engagement
//   posts (This or That, caption this, polls) and throwbacks, written for DS
//   Elite, using this week's TikTok / Reels trends (marketing-scout's
//   trendScan) when the search works.
// "Make it a post" (draftIdea) draws the graphic (renderCard), drafts a
// dse_social_posts row (kind 'idea', format 'single') and sends it to the
// approvers in Slack like any other draft. With settings.auto_ideas on, the
// data ideas (birthday, tournament, schedule) are drafted on their own two days
// ahead. Nothing posts without an approval, and kids are never named.

import { claudeClient } from "./ai-client.js";
import { renderCard, photo as loadPhoto } from "./dse-social-render.js";
import { getSettings, teamLabel, upload, notifyApprovers, ctInstant, nextSlot, coachList, AI_MODEL } from "./dse-social.js";
import { trendScan } from "./marketing-scout.js";
import { isEventTeam } from "../../shared/event-teams.js";

const fail = (status, msg) => Object.assign(new Error(msg), { status });
export const ctToday = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const addDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (ymd) => new Date(ymd + "T12:00:00Z").getUTCDay();
const fmt = (ymd, o = { month: "short", day: "numeric" }) => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
const nrm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
export const IDEA_KINDS = ["birthday", "tournament", "schedule", "holiday", "meme", "trend", "engagement", "throwback"];
// When each kind goes out (Central): a birthday in the morning, everything else at the evening slot.
const TIME = { birthday: "08:30", holiday: "09:00" };

// ── holidays ────────────────────────────────────────────────────────────────
const nthDow = (y, m, wd, n) => { const d = new Date(Date.UTC(y, m - 1, 1)); let c = 0; while (true) { if (d.getUTCDay() === wd && ++c === n) return d.toISOString().slice(0, 10); d.setUTCDate(d.getUTCDate() + 1); } };
const lastDow = (y, m, wd) => { const d = new Date(Date.UTC(y, m, 0)); while (d.getUTCDay() !== wd) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
function easter(y) {   // Anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
}
// [slug, name, date, angle] - the angle is the default card line and a hint for the caption.
export function holidays(y) {
  const f = (m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return [
    ["new-year", "Happy New Year", f(1, 1), "New year, new goals. What's yours this season?"],
    ["mlk", "Martin Luther King Jr. Day", nthDow(y, 1, 1, 3), "Honoring Dr. King's legacy of service"],
    ["ngwsd", "National Girls & Women in Sports Day", nthDow(y, 2, 3, 1), "Celebrating every girl who plays"],
    ["valentines", "Happy Valentine's Day", f(2, 14), "Our first love? This game."],
    ["st-patricks", "Happy St. Patrick's Day", f(3, 17), "Lucky to have this crew"],
    ["easter", "Happy Easter", easter(y), "From all of us at DS Elite"],
    ["mothers-day", "Happy Mother's Day", nthDow(y, 5, 0, 2), "To the moms in the stands at every early wave"],
    ["memorial-day", "Memorial Day", lastDow(y, 5, 1), "Remembering those who gave everything"],
    ["fathers-day", "Happy Father's Day", nthDow(y, 6, 0, 3), "To the dads hauling coolers to every tournament"],
    ["july-4", "Happy 4th of July", f(7, 4), "Red, white and volleyball"],
    ["labor-day", "Happy Labor Day", nthDow(y, 9, 1, 1), "A long weekend well earned"],
    ["halloween", "Happy Halloween", f(10, 31), "Costumes on, kneepads optional"],
    ["veterans-day", "Veterans Day", f(11, 11), "Thank you to everyone who served"],
    ["thanksgiving", "Happy Thanksgiving", nthDow(y, 11, 4, 4), "Thankful for this team, these families and this game"],
    ["christmas", "Merry Christmas", f(12, 25), "From our DS Elite family to yours"],
    ["new-years-eve", "Last practice of the year", f(12, 31), "See you in the new year, DS Elite"],
  ].map(([slug, name, date, angle]) => ({ slug, name, date, angle }));
}

// ── what the cards are made of ──────────────────────────────────────────────
// Public photos DS Elite has already posted (copied to the dse-social bucket),
// newest first; a team's own first when one is named.
async function postedPhotos(sb, teams = []) {
  const { data } = await sb.from("dse_social_posts").select("team_name, photos, published_at").eq("kind", "photos").eq("status", "published").order("published_at", { ascending: false }).limit(60);
  const want = new Set(teams.map(nrm));
  const all = [];
  for (const p of data || []) for (const ph of p.photos || []) if (ph?.url) all.push({ url: ph.url, focus: ph.focus || null, team: p.team_name || null });
  return [...all.filter(p => want.has(nrm(p.team))), ...all.filter(p => !want.has(nrm(p.team)))];
}
// Drew's stock photos (HQ -> Social -> Stock photos): least-used first, then
// Claude's social score (api/_lib/dse-stock-ai.js); its focal point crops the card.
// Hidden ones (Drew's call, or Claude's safety flag) never come back here.
async function stockPhotos(sb) {
  const { data } = await sb.from("dse_social_stock").select("id, url, team_name, used_count, created_at, ai").eq("hidden", false)
    .order("used_count").order("created_at", { ascending: false }).limit(500);
  const score = (s) => s.ai?.social_score ?? 6;
  return (data || []).sort((a, b) => (a.used_count || 0) - (b.used_count || 0) || score(b) - score(a))
    .map(s => ({ url: s.url, focus: s.ai ? { x: s.ai.focal_x / 100, y: s.ai.focal_y / 100 } : null, team: s.team_name || null, stock_id: s.id }));
}
// What an idea card can be drawn on: the team's stock photos, the team's
// posted photos, then club-wide stock, then everything else posted.
async function cardPool(sb, teams = []) {
  const want = new Set(teams.map(nrm));
  const [stock, posted] = await Promise.all([stockPhotos(sb), postedPhotos(sb, teams)]);
  const mine = (l) => l.filter(p => want.has(nrm(p.team))), rest = (l) => l.filter(p => !want.has(nrm(p.team)));
  return [...mine(stock), ...mine(posted), ...rest(stock).sort((a, b) => (a.team ? 1 : 0) - (b.team ? 1 : 0)), ...rest(posted)];
}
async function staffPhoto(sb, name) {
  const { data } = await sb.from("site_staff").select("name, photo_url").ilike("name", String(name || "").trim()).maybeSingle();
  return data?.photo_url || null;
}

// ── data ideas ──────────────────────────────────────────────────────────────
function parseDob(s) {
  const m = String(s || "").match(/(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/) || String(s || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  if (m[0].length >= 10 && /^\d{4}/.test(m[0])) return { m: +m[2], d: +m[3] };
  return +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31 ? { m: +m[1], d: +m[2] } : null;
}
// -> [{ key, kind, post_on, title, pitch, caption, hashtags, card, data }]
export async function dataIdeas(sb, today = ctToday()) {
  const out = [];
  // birthdays: coaches on this season's teams (plus the directors on the staff page)
  const [coaches, { data: roster }, { data: leaders }] = await Promise.all([
    coachList(sb), sb.from("coach_roster").select("id, first_name, last_name, dob"),
    sb.from("site_staff").select("name").eq("leadership", true).eq("show_on_site", true),
  ]);
  const lead = new Set((leaders || []).map(l => nrm(l.name)));
  const teamsOf = new Map(coaches.map(c => [c.id, c.teams]));
  for (const r of roster || []) {
    const name = `${r.first_name || ""} ${r.last_name || ""}`.trim(), teams = teamsOf.get(r.id) || [];
    if (!name || (!teams.length && !lead.has(nrm(name)))) continue;
    const md = parseDob(r.dob); if (!md) continue;
    for (const y of [+today.slice(0, 4), +today.slice(0, 4) + 1]) {
      const day = `${y}-${String(md.m).padStart(2, "0")}-${String(md.d).padStart(2, "0")}`;
      if (day < today || day > addDays(today, 14)) continue;
      const fn = first(name);
      out.push({
        key: `bday:${r.id}:${y}`, kind: "birthday", post_on: day, title: `Coach ${fn}'s birthday`,
        pitch: `Coach ${name}'s birthday is ${fmt(day, { weekday: "long", month: "short", day: "numeric" })}.${teams.length ? ` Coaches ${teams.join(" and ")}.` : ""}`,
        caption: `Happy birthday, Coach ${fn}! 🎉 Thank you for everything you pour into ${teams.length ? teams.join(" and ") : "DS Elite"}. Drop your birthday wishes for Coach ${fn} below 👇`,
        hashtags: ["HappyBirthday"], card: { style: "birthday", tag: "Happy birthday", headline: `Coach ${fn}`, sub: teams.length ? teams.join("  ·  ") : "From all of DS Elite" },
        data: { coach: name, roster_id: r.id, teams },
      });
    }
  }
  // tournaments in the next 12 days, with the DS Elite teams going
  const { data: tours } = await sb.from("tournaments").select("id, name, start_date, end_date, location, venue, cancelled").gte("start_date", addDays(today, 1)).lte("start_date", addDays(today, 12)).order("start_date");
  const ids = (tours || []).filter(t => !t.cancelled).map(t => t.id);
  const { data: asg } = ids.length ? await sb.from("tournament_assignments").select("tournament_id, team_id, status").in("tournament_id", ids) : { data: [] };
  const going = new Map();
  for (const a of asg || []) if (!/drop/i.test(a.status || "")) { if (!going.has(a.tournament_id)) going.set(a.tournament_id, []); going.get(a.tournament_id).push(teamLabel(a.team_id)); }
  for (const t of (tours || []).filter(t => going.has(t.id))) {
    const teams = [...new Set(going.get(t.id))].sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b));
    const city = String(t.location || "").split(",")[0].trim();
    const dates = t.end_date && t.end_date !== t.start_date ? `${fmt(t.start_date)}–${fmt(t.end_date, { day: "numeric" })}` : fmt(t.start_date);
    const post_on = [addDays(t.start_date, -2), today].sort().pop();
    out.push({
      key: `tourney:${t.id}`, kind: "tournament", post_on, title: `Game week: ${t.name}`,
      pitch: `${teams.length} DS Elite team${teams.length === 1 ? "" : "s"} play ${t.name}${city ? " in " + city : ""}, ${dates}.`,
      caption: `Game week! 🏐 ${teams.length === 1 ? teams[0] + " heads" : teams.length + " DS Elite teams head"} to ${t.name}${city ? " in " + city : ""} this weekend. Good luck, ladies - go get it! 💗`,
      hashtags: ["GameWeek"], card: { style: "tournament", tag: "Game week", headline: t.name, sub: [dates, t.location].filter(Boolean).join("  ·  "), lines: teams },
      data: { tournament_id: t.id, teams },
    });
  }
  // schedules posted for the next 10 days' tournaments
  const { data: feeds } = await sb.from("tournament_feeds").select("tournament_id, platform, published, event_name, start_date").eq("published", true).gte("start_date", today).lte("start_date", addDays(today, 10));
  const seen = new Set();
  for (const f of feeds || []) {
    if (!f.tournament_id || seen.has(f.tournament_id)) continue; seen.add(f.tournament_id);
    const { data: rows } = await sb.from("tournament_team_feed").select("team_name").eq("tournament_id", f.tournament_id);
    const teams = [...new Set((rows || []).map(r => teamLabel(r.team_name)))].filter(Boolean);
    if (!teams.length) continue;
    const t = (tours || []).find(x => x.id === f.tournament_id) || (await sb.from("tournaments").select("name, start_date, location").eq("id", f.tournament_id).maybeSingle()).data || {};
    out.push({
      key: `sched:${f.tournament_id}`, kind: "schedule", post_on: today, title: `Schedules are out: ${t.name || f.event_name}`,
      pitch: `The pool schedules for ${t.name || f.event_name} are posted on ${f.platform === "aes" ? "AES" : "OTTO"}.`,
      caption: `Schedules are out for ${t.name || f.event_name}! 📅 Families, check your team's pool, courts and first-serve times in the DS Elite app or on ${f.platform === "aes" ? "AES" : "the event site"}. See you on the court! 🏐`,
      hashtags: ["GameWeek"], card: { style: "schedule", tag: "Schedules are out", headline: t.name || f.event_name, sub: t.start_date ? fmt(t.start_date, { weekday: "short", month: "short", day: "numeric" }) + (t.location ? "  ·  " + t.location : "") : "", lines: teams },
      data: { tournament_id: f.tournament_id, teams, platform: f.platform },
    });
  }
  // holidays in the next three weeks
  for (const y of [+today.slice(0, 4), +today.slice(0, 4) + 1]) for (const h of holidays(y)) {
    if (h.date < today || h.date > addDays(today, 21)) continue;
    out.push({
      key: `holiday:${h.slug}:${y}`, kind: "holiday", post_on: h.date, title: h.name, pitch: `${h.name} is ${fmt(h.date, { weekday: "long", month: "short", day: "numeric" })}.`,
      caption: `${h.angle} 💗`, hashtags: [], card: { style: "holiday", tag: fmt(h.date, { month: "short", day: "numeric" }), headline: h.name, sub: h.angle },
      data: { holiday: h.slug },
    });
  }
  return out;
}

// Store what's new (a key that's already there - drafted, dismissed or not - is left alone).
export async function syncIdeas(sb, { today = ctToday() } = {}) {
  const ideas = await dataIdeas(sb, today);
  if (!ideas.length) return { added: 0 };
  const { data, error } = await sb.from("dse_social_ideas").upsert(ideas.map(i => ({ ...i, created_by: "auto" })), { onConflict: "key", ignoreDuplicates: true }).select("id");
  if (error) throw fail(500, error.message);
  return { added: (data || []).length };
}

// ── Claude's ideas ──────────────────────────────────────────────────────────
const BRAIN_SCHEMA = {
  type: "object", additionalProperties: false, required: ["ideas"],
  properties: { ideas: { type: "array", items: {
    type: "object", additionalProperties: false,
    required: ["kind", "title", "pitch", "post_on", "caption", "hashtags", "style", "tag", "headline", "sub", "top", "bottom"],
    properties: {
      kind: { type: "string", enum: ["meme", "trend", "engagement", "throwback", "holiday"] },
      title: { type: "string" }, pitch: { type: "string" }, post_on: { type: "string" },
      caption: { type: "string" }, hashtags: { type: "array", items: { type: "string" } },
      style: { type: "string", enum: ["meme", "text", "holiday"] },
      tag: { type: "string" }, headline: { type: "string" }, sub: { type: "string" }, top: { type: "string" }, bottom: { type: "string" },
    },
  } } },
};
const BRAIN_SYSTEM = `You come up with fun social posts for DS Elite Volleyball, a girls' club volleyball program (players about 10-18) in Dripping Springs, Texas, posting to its Facebook Page and Instagram. The audience is players, parents and families in the club and nearby. A director approves every post.
Each idea becomes ONE image the club's system draws, in one of three styles:
- meme: one of the club's own action photos (a team on the court, chosen by the system) with a short TOP line and BOTTOM line in classic meme lettering. Relatable volleyball / club-life humor: early tournament wake-ups, 7 hours in a gym for 3 matches, the parent cooler, the libero's jersey, "one more rep", shanked passes, line judges, tournament snacks, practice in the rain. Under 50 characters per line.
- text: no photo; big words on a pink field. For "POV: ..." posts, This or That, fill-in-the-blank, "comment your..." prompts, polls, "tag a teammate who...". Headline under 60 characters; sub (optional) under 80.
- holiday: a club photo with a tag (the date), a headline and a line under it.
Rules: kind, warm and funny; never mean, never about a real player, parent, ref or other club; never name or describe a specific kid; no politics, religion or anything a parent wouldn't want on a club page; no copyrighted characters, song lyrics or brand mascots; nothing that needs video or music to work. Captions: 1-3 short sentences in the club's upbeat voice, at most 3 emoji, end with a question or call to comment when it fits, no links. Hashtags: 0-3, no '#'. post_on: a YYYY-MM-DD date in the window given, spread across it, at most one idea per day. Use the club context (upcoming tournaments, holidays, recent posts) and the trend notes when they fit; don't repeat a recent post's idea.`;

async function askJson(system, text, schema, feature) {
  const client = claudeClient(feature, { timeout: 120000, maxRetries: 1 });
  const msg = await client.beta.messages.create({
    model: AI_MODEL, max_tokens: 8000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    system, messages: [{ role: "user", content: text }],
  });
  if (msg.stop_reason === "refusal") throw new Error("Claude declined");
  return JSON.parse((msg.content || []).filter(b => b.type === "text").map(b => b.text).join(""));
}

export async function brainstorm(sb, { count = 6, today = ctToday(), by = "auto", trends = true } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw fail(500, "ANTHROPIC_API_KEY isn't set");
  const end = addDays(today, 14);
  const [data, { data: recent }, { data: open }, trend] = await Promise.all([
    dataIdeas(sb, today),
    sb.from("dse_social_posts").select("title, caption, published_at").eq("status", "published").order("published_at", { ascending: false }).limit(15),
    sb.from("dse_social_ideas").select("title, post_on").in("status", ["new", "drafted"]).gte("post_on", today),
    trends ? trendScan(today, { timeoutMs: 100000 }).catch(e => ({ text: "", sources: [], error: e.message })) : Promise.resolve({ text: "", sources: [] }),
  ]);
  const ctx = [
    `Today is ${fmt(today, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}. Window for post_on: ${today} to ${end}. Give ${count} ideas.`,
    data.filter(i => i.kind === "tournament").length ? `Upcoming DS Elite tournaments:\n${data.filter(i => i.kind === "tournament").map(i => "- " + i.pitch).join("\n")}` : "",
    data.filter(i => i.kind === "holiday").length ? `Holidays in the window (the system already makes a simple holiday card for each; only suggest one if you have a funnier angle):\n${data.filter(i => i.kind === "holiday").map(i => "- " + i.pitch).join("\n")}` : "",
    (open || []).length ? `Already planned (don't use these dates or repeat them):\n${open.map(o => `- ${o.post_on}: ${o.title}`).join("\n")}` : "",
    (recent || []).length ? `Recent DS Elite posts (don't repeat):\n${recent.map(p => "- " + String(p.caption || p.title || "").slice(0, 140).replace(/\n/g, " ")).join("\n")}` : "",
    trend.text ? `Trend notes from this week's search (adapt only what fits a girls' volleyball club, as a still image):\n${trend.text}` : "No trend search this time - use evergreen club-life humor and engagement formats.",
  ].filter(Boolean).join("\n\n");
  const ai = await askJson(BRAIN_SYSTEM, ctx, BRAIN_SCHEMA, "dse-social-ideas");
  const taken = new Set((open || []).map(o => o.post_on));
  const rows = [];
  for (const i of (ai.ideas || []).slice(0, count)) {
    let day = /^\d{4}-\d{2}-\d{2}$/.test(i.post_on) && i.post_on >= today && i.post_on <= end ? i.post_on : today;
    while (taken.has(day) && day < end) day = addDays(day, 1);
    taken.add(day);
    rows.push({
      kind: IDEA_KINDS.includes(i.kind) ? i.kind : "engagement", post_on: day, title: String(i.title).slice(0, 120), pitch: String(i.pitch || "").slice(0, 600),
      caption: String(i.caption || "").slice(0, 1500), hashtags: (i.hashtags || []).map(h => String(h).replace(/^#+/, "")).filter(Boolean).slice(0, 3),
      card: { style: i.style, tag: i.tag || "", headline: i.headline || i.title, sub: i.sub || "", top: i.top || "", bottom: i.bottom || "" },
      sources: trend.sources?.length && i.kind === "trend" ? trend.sources.slice(0, 5) : null, created_by: by, data: {},
    });
  }
  if (!rows.length) return { added: 0, trend_error: trend.error || null };
  const { data: saved, error } = await sb.from("dse_social_ideas").insert(rows).select("*");
  if (error) throw fail(500, error.message);
  await sb.from("dse_social_settings").update({ ideas_brainstormed_at: new Date().toISOString() }).eq("id", 1);
  return { added: saved.length, ideas: saved, trend_error: trend.error || null };
}

// ── Drew's own ideas ────────────────────────────────────────────────────────
// Drew, Oct 30 2026: "I need to be able to add my own ideas for the social post
// ... Make me a post looking for players for our 11 Regional Team, include the
// cost, the schedule, the practice, and the expectations." He types the
// request; Claude writes the post from the club's real facts (teams, coaches,
// practices, tournaments, rosters, fees, the commitment's expectations), and
// it becomes a draft for approval like any other idea.
const DISPLAY = (t) => teamLabel(t);   // "11 Rise 1" -> "11 Rise" in anything people read
const LEVEL_NAME = { National: "National", Regional: "Regional", Developmental: "Rise (development)" };
const FEES = [
  "Season fees 2026-27 (all levels: a $600 non-refundable deposit when a spot is accepted, then installments):",
  "- National: $5,400 (July 2026 - June 2027). $600 deposit + 4 x $1,200 (Oct 1, Dec 1, Feb 1, Apr 1). Includes national qualifier entry fees.",
  "- Regional: $4,200 (July 2026 - May 2027). $600 deposit + 4 x $900 (Oct 1, Dec 1, Feb 1, Apr 1).",
  "- Rise: $2,500 (December 2026 - May 2027). $600 deposit + 2 x $950 (Oct 1, Jan 1).",
  "- Every level includes: a guaranteed spot on the team, coaching, practice facility and equipment, entry fees for all scheduled regular-season tournaments, team uniforms.",
  "- Not included: travel, hotels, meals, the club team shoe (Regional and National buy it; Rise doesn't need it), USAV / Lone Star membership ($55).",
  "- A family joining now: payments already past due are due when they register.",
].join("\n");
// "3-4pm" + "4-5pm" on the same day read as one "3-5pm" practice.
const slotMins = (slot) => {
  const m = String(slot || "").replace(/\s+/g, "").toLowerCase().match(/^(\d{1,2})(?::(\d\d))?-(\d{1,2})(?::(\d\d))?(am|pm)$/);
  if (!m) return null;
  let e = (+m[3] % 12) * 60 + (+m[4] || 0) + (m[5] === "pm" ? 720 : 0), s = (+m[1] % 12) * 60 + (+m[2] || 0);
  if (m[5] === "pm" && s + 720 < e) s += 720;
  return { s, e };
};
const hm = (x, ap) => `${(Math.floor(x / 60) % 12) || 12}${x % 60 ? ":" + String(x % 60).padStart(2, "0") : ""}${ap ? (x >= 720 ? "pm" : "am") : ""}`;
const joinSlots = (slots) => {
  const ts = slots.map(slotMins);
  if (ts.some(t => !t)) return slots.map(x => String(x).replace(/\s+/g, ""));
  const out = [];
  for (const t of ts.sort((a, b) => a.s - b.s)) { const last = out[out.length - 1]; if (last && last.e >= t.s) last.e = Math.max(last.e, t.e); else out.push({ ...t }); }
  return out.map(t => `${hm(t.s, (t.s >= 720) !== (t.e >= 720))}-${hm(t.e, true)}`);
};
export async function clubFacts(sb, today = ctToday()) {
  const [{ data: teams }, { data: pa }, { data: players }, { data: ta }, { data: tn }, { PLAYER_CLAUSES, PARENT_CLAUSES }] = await Promise.all([
    sb.from("practice_teams").select("team_name, level, head_coach, assistant_coach, third_coach, practices_per_week"),
    sb.from("practice_assignments").select("team_name, phase, day, slot"),
    sb.from("players").select("team_assignment, offer_status").eq("season", "2026-27"),
    sb.from("tournament_assignments").select("team_id, tournament_id, status"),
    sb.from("tournaments").select("id, name, start_date, end_date, location, cancelled").gte("end_date", today).order("start_date"),
    import("../../shared/commitment.js"),
  ]);
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const sched = (team, phase) => DAYS.flatMap(d => joinSlots((pa || []).filter(a => a.team_name === team && a.phase === phase && a.day === d).map(a => a.slot)).map(x => `${d} ${x}`));
  const lines = [];
  for (const t of (teams || []).filter(x => !isEventTeam(x)).sort((a, b) => a.team_name.localeCompare(b.team_name, undefined, { numeric: true }))) {
    const n = (players || []).filter(p => p.team_assignment === t.team_name && ["accepted", "locked"].includes(p.offer_status)).length;
    const tours = (ta || []).filter(a => a.team_id === t.team_name && !/drop/i.test(a.status || "")).map(a => (tn || []).find(x => x.id === a.tournament_id)).filter(x => x && !x.cancelled)
      .sort((a, b) => a.start_date.localeCompare(b.start_date)).map(x => `${fmt(x.start_date)}${x.end_date && x.end_date !== x.start_date ? "-" + fmt(x.end_date) : ""} ${x.name.replace(/\s+/g, " ").trim()} (${x.location || ""})`);
    lines.push([
      `TEAM ${DISPLAY(t.team_name)} - level: ${LEVEL_NAME[t.level] || t.level || "?"} - ${n} players committed`,
      `  coaches: ${[t.head_coach && "head " + t.head_coach, t.assistant_coach && "assistant " + t.assistant_coach, t.third_coach && "also " + t.third_coach].filter(Boolean).join(", ") || "TBD"}`,
      sched(t.team_name, "fall2").length ? `  fall practices now (until the regular season):${sched(t.team_name, "fall2").join(", ")}` : "",
      `  regular-season practices (from the weekend after Thanksgiving, Nov 29): ${sched(t.team_name, "season").join(", ") || "TBD"}`,
      tours.length ? `  tournaments: ${tours.join("; ")}` : "  tournaments: TBD",
    ].filter(Boolean).join("\n"));
  }
  const expect = (cl) => cl.map(c => `- ${c.title}: ${c.points.slice(0, 2).join(" ")}`).join("\n");
  return [
    `Today: ${fmt(today, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}. Season 2026-27.`,
    "Levels: National (top teams, 3 practices a week in season, national qualifiers), Regional (competitive club season, 2 practices a week), Rise (development level for players newer to club, season Dec-May, 2 practices a week). The team names use gems: Diamond is National at most ages; Ruby, Sapphire, Emerald, Topaz are Regional (14 and 15 Ruby are National) - always go by the level listed per team. Ages: 11s = born on or after July 1 2015, 12s = July 1 2014, 13s = July 1 2013, and so on.",
    "Where: DSSC (Dripping Springs Sports Club) Warehouse I, 15113 Fitzhugh Rd, Suite 1400, Dripping Springs, TX, and Warehouse II next door (Courts 5-6).",
    "Contact: Drew Rose, Director - drew@dselitevolleyball.com, (512) 202-9099. Website: dselitevolleyball.com (fees and how teams form: dselitevolleyball.com/pricing).",
    FEES,
    "Teams:\n" + lines.join("\n"),
    "What we expect of players (the DS Elite commitment every player signs):\n" + expect(PLAYER_CLAUSES),
    "What we expect of parents:\n" + expect(PARENT_CLAUSES),
  ].join("\n\n");
}

const CUSTOM_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["title", "pitch", "caption", "hashtags", "style", "tag", "headline", "sub", "top", "bottom", "teams", "photo_id"],
  properties: {
    title: { type: "string" }, pitch: { type: "string" }, caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    style: { type: "string", enum: ["holiday", "text", "meme"] },
    tag: { type: "string" }, headline: { type: "string" }, sub: { type: "string" }, top: { type: "string" }, bottom: { type: "string" },
    teams: { type: "array", items: { type: "string" } },
    photo_id: { type: "integer" },
  },
};
const CUSTOM_SYSTEM = `You write one social media post for DS Elite Volleyball, a girls' club volleyball program (players about 10-18) at the Dripping Springs Sports Club in Texas, for its Facebook Page and Instagram. The club's director, Drew, tells you what he wants; write exactly that post. He approves it before it goes out.
Use ONLY the club facts given (teams, levels, coaches, practice days and times, tournaments, fees, expectations, contact). Never invent a price, date, time, coach, player count or promise. If he asks for something the facts don't cover, leave it out rather than guess. Team names exactly as listed (say "11 Rise", never "11 Rise 1"). When he says "the 11 Regional team" etc., find the team at that age whose level is Regional.
Caption: the club's warm, upbeat, confident voice, written for parents. Short paragraphs or short labeled lines (e.g. "Cost:", "Practices:", "Tournaments:") so it scans on a phone; up to about 1,200 characters when he asks for details, shorter otherwise; at most 4 emoji. End with a clear call to action using the contact in the facts (email / phone / website) when the post wants a response, like recruiting. Never name, describe or picture a specific child. Hashtags: 0-4, no '#'.
The post's image is one graphic the club draws, in one of three styles:
- holiday: one of the team's own action photos with a small TAG line on top (e.g. "NOW RECRUITING"), a big HEADLINE (under 40 characters) and a SUB line under it (under 70 characters). Best for announcements and recruiting.
- text: no photo; big words on a pink field: HEADLINE (under 60 characters) and SUB (under 80).
- meme: a team photo with TOP and BOTTOM lines in meme lettering, for humor only.
teams: the exact team names from the facts the post is about (used to pick the photo); [] if none. photo_id: the stock photo from the list that best fits this post (right team or club-wide, right moment, strong score, room for the headline, not over-used), or 0 if none fits better than a random photo of the team. title: a short name for the post in the planner. pitch: one sentence on what the post does.`;

// The stock photos Claude can choose from, described (Drew's note + Claude's
// read), best social score first; the given teams' own photos lead the list.
async function stockMenu(sb, teams = []) {
  const { data: stock } = await sb.from("dse_social_stock").select("id, url, team_name, note, ai, used_count").eq("hidden", false).order("created_at", { ascending: false }).limit(400);
  const about = (s) => [s.note, s.ai?.description].map(x => String(x || "").trim()).filter(Boolean).join(" | ");
  const want = new Set(teams.map(nrm));
  const described = (stock || []).filter(s => about(s))
    .sort((a, b) => (want.has(nrm(b.team_name)) - want.has(nrm(a.team_name))) || (b.ai?.social_score || 0) - (a.ai?.social_score || 0)).slice(0, 120);
  const photoList = described.length ? `\n\nStock photos (id: team - what's in it [social score /10, good for, headline space, times used]):\n${described.map(s => `${s.id}: ${s.team_name ? DISPLAY(s.team_name) : "club"} - ${about(s).slice(0, 260)}${s.ai ? ` [${s.ai.social_score}/10; ${(s.ai.best_for || []).join(", ") || "-"}; space ${s.ai.text_space}; used ${s.used_count || 0}x]` : ""}`).join("\n")}` : "\n\n(No described stock photos; photo_id 0.)";
  return { described, photoList, about };
}
const stockDesign = (p) => ({ photo_url: p.url, focus: p.ai ? { x: p.ai.focal_x / 100, y: p.ai.focal_y / 100 } : null });

export async function customIdea(sb, { prompt, post_on = null, today = ctToday(), by = "Drew" } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw fail(500, "ANTHROPIC_API_KEY isn't set");
  const ask = String(prompt || "").trim();
  if (ask.length < 5) throw fail(400, "Tell Claude what the post should be about.");
  const [facts, { described, photoList }] = await Promise.all([clubFacts(sb, today), stockMenu(sb)]);
  const ai = await askJson(CUSTOM_SYSTEM, `Club facts:\n${facts}${photoList}\n\nDrew's request:\n${ask}`, CUSTOM_SCHEMA, "dse-social-custom");
  const picked = ai.style !== "text" && described.find(s => s.id === Number(ai.photo_id));
  const known = new Map(((await sb.from("practice_teams").select("team_name")).data || []).map(t => [DISPLAY(t.team_name).toLowerCase(), t.team_name]));
  const teams = (ai.teams || []).map(t => known.get(String(t).toLowerCase().trim()) || known.get(DISPLAY(t).toLowerCase())).filter(Boolean);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(post_on || "")) && post_on >= today ? post_on : today;
  const { data: idea, error } = await sb.from("dse_social_ideas").insert({
    kind: "custom", post_on: day, title: String(ai.title || ask).slice(0, 120), pitch: String(ai.pitch || "").slice(0, 600),
    caption: String(ai.caption || "").slice(0, 2000), hashtags: (ai.hashtags || []).map(h => String(h).replace(/^#+/, "")).filter(Boolean).slice(0, 4),
    card: { style: ai.style, tag: ai.tag || "", headline: ai.headline || ai.title, sub: ai.sub || "", top: ai.top || "", bottom: ai.bottom || "", ...(picked ? stockDesign(picked) : {}), teams },
    created_by: by, data: { prompt: ask, teams },
  }).select("*").single();
  if (error) throw fail(500, error.message);
  const r = await draftIdea(sb, idea.id, { by });
  return { idea, post: r.post };
}

// ── idea -> draft post ──────────────────────────────────────────────────────
// The card's photo: the coach's staff photo for a birthday; otherwise one the
// club has already posted (that team's first for a tournament). photo_index
// steps through the pool ("Try another photo").
async function cardPhoto(sb, idea, design) {
  if (design.photo_url) return { url: design.photo_url, focus: design.focus || null };   // picked in Drafts
  if (idea.kind === "birthday") { const url = design.photo || await staffPhoto(sb, idea.data?.coach); return url ? { url, focus: { x: 0.5, y: 0.3 } } : null; }
  if (design.style === "text") return null;
  const pool = await cardPool(sb, idea.data?.teams || []);
  if (!pool.length) return null;
  const n = Number(design.photo_index) || 0;
  return pool[((n % pool.length) + pool.length) % pool.length];
}
export async function renderIdea(sb, idea, design) {
  const ph = await cardPhoto(sb, idea, design);
  const img = ph ? await loadPhoto(ph.url).catch(() => null) : null;
  const buf = await renderCard({ ...design, img, focus: ph?.focus || design.focus });
  const url = await upload(sb, `ideas/${idea.id}/card-${Date.now().toString(36)}.jpg`, buf);
  return { asset_url: url, photo: ph?.url || null };
}
export async function draftIdea(sb, id, { by = "auto", notify = true } = {}) {
  const { data: idea } = await sb.from("dse_social_ideas").select("*").eq("id", Number(id)).maybeSingle();
  if (!idea) throw fail(404, "No such idea");
  if (idea.status === "drafted" && idea.post_id) return { post_id: idea.post_id, already: true };
  const s = await getSettings(sb);
  const design = { ...(idea.card || {}), idea_id: idea.id, photo_index: 0, teams: idea.data?.teams || idea.card?.teams || [] };
  const { asset_url, photo } = await renderIdea(sb, idea, design);
  const at = ctInstant(idea.post_on || ctToday(), TIME[idea.kind] || s.intro_time);
  const scheduled_at = at.getTime() > Date.now() + 10 * 60e3 ? at : await nextSlot(sb, s);
  const { data: post, error } = await sb.from("dse_social_posts").insert({
    kind: "idea", format: "single", status: "draft", title: idea.title, caption: idea.caption || "", hashtags: [...(idea.hashtags || []), ...s.hashtags].filter((h, i, a) => a.indexOf(h) === i).slice(0, 8),
    design: { ...design, idea_kind: idea.kind }, asset_url, photos: photo ? [{ url: photo }] : [], platforms: s.platforms, created_by: by,
    scheduled_at: scheduled_at.toISOString(), ai: { idea_id: idea.id },
  }).select().single();
  if (error) throw fail(500, error.message);
  await sb.from("dse_social_ideas").update({ status: "drafted", post_id: post.id, updated_at: new Date().toISOString() }).eq("id", idea.id);
  if (photo) await markStockUsed(sb, photo);
  if (notify) await notifyApprovers(sb, post, s).catch(e => console.error("dse ideas slack", e.message));
  return { post };
}
// Count a stock photo's use, so the next card reaches for a different one.
export async function markStockUsed(sb, url) {
  const { data: s } = await sb.from("dse_social_stock").select("id, used_count").eq("url", url).maybeSingle();
  if (s) await sb.from("dse_social_stock").update({ used_count: (s.used_count || 0) + 1, last_used_at: new Date().toISOString() }).eq("id", s.id);
}
// Redraw an idea post after its words changed in HQ, or "Try another photo".
export async function rerenderIdea(sb, post) {
  const d = post.design || {};
  const { data: idea } = await sb.from("dse_social_ideas").select("*").eq("id", Number(d.idea_id)).maybeSingle();
  const r = await renderIdea(sb, idea || { id: d.idea_id || "x", kind: d.idea_kind, data: {} }, d);
  return { asset_url: r.asset_url, photos: r.photo ? [{ url: r.photo }] : [] };
}

// ── Drew's feedback on a draft ──────────────────────────────────────────────
// Drew, Oct 30 2026: "I want to be able to pick new pictures and provide
// feedback on how to update drafted social media posts." He writes what to
// change; Claude rewrites the caption (and, for an idea post, the graphic's
// words and photo) from the club's facts, the stock photo descriptions and
// his earlier notes on this post. Every round is kept in post.ai.revisions.
const REVISE_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["caption", "hashtags", "style", "tag", "headline", "sub", "top", "bottom", "photo_id", "changed"],
  properties: {
    caption: { type: "string" }, hashtags: { type: "array", items: { type: "string" } },
    style: { type: "string", enum: ["holiday", "text", "meme", "keep"] },
    tag: { type: "string" }, headline: { type: "string" }, sub: { type: "string" }, top: { type: "string" }, bottom: { type: "string" },
    photo_id: { type: "integer" }, changed: { type: "string" },
  },
};
const REVISE_SYSTEM = `You revise one draft social media post for DS Elite Volleyball, a girls' club volleyball program (players about 10-18) at the Dripping Springs Sports Club in Texas, for its Facebook Page and Instagram. Drew, the director, read the draft and says what to change. Make exactly the changes he asks for and keep everything else as it is - same voice, same facts, same structure - unless his note implies otherwise.
Facts: use ONLY the club facts given; never invent a price, date, time, coach, result or promise. If he asks for a fact that isn't in the facts, write it exactly as he states it; if he asks for something you can't know, leave it out and say so in "changed". Team names exactly as listed ("11 Rise", never "11 Rise 1"). Never name, describe or picture a specific child. At most 4 emoji. Hashtags without '#', 0-4 (the club's standard tags are added separately).
The graphic (idea posts only; for other posts return the current values unchanged and style "keep"): style holiday = a photo with a small TAG line, a big HEADLINE (under 40 characters) and a SUB line (under 70); text = no photo, HEADLINE under 60 and SUB under 80 on a pink field; meme = a photo with TOP and BOTTOM lines. Return the full set of words even if unchanged; style "keep" to keep the current style.
photo_id: when he asks for a different picture (or the change calls for one), the stock photo id from the list that best fits what he asked for and the post - right team or club-wide, right moment, room for the headline, not over-used, and not the current photo. 0 keeps the current photo.
When shortening, cut wording before facts; never drop a fact Drew asked for in his original request (cost, payment plan, schedule, contact...) unless he says to.
changed: one or two short sentences telling Drew exactly what you changed - name every fact or detail you removed (e.g. "dropped the payment schedule") and anything you couldn't do. Never claim nothing was removed when something was.`;

export async function revisePost(sb, post, { feedback, by = "Drew", today = ctToday() } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw fail(500, "ANTHROPIC_API_KEY isn't set");
  const note = String(feedback || "").trim();
  if (note.length < 3) throw fail(400, "Tell Claude what to change.");
  if (["published", "publishing"].includes(post.status)) throw fail(400, "It's already posted");
  const d = post.design || {};
  const isIdea = post.kind === "idea";
  const { data: idea } = isIdea && d.idea_id ? await sb.from("dse_social_ideas").select("kind, data").eq("id", Number(d.idea_id)).maybeSingle() : { data: null };
  const teams = d.teams || idea?.data?.teams || (post.team_name ? [post.team_name] : []);
  const [facts, menu, s] = await Promise.all([clubFacts(sb, today), isIdea ? stockMenu(sb, teams) : { described: [], photoList: "" }, getSettings(sb)]);
  const cur = d.photo_url ? (await sb.from("dse_social_stock").select("id, note, ai").eq("url", d.photo_url).maybeSingle()).data : null;
  const std = new Set((s.hashtags || []).map(h => h.toLowerCase()));
  const history = (post.ai?.revisions || []).slice(-5);
  const text = [
    `Club facts:\n${facts}`,
    isIdea ? menu.photoList : "",
    `\n\nTHE DRAFT (${isIdea ? `idea post${idea?.kind ? ", " + idea.kind : ""}` : post.kind === "coach_intro" ? "coach intro poster" : "photo post of family photos"}):`,
    idea?.data?.prompt ? `Drew's original request: ${idea.data.prompt}` : "",
    `Caption:\n${post.caption || ""}`,
    `Hashtags: ${(post.hashtags || []).filter(h => !std.has(String(h).toLowerCase())).join(" ") || "(none)"}`,
    isIdea ? `Graphic: style ${d.style || "?"}; tag "${d.tag || ""}"; headline "${d.headline || ""}"; sub "${d.sub || ""}"; top "${d.top || ""}"; bottom "${d.bottom || ""}"` : "",
    isIdea ? `Current photo: ${cur ? `stock #${cur.id} - ${menu.about ? menu.about(cur) : cur.ai?.description || ""}` : d.style === "text" ? "none (text card)" : "a photo from an earlier club post (no description)"}` : "",
    history.length ? `Drew's earlier notes on this post (already done): ${history.map(h => `"${h.feedback}"`).join("; ")}` : "",
    `\nDREW'S NOTE NOW:\n${note}`,
  ].filter(Boolean).join("\n");
  const ai = await askJson(REVISE_SYSTEM, text, REVISE_SCHEMA, "dse-social-revise");

  const patch = { caption: String(ai.caption || post.caption || "").slice(0, 2000), updated_at: new Date().toISOString() };
  patch.hashtags = [...(ai.hashtags || []).map(h => String(h).replace(/^#+/, "").trim()).filter(Boolean).slice(0, 4), ...(s.hashtags || [])].filter((h, i, a) => a.findIndex(x => x.toLowerCase() === h.toLowerCase()) === i).slice(0, 8);
  let newPhoto = null;
  if (isIdea) {
    const style = ai.style === "keep" ? d.style : ai.style;
    const design = { ...d, style, tag: ai.tag, headline: ai.headline || d.headline, sub: ai.sub, top: ai.top, bottom: ai.bottom };
    const pick = style !== "text" && Number(ai.photo_id) ? menu.described.find(x => x.id === Number(ai.photo_id) && x.url !== d.photo_url) : null;
    if (pick) { Object.assign(design, stockDesign(pick)); newPhoto = pick; }
    patch.design = design;
    Object.assign(patch, await rerenderIdea(sb, { ...post, design }));
    if (pick) await markStockUsed(sb, pick.url);
  }
  if (post.status === "approved") Object.assign(patch, { status: "draft", approved_by: null, approved_at: null });
  patch.ai = { ...(post.ai || {}), revisions: [...(post.ai?.revisions || []), { at: new Date().toISOString(), by, feedback: note.slice(0, 1000), changed: String(ai.changed || "").slice(0, 400), photo: newPhoto?.id || null }] };
  const { data, error } = await sb.from("dse_social_posts").update(patch).eq("id", post.id).select().single();
  if (error) throw fail(500, error.message);
  return { post: data, changed: ai.changed || "" };
}

// ── the daily run (from dse-social runCron) ─────────────────────────────────
// Once a day: store new data ideas, and with auto_ideas on draft the data ones
// due within two days. Mondays (or when there are none ahead), Claude adds a
// week's fun ideas.
export async function ideasCron(sb, s, { now = new Date(), dry = false } = {}) {
  const out = { synced: null, drafted: [], brainstorm: null };
  const today = ctToday(now);
  if (s.ideas_synced_at && ctToday(new Date(s.ideas_synced_at)) === today) return { skipped: "already ran today" };
  if (dry) return { would: "sync ideas" };
  out.synced = await syncIdeas(sb, { today });
  if (s.auto_ideas) {
    const { data: due } = await sb.from("dse_social_ideas").select("id").eq("status", "new").in("kind", ["birthday", "tournament", "schedule"]).lte("post_on", addDays(today, 2)).gte("post_on", today).limit(4);
    for (const i of due || []) out.drafted.push(await draftIdea(sb, i.id).then(r => ({ id: i.id, post: r.post?.id })).catch(e => ({ id: i.id, error: e.message })));
  }
  const { count } = await sb.from("dse_social_ideas").select("id", { count: "exact", head: true }).eq("status", "new").in("kind", ["meme", "trend", "engagement", "throwback"]).gte("post_on", today);
  if (dow(today) === 1 || !count) out.brainstorm = await brainstorm(sb, { today }).then(r => ({ added: r.added, trend_error: r.trend_error })).catch(e => ({ error: e.message }));
  await sb.from("dse_social_settings").update({ ideas_synced_at: now.toISOString() }).eq("id", 1);
  return out;
}
