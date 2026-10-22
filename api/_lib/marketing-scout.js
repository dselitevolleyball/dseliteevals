// The Marketing Machine's idea scout (Drew, 23 Oct 2026: "recommend posts
// based on your own logic, time of year, holidays, news worthy items and add
// some flare"). Once a week (settings.scout.day, by the cron) or when a
// director asks in HQ, it suggests 5-7 posts the weekly rhythm wouldn't make
// on its own, each with a pitch, a hook (the flair) and a best day. A director
// makes one into a draft with a tap, or turns it down with a reason - and the
// reasons go back into the next run, so it learns what the club likes.
//
// What it reads:
//   shared/marketing-seasons.js   holidays, school breaks, seasons, "days" in the next 5 weeks
//   local scan (web search)       what's on in Dripping Springs / Hays County, the ISD calendar,
//                                 local teams' big moments - only what search actually found
//   the club                      programs starting / new / just started, priorities, the last
//                                 4 weeks of posts (so it doesn't repeat them), spotlights
//   the directors                 ideas accepted and turned down (with the reasons)
// It also keeps the "Meet the Coaches" series going: every
// scout.spotlight_every_weeks weeks it lines up the next coach (status draft,
// questions written) as a spotlight idea - one tap sends the interview.
//
// Claude: Opus 5.5, server-side fallbacks. The local scan is a web-search
// turn (pause_turn resumed); the ideas are a separate structured-output turn,
// so citations from search never mix with the JSON. Without ANTHROPIC_API_KEY
// the scout still suggests the season's moments from the calendar.

import Anthropic from "@anthropic-ai/sdk";
import { moments } from "../../shared/marketing-seasons.js";
import { LINE_KEYS, lineLabel, signalsFor, addDays, fmtDay, daysBetween } from "../../shared/marketing-plan.js";
import { AI_MODEL, aiReady, flairText, ctToday } from "./marketing-ai.js";
import { fetchPrograms, loadSettings, loadPriorities, log, generateWeek, HQ_MARKETING_URL } from "./marketing-core.js";
import { candidates, pickNext, createSpotlight, SERIES } from "./marketing-spotlight.js";
import { actUrl } from "./marketing-links.js";
import { sendResend, dsscFrom, isEmailish, esc } from "./site-inbox.js";

export const IDEA_KINDS = ["season", "holiday", "local", "club", "program", "spotlight", "fun"];
export const KIND_LABEL = { season: "Season", holiday: "Holiday", local: "Local news", club: "Club news", program: "Program", spotlight: "Coach spotlight", fun: "Just for fun" };
const WINDOW = 35;
export const SCOUT_DEFAULTS = { enabled: true, day: "sat", web: true, spotlight_every_weeks: 2, via: ["email", "sms"] };
export const scoutSettings = (s) => ({ ...SCOUT_DEFAULTS, ...(s?.scout && typeof s.scout === "object" ? s.scout : {}) });

const client = (timeoutMs) => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: timeoutMs, maxRetries: 1 });

// ── 1. what's going on locally (web search) ──────────────────────────────────
// -> { text, sources: [{ title, url }], error }
export async function localScan(today, { timeoutMs = 60000 } = {}) {
  const prompt = `Today is ${fmtDay(today)} (${today}). Search the web for things in the next five weeks that Dripping Springs Sports Club - a youth and adult sports club in Dripping Springs, Texas (volleyball, basketball, speed & strength training, camps, birthday parties) - could tie a friendly social post or email to:
- community events in Dripping Springs and Hays County (festivals, parades, holiday events, markets, fun runs)
- the Dripping Springs ISD calendar (holidays, breaks, early-release days, first/last days)
- big moments for local school teams (Dripping Springs High School playoff runs, championships, signings) and local sports news
Then list up to 10 items, one per line: the date (or "ongoing"), what it is, and why families would care - each with its source URL. Only list things the search results actually show; skip anything you would have to guess, and skip politics, crime and tragedies.`;
  const messages = [{ role: "user", content: prompt }];
  const sources = new Map();
  let msg = null;
  try {
    for (let turn = 0; turn < 4; turn++) {
      msg = await client(timeoutMs).beta.messages.create({
        model: AI_MODEL, max_tokens: 8000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        output_config: { effort: "low" },
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6, user_location: { type: "approximate", city: "Dripping Springs", region: "Texas", country: "US", timezone: "America/Chicago" } }],
        messages,
      });
      for (const b of msg.content || []) if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r?.url) sources.set(r.url, { title: String(r.title || r.url).slice(0, 160), url: r.url });
      if (msg.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: msg.content });   // the server resumes the paused search
    }
    if (msg.stop_reason === "refusal") return { text: "", sources: [], error: "Claude declined the local search" };
    const text = (msg.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    return { text: text.slice(0, 6000), sources: [...sources.values()].slice(0, 30), error: null };
  } catch (e) {
    return { text: "", sources: [], error: e?.message || String(e) };
  }
}

