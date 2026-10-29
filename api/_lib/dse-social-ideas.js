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

// ── idea -> draft post ──────────────────────────────────────────────────────
// The card's photo: the coach's staff photo for a birthday; otherwise one the
// club has already posted (that team's first for a tournament). photo_index
// steps through the pool ("Try another photo").
async function cardPhoto(sb, idea, design) {
  if (idea.kind === "birthday") { const url = design.photo || await staffPhoto(sb, idea.data?.coach); return url ? { url, focus: { x: 0.5, y: 0.3 } } : null; }
  if (design.style === "text") return null;
  const pool = await postedPhotos(sb, idea.data?.teams || []);
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
  const design = { ...(idea.card || {}), idea_id: idea.id, photo_index: 0 };
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
  if (notify) await notifyApprovers(sb, post, s).catch(e => console.error("dse ideas slack", e.message));
  return { post };
}
// Redraw an idea post after its words changed in HQ, or "Try another photo".
export async function rerenderIdea(sb, post) {
  const d = post.design || {};
  const { data: idea } = await sb.from("dse_social_ideas").select("*").eq("id", Number(d.idea_id)).maybeSingle();
  const r = await renderIdea(sb, idea || { id: d.idea_id || "x", kind: d.idea_kind, data: {} }, d);
  return { asset_url: r.asset_url, photos: r.photo ? [{ url: r.photo }] : [] };
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