// ── 2. the ideas ─────────────────────────────────────────────────────────────
const IDEA = {
  type: "object", additionalProperties: false,
  required: ["kind", "title", "pitch", "hook", "line", "channel", "format", "best_day", "source_urls"],
  properties: {
    kind: { type: "string", enum: IDEA_KINDS.filter(k => k !== "spotlight") },
    title: { type: "string" }, pitch: { type: "string" }, hook: { type: "string" },
    line: { type: "string", enum: LINE_KEYS },
    channel: { type: "string", enum: ["social", "email"] },
    format: { type: "string", enum: ["post", "story", "email"] },
    best_day: { type: "string" },
    source_urls: { type: "array", items: { type: "string" } },
  },
};
const SCHEMA = { type: "object", additionalProperties: false, required: ["ideas"], properties: { ideas: { type: "array", items: IDEA } } };

const SYSTEM = `You are the idea scout for Dripping Springs Sports Club (DSSC), a youth and adult sports club in Dripping Springs, Texas: volleyball, basketball ("4th Quarter Athlete at DSSC"), Reach Performance (speed, strength and athletic development), Camp Elevate (a full-day camp when school is out), birthday parties run by party hosts, court rentals and open gym, all at "the Warehouse". Tagline: "Where Dripping Springs plays."

The club's marketing machine already posts on a weekly rhythm - a basketball post Monday, a Reach / parties / camp post Wednesday, a volleyball post Thursday, follow-up stories, a weekly email - promoting whatever programs are starting. Your job is to suggest what that rhythm would NOT make on its own: timely tie-ins (holidays, school breaks, the season), local happenings, club news and milestones, behind-the-scenes and pure fun. Each idea should make a family in Dripping Springs smile, feel part of the club, or act.

Rules:
- Use only facts from the request (the calendar, the local scan, the programs, the club's own records). Never invent an event, a date, a result, a name, a price or "spots left". Local items must come from the local scan, with its source URL.
- Holidays of remembrance (Memorial Day, Veterans Day) are respectful, never salesy. No politics, religion beyond a simple holiday greeting, crime or tragedy.
- Never mention "the Flex".
- Don't repeat what was posted in the last four weeks, and respect the directors' feedback on past ideas (what they made and what they turned down, and why).
- Spread the ideas across the next five weeks and across the lines; best_day is a date (YYYY-MM-DD) within the window that gives the idea the right lead time (a holiday-break camp idea goes up 1-3 weeks before the break).
- pitch: 1-2 sentences - what to post and why now. hook: the flair - the opening line or format to try (a POV, a this-or-that, a countdown, a challenge, a "tag someone who...", a question to the audience). title: 3-8 words.
- channel/format: social + post or story, or email + email (only for something worth its own email).
Return 5 to 7 ideas.`;

// -> { ideas: [...validated], error }
export async function proposeIdeas(ctx, { timeoutMs = 70000 } = {}) {
  const { today, settings } = ctx;
  const req = {
    today, window_end: addDays(today, WINDOW),
    calendar: ctx.calendar.map(m => ({ name: m.name, kind: m.kind, start: m.start, end: m.end, approx: m.approx || undefined, lines: m.lines, idea: m.idea })),
    local_scan: ctx.local?.text || null,
    local_sources: (ctx.local?.sources || []).map(s => s.url),
    programs: ctx.signals.slice(0, 18).map(s => ({ line: s.line, name: s.program.name, starts: s.program.first_date, angle: s.angle, why: s.reason })),
    priorities: ctx.priorities.map(p => ({ title: p.title, notes: p.notes || "", lines: p.lines, from: p.starts_on, to: p.ends_on })),
    recent_posts: ctx.recent.map(i => ({ day: String(i.scheduled_at || i.week_of).slice(0, 10), kind: i.kind, line: i.line, headline: i.headline })),
    past_ideas: ctx.past.map(i => ({ title: i.title, status: i.status, feedback: i.feedback || undefined })),
    director_ask: ctx.ask || null,
  };
  const msg = await client(timeoutMs).beta.messages.create({
    model: AI_MODEL, max_tokens: 16000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    system: [{ type: "text", text: SYSTEM }, { type: "text", text: `${flairText(settings.flair)}${settings.voice ? `\nDirectors' voice notes: ${String(settings.voice).slice(0, 1500)}` : ""}`, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: (ctx.ask ? `A director asked: "${ctx.ask}" - make the ideas answer that first.\n\n` : "") + "Suggest the ideas. Request (JSON):\n" + JSON.stringify(req, null, 1) }],
  });
  if (msg.stop_reason === "refusal") return { ideas: [], error: "Claude declined" };
  if (msg.stop_reason === "max_tokens") return { ideas: [], error: "Claude ran out of room" };
  let j; try { j = JSON.parse((msg.content || []).filter(b => b.type === "text").map(b => b.text).join("")); } catch { return { ideas: [], error: "Couldn't read Claude's ideas" }; }
  return { ideas: cleanIdeas(j.ideas, ctx), error: null };
}

const BANNED = /\$\s?\d|\bspots?\s+(left|remaining)\b|\bsold\s+out\b|\bflex\b/i;
export function cleanIdeas(list, { today, local }) {
  const known = new Set((local?.sources || []).map(s => s.url));
  const end = addDays(today, WINDOW);
  return (Array.isArray(list) ? list : []).map(x => {
    const kind = IDEA_KINDS.includes(x?.kind) ? x.kind : "fun";
    const channel = x?.channel === "email" ? "email" : "social";
    let day = /^\d{4}-\d{2}-\d{2}$/.test(String(x?.best_day || "")) ? x.best_day : null;
    if (!day || day < today) day = addDays(today, 2);
    if (day > end) day = end;
    const sources = (Array.isArray(x?.source_urls) ? x.source_urls : []).filter(u => known.has(u)).slice(0, 3).map(url => ({ url, title: (local.sources.find(s => s.url === url) || {}).title || url }));
    return {
      kind, title: String(x?.title || "").trim().slice(0, 120), pitch: String(x?.pitch || "").trim().slice(0, 600), hook: String(x?.hook || "").trim().slice(0, 300) || null,
      line: LINE_KEYS.includes(x?.line) ? x.line : "club", channel, format: channel === "email" ? "email" : x?.format === "story" ? "story" : "post", best_day: day, sources,
    };
  }).filter(x => x.title && x.pitch && !BANNED.test(`${x.title} ${x.pitch} ${x.hook || ""}`) && (x.kind !== "local" || x.sources.length)).slice(0, 8);
}

// Without Claude: the calendar's moments as ideas.
export function calendarIdeas(calendar, today) {
  return calendar.filter(m => m.kind !== "season" || m.start >= today).slice(0, 6).map(m => ({
    kind: m.kind === "holiday" || m.kind === "day" ? "holiday" : m.kind === "fun" ? "fun" : "season",
    title: m.name, pitch: m.idea, hook: null, line: m.lines[0] || "club", channel: "social", format: "post",
    best_day: leadDay(m, today), sources: [],
  }));
}
// A school break gets ~10 days' notice, anything else the day before; never in the past.
function leadDay(m, today) {
  const d = addDays(m.start, m.kind === "school" ? -10 : -1);
  return d > today ? d : addDays(today, 1);
}

// ── 3. the run ───────────────────────────────────────────────────────────────
// -> { ideas: [rows], spotlight: row|null, local: { found, error }, error }
export async function runScout(sb, { now = new Date(), by = "scout", ask = "", web = null, deadline = Date.now() + 110000 } = {}) {
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const settings = await loadSettings(sb);
  const sc = scoutSettings(settings);
  const useWeb = web == null ? sc.web !== false : !!web;
  const [feed, priorities, recentQ, pastQ, spotsQ] = await Promise.all([
    fetchPrograms().catch(() => ({ programs: [] })), loadPriorities(sb),
    sb.from("mkt_items").select("week_of, channel, kind, line, headline, scheduled_at, status").gte("week_of", addDays(today, -28)).neq("status", "rejected").order("scheduled_at").limit(80),
    sb.from("mkt_ideas").select("title, status, feedback, created_at").gte("created_at", addDays(today, -90)).neq("status", "new").order("created_at", { ascending: false }).limit(40),
    sb.from("mkt_spotlights").select("id, name, status, line, created_at, answered_at").order("created_at", { ascending: false }).limit(50),
  ]);
  const ctx = {
    today, settings, ask: String(ask || "").trim().slice(0, 500),
    calendar: moments(today, WINDOW), signals: signalsFor(feed.programs || [], today),
    priorities: priorities.filter(p => p.active !== false && (!p.ends_on || p.ends_on >= today)),
    recent: recentQ.data || [], past: pastQ.data || [], local: null,
  };
  let ideas = [], error = null;
  if (aiReady()) {
    if (useWeb && Date.now() < deadline - 80000) ctx.local = await localScan(today, { timeoutMs: Math.min(55000, deadline - Date.now() - 70000) });
    try {
      const r = await proposeIdeas(ctx, { timeoutMs: Math.max(20000, Math.min(70000, deadline - Date.now() - 8000)) });
      ideas = r.ideas; error = r.error;
    } catch (e) { error = e?.message || String(e); }
  } else error = "ANTHROPIC_API_KEY is not set - ideas from the season calendar only";
  if (!ideas.length) ideas = calendarIdeas(ctx.calendar, today);

  // Keep the "Meet the Coaches" series going.
  let spotlight = null;
  if (!ask && sc.spotlight_every_weeks > 0) {
    const spots = spotsQ.data || [];
    const open = spots.find(s => ["draft", "sent", "answered"].includes(s.status));
    const last = spots.find(s => s.status !== "cancelled");
    if (!open && (!last || daysBetween(String(last.created_at).slice(0, 10), today) >= sc.spotlight_every_weeks * 7)) {
      try {
        const next = pickNext(await candidates(sb), spots, { today });
        if (next) spotlight = await createSpotlight(sb, next, { by, flair: settings.flair });
      } catch (e) { error = [error, "spotlight: " + e.message].filter(Boolean).join(" · "); }
    }
  }

  // Old suggestions nobody acted on lapse; this run's go in.
  await sb.from("mkt_ideas").update({ status: "expired" }).eq("status", "new").lt("best_day", today);
  const batch = ask ? `ask:${now.toISOString()}` : today;
  // Same columns on every row: a batch insert NULLs a key a row lacks.
  const rows = ideas.map(i => ({ ...i, hook: i.hook || null, batch, status: "new", created_by: by, spotlight_id: null }));
  if (spotlight) rows.unshift({
    batch, kind: "spotlight", title: `${SERIES}: ${spotlight.name}`, line: spotlight.line, channel: "email", format: "email", best_day: addDays(today, 7), sources: [], status: "new", created_by: by, spotlight_id: spotlight.id,
    pitch: `Interview ${spotlight.name}${spotlight.role ? ` (${spotlight.role})` : ""} for the next "${SERIES}" - ${spotlight.questions.length} fun questions and a few photos by ${[spotlight.email ? "email" : null, spotlight.phone ? "text" : null].filter(Boolean).join(" and ") || "a link you share"}. Their answers become a quote post, a story and an email.`,
    hook: spotlight.questions[0]?.q || null,
  });
  const { data: saved, error: insErr } = rows.length ? await sb.from("mkt_ideas").insert(rows).select("*") : { data: [] };
  if (insErr) throw new Error("Saving ideas: " + insErr.message);
  await log(sb, null, ask ? "scout_ask" : "scout", { by, today, ideas: (saved || []).length, spotlight: spotlight?.id || null, local: ctx.local ? { found: ctx.local.sources.length, error: ctx.local.error } : null, error, ask: ctx.ask || null });
  return { ideas: saved || [], spotlight, local: ctx.local ? { found: ctx.local.sources.length, error: ctx.local.error } : null, error };
}

// ── 4. the digest - one tap from the inbox ───────────────────────────────────
export async function sendIdeasDigest(sb, settings, ideas, spotlight) {
  const to = (settings.notify_emails || []).filter(isEmailish);
  if (!to.length || !ideas.length) return { ok: false, error: "nobody to tell" };
  const hq = HQ_MARKETING_URL() + "&mtab=ideas";
  const btn = (href, label, bg = "#B2D049") => `<a href="${esc(href)}" style="display:inline-block;background:${bg};color:#061a18;padding:8px 14px;text-decoration:none;font-weight:700;font-size:13px">${esc(label)}</a>`;
  const card = (i) => `<tr><td style="padding:12px 0;border-top:1px solid #d3e0de">
<div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#0F8B76">${esc(KIND_LABEL[i.kind] || i.kind)} · ${esc(lineLabel(i.line))} · ${esc(fmtDay(i.best_day))}</div>
<div style="font-size:17px;font-weight:700;margin:2px 0 4px">${esc(i.title)}</div>
<div style="margin:0 0 4px">${esc(i.pitch)}</div>
${i.hook ? `<div style="color:#104946;margin:0 0 8px"><i>Try: ${esc(i.hook)}</i></div>` : ""}
${i.kind === "spotlight" && i.spotlight_id ? btn(actUrl("spot_send", i.spotlight_id), "Send the interview") : btn(actUrl("idea", i.id), "Make this post")}
</td></tr>`;
  const list = [...ideas].sort((a, b) => (a.kind === "spotlight" ? -1 : 0) - (b.kind === "spotlight" ? -1 : 0) || String(a.best_day).localeCompare(String(b.best_day)));
  const subject = `${ideas.length} marketing ideas for the next few weeks${spotlight ? ` + a coach spotlight (${spotlight.name})` : ""}`;
  const html = `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#061a18;max-width:620px">
<p style="margin:0 0 6px"><b>The idea scout has ${ideas.length} suggestion${ideas.length === 1 ? "" : "s"}</b> - holidays, the season, what's on around town and the club's own news. Tap one to make it a draft (you still approve the post), or open HQ to turn any down and say why.</p>
<table style="border-collapse:collapse;width:100%">${list.map(card).join("")}</table>
<p style="margin:16px 0">${btn(hq, "See them all in HQ →")}</p></div>`;
  const text = `${ideas.length} marketing ideas:\n\n${list.map(i => `${KIND_LABEL[i.kind] || i.kind} · ${fmtDay(i.best_day)} - ${i.title}\n${i.pitch}${i.hook ? `\nTry: ${i.hook}` : ""}\n${i.kind === "spotlight" && i.spotlight_id ? "Send the interview: " + actUrl("spot_send", i.spotlight_id) : "Make this post: " + actUrl("idea", i.id)}`).join("\n\n")}\n\nAll ideas: ${hq}`;
  const r = await sendResend({ from: dsscFrom(), to, subject, html, text });
  await log(sb, null, "scout_digest", { to, ok: r.ok, error: r.error || null, ideas: ideas.length });
  return r;
}

// ── 5. a director's answer ───────────────────────────────────────────────────
// Make an idea into a draft (one item, on its best day) -> { idea, item }.
export async function acceptIdea(sb, id, { by = "a director", instruction = "", now = new Date() } = {}) {
  const { data: idea, error } = await sb.from("mkt_ideas").select("*").eq("id", Number(id)).maybeSingle();
  if (error) throw new Error(error.message);
  if (!idea) throw Object.assign(new Error("That idea no longer exists"), { status: 404 });
  if (idea.kind === "spotlight") throw Object.assign(new Error("Send the interview from the spotlight instead"), { status: 409 });
  if (idea.status === "accepted" && idea.item_id) {
    const { data: item } = await sb.from("mkt_items").select("*").eq("id", idea.item_id).maybeSingle();
    return { idea, item, already: true };
  }
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const day = idea.best_day && String(idea.best_day) >= today ? String(idea.best_day).slice(0, 10) : addDays(today, 1);
  const r = await generateWeek(sb, {
    weekOf: mondayOfDay(day), by,
    single: { line: idea.line, channel: idea.channel, format: idea.format, day, theme: idea.hook ? `${idea.title} - try: ${idea.hook}` : idea.title, reason: `Idea (${KIND_LABEL[idea.kind] || idea.kind}): ${idea.title}` },
    instruction: [`Idea: ${idea.title}. ${idea.pitch}`, idea.hook ? `Hook / format to try: ${idea.hook}` : null, (idea.sources || []).length ? `Source: ${idea.sources.map(s => s.title).join("; ")}` : null, String(instruction || "").trim() || null].filter(Boolean).join("\n"),
  });
  const item = r.items[0] || null;
  if (!item) throw new Error("No draft came back - try again");
  const { data: saved } = await sb.from("mkt_ideas").update({ status: "accepted", item_id: item.id, decided_by: by, decided_at: new Date().toISOString(), feedback: String(instruction || "").trim() || null }).eq("id", idea.id).select("*").single();
  await log(sb, item.id, "idea_accept", { idea: idea.id, by });
  return { idea: saved || idea, item };
}
const mondayOfDay = (d) => { const x = new Date(d + "T12:00:00Z"); return addDays(d, -((x.getUTCDay() + 6) % 7)); };

export async function dismissIdea(sb, id, { by = "a director", feedback = "" } = {}) {
  const { data, error } = await sb.from("mkt_ideas").update({ status: "dismissed", feedback: String(feedback || "").trim().slice(0, 500) || null, decided_by: by, decided_at: new Date().toISOString() }).eq("id", Number(id)).eq("status", "new").select("*").single();
  if (error || !data) throw Object.assign(new Error("That idea isn't open any more"), { status: 409 });
  return data;
}

// "Coach X answered - 3 drafts ready" to the directors.
export async function sendSpotlightReady(sb, settings, sp, items) {
  const to = (settings.notify_emails || []).filter(isEmailish);
  if (!to.length || !items.length) return { ok: false };
  const first = items.slice().sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)))[0];
  const link = HQ_MARKETING_URL(first.week_of);
  const html = `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#061a18;max-width:600px">
<p style="margin:0 0 10px"><b>${esc(sp.name)} answered the "${esc(sp.series || SERIES)}" interview</b>${(sp.photos || []).length ? ` and sent ${sp.photos.length} photo${sp.photos.length === 1 ? "" : "s"}` : ""}. The machine drafted a quote post, a story and the email - they're waiting for your approval.</p>
<p style="margin:16px 0"><a href="${esc(link)}" style="display:inline-block;background:#B2D049;color:#061a18;padding:11px 20px;text-decoration:none;font-weight:700">Review in HQ →</a></p></div>`;
  return sendResend({ from: dsscFrom(), to, subject: `${sp.name} answered - ${items.length} spotlight drafts ready`, html, text: `${sp.name} answered the "${sp.series || SERIES}" interview. ${items.length} drafts are waiting for your approval: ${link}` });
}
