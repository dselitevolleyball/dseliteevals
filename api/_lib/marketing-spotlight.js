// Coach spotlights - the "Meet the Coaches" series (Drew, 23 Oct 2026: "reach
// out to a coach and ask interview questions and get fun pictures and then
// add that to an email series ... with a quick approval or feedback loop").
//
//   1. propose  the scout (or a director) picks who's next - the line featured
//               longest ago, nobody spotlighted in the last 6 months - and
//               Claude writes 6-8 questions for that person (status draft).
//   2. send     a director approves (HQ, or the one-tap link in the digest):
//               the coach gets an email and a text with their own page
//               (/api/spotlight-form?t=<token>) - status sent. One reminder
//               after 3 days if they haven't answered (the cron).
//   3. answer   the coach answers, adds photos, says OK to share - answered.
//   4. drafts   the cron (or "Make the drafts" in HQ) has Claude turn the
//               answers into a quote post, a story and "Meet the Coaches #n"
//               email - drafts in the Approve tab (status drafted). The
//               photos join the photo library.
// Nothing is published without a director's approval, and the coach's own
// words are the only source: Claude may tidy typos, never add facts.

import Anthropic from "@anthropic-ai/sdk";
import { DSSC_DIRECTORS } from "../../shared/dssc-directors.js";
import { LINE_KEYS, LINE_LINKS, lineLabel, lineUrl, addDays, mondayOf, fmtDay } from "../../shared/marketing-plan.js";
import { AI_MODEL, aiReady, flairText, ctIso, ctToday, buildEmail } from "./marketing-ai.js";
import { sendResend, dsscFrom, inboxAddress, isEmailish, nrm, esc } from "./site-inbox.js";
import { sendOneSms, twilioReady, normalizePhone } from "./sms.js";
import { publicBase } from "./marketing-publish.js";
import { rulesText } from "../../shared/marketing-rules.js";

export const SERIES = "Meet the Coaches";
const SITE = "https://www.drippingsportsclub.com";
const RECENT_DAYS = 180;
const DIRECTOR_LINE = { "hunter@drippingsportsclub.com": "volleyball", "adrian@4thquarterathlete.com": "basketball", "brandon@drippingsportsclub.com": "reach" };
const SPORT_LINE = (s) => /volley/i.test(s) ? "volleyball" : /basket/i.test(s) ? "basketball" : /reach|perform|strength/i.test(s) ? "reach" : null;
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "Coach";
const OPEN = ["draft", "sent", "answered"];

export const formUrl = (sp) => `${publicBase()}/api/spotlight-form?t=${sp.token}`;

// ── who ──────────────────────────────────────────────────────────────────────
// Everyone who could be spotlighted: the directors, logins with a DSSC role,
// active DSSC people - with an email and, where we have one, a phone.
export async function candidates(sb) {
  const [co, pe, ro, sp] = await Promise.all([
    sb.from("coaches").select("email, display_name, dssc_role, sports, is_approved").eq("is_approved", true),
    sb.from("dssc_people").select("first_name, last_name, email, phone, role, sports, active").eq("active", true),
    sb.from("coach_roster").select("first_name, last_name, email, phone"),
    sb.from("mkt_spotlights").select("id, name, email, status, line, created_at, answered_at").order("created_at", { ascending: false }),
  ]);
  const people = new Map();
  const put = (email, row) => {
    const k = nrm(email) || "name:" + String(row.name || "").toLowerCase();
    const cur = people.get(k) || {};
    people.set(k, { ...row, ...Object.fromEntries(Object.entries(cur).filter(([, v]) => v)), email: nrm(email) || cur.email || null });
  };
  for (const d of DSSC_DIRECTORS) put(d.email, { name: d.name, role: d.role, line: DIRECTOR_LINE[d.email] || "club", director: true });
  for (const c of co.data || []) if (c.dssc_role && isEmailish(c.email)) put(c.email, { name: c.display_name || c.email.split("@")[0], role: c.dssc_role === "admin" ? "DSSC director" : "DSSC coach", line: SPORT_LINE((c.sports || []).join(" ")) || "club" });
  for (const p of pe.data || []) put(p.email, { name: [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email, role: p.role === "admin" ? "DSSC director" : "DSSC staff", line: SPORT_LINE((p.sports || []).join(" ")) || "club", phone: p.phone || null });
  const phones = new Map((ro.data || []).filter(r => r.email && r.phone).map(r => [nrm(r.email), r.phone]));
  const spots = sp.data || [];
  return [...people.values()].map(p => {
    const mine = spots.filter(s => (p.email && nrm(s.email) === p.email) || s.name.toLowerCase() === String(p.name).toLowerCase());
    const last = mine.find(s => s.status !== "cancelled") || null;
    return { ...p, phone: p.phone || phones.get(p.email) || null, last_spotlight: last ? { id: last.id, status: last.status, at: last.answered_at || last.created_at } : null };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// The next person: reachable, nobody open or featured in the last 6 months,
// from the line whose last spotlight is oldest.
export function pickNext(cands, spotlights = [], { today = ctToday() } = {}) {
  const since = addDays(today, -RECENT_DAYS);
  const lineLast = {};
  for (const s of spotlights) if (s.status !== "cancelled" && s.line) { const at = String(s.answered_at || s.created_at).slice(0, 10); if (!lineLast[s.line] || at > lineLast[s.line]) lineLast[s.line] = at; }
  const ok = cands.filter(c => (c.email || c.phone) && !(c.last_spotlight && (OPEN.includes(c.last_spotlight.status) || String(c.last_spotlight.at).slice(0, 10) >= since)));
  return ok.sort((a, b) => String(lineLast[a.line] || "").localeCompare(String(lineLast[b.line] || "")) || Number(!!b.director && b.line !== "club") - Number(!!a.director && a.line !== "club") || a.name.localeCompare(b.name))[0] || null;
}

// ── questions ────────────────────────────────────────────────────────────────
export function defaultQuestions(p) {
  const sport = p.line && !["club", "parties", "rentals", "open_gym", "camp_elevate"].includes(p.line) ? lineLabel(p.line).toLowerCase() : "sports";
  return [
    `How did you get into ${sport}, and what keeps you hooked?`,
    "What's the one thing you want every athlete to walk away from your sessions with?",
    "What's your favorite drill - and do the kids love it or love to hate it?",
    "Best moment you've had coaching at DSSC so far?",
    "Pre-game ritual, walk-up song or go-to snack?",
    "What's a fun fact about you most families don't know?",
    "One piece of advice for a kid who's nervous to try something new?",
  ];
}
export const defaultIntro = (p) => `Hi ${firstName(p.name)}! You're up next in DSSC's "${SERIES}" series - families love getting to know the people their kids train with. Answer whatever you like below (short is great), add a few fun photos, and we'll turn it into a post and an email. Nothing goes out until you've said it's OK and a director has approved it.`;

async function claudeJson(system, user, schema, { effort = "low", timeoutMs = 50000, content = null } = {}) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: timeoutMs, maxRetries: 1 });
  const msg = await client.beta.messages.create({
    model: AI_MODEL, max_tokens: 8000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort, format: { type: "json_schema", schema } },
    system, messages: [{ role: "user", content: content || user }],
  });
  if (msg.stop_reason === "refusal") throw new Error("Claude declined" + (msg.stop_details?.category ? ` (${msg.stop_details.category})` : ""));
  if (msg.stop_reason === "max_tokens") throw new Error("Claude ran out of room");
  return JSON.parse((msg.content || []).filter(b => b.type === "text").map(b => b.text).join(""));
}

const Q_SCHEMA = { type: "object", additionalProperties: false, required: ["intro", "questions"], properties: { intro: { type: "string" }, questions: { type: "array", items: { type: "string" } } } };
export async function writeQuestions(p, { flair = 1 } = {}) {
  if (!aiReady()) return { intro: defaultIntro(p), questions: defaultQuestions(p) };
  try {
    const j = await claudeJson(
      `You write interview questions for Dripping Springs Sports Club's "${SERIES}" series: a coach answers on their phone in five minutes, and the answers become a social post, a story and an email to families. Mix substance (how they coach, what athletes learn) with fun (rituals, favorite drills, a fun fact). 6 to 8 short questions, easy to answer in a sentence or two, nothing personal or sensitive, nothing about pay or politics. The intro is a short, warm note to the coach from the club (2-3 sentences) saying what this is, that short answers are great, that they can add fun photos, and that nothing goes out until they OK it and a director approves. ${flairText(flair)}`,
      `Coach: ${p.name}\nRole: ${p.role || "coach"}\nProgram line: ${lineLabel(p.line || "club")}`,
      Q_SCHEMA);
    const qs = (j.questions || []).map(q => String(q).trim()).filter(Boolean).slice(0, 8);
    return { intro: String(j.intro || "").trim() || defaultIntro(p), questions: qs.length >= 4 ? qs : defaultQuestions(p) };
  } catch { return { intro: defaultIntro(p), questions: defaultQuestions(p) }; }
}

export async function createSpotlight(sb, person, { by = "scout", flair = 1 } = {}) {
  if (!person?.name) throw new Error("Who is it? A name is needed");
  const { intro, questions } = await writeQuestions(person, { flair });
  const row = {
    name: String(person.name).slice(0, 120), email: isEmailish(person.email) ? nrm(person.email) : null, phone: normalizePhone(person.phone || "") || null,
    role: person.role ? String(person.role).slice(0, 120) : null, line: LINE_KEYS.includes(person.line) ? person.line : "club",
    intro, questions: questions.map(q => ({ q })), status: "draft", created_by: by,
  };
  const { data, error } = await sb.from("mkt_spotlights").insert(row).select("*").single();
  if (error) throw new Error("Saving the spotlight: " + error.message);
  return data;
}

// ── send / remind ────────────────────────────────────────────────────────────
function inviteEmail(sp, { reminder = false, from = "Drew" } = {}) {
  const url = formUrl(sp), first = firstName(sp.name);
  const subject = reminder ? `Quick reminder, ${first}: your "${SERIES}" questions` : `${first}, you're in DSSC's "${SERIES}" series!`;
  const lines = [
    reminder ? `Hi ${first} - just a nudge on the "${SERIES}" questions. Five minutes and a few photos is all it takes.` : `Hi ${first},`,
    reminder ? "" : sp.intro || defaultIntro(sp),
    `Answer here: ${url}`,
    "Short answers are perfect, and a few fun photos make it - you in action, you as a young athlete, your team, anything that shows your personality.",
    `Thanks!\n${from}\nDripping Springs Sports Club`,
  ].filter(Boolean);
  const html = `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#061a18;max-width:560px">
<div style="background:#104946;padding:16px 20px"><img src="${SITE}/brand/logo-light.png" alt="Dripping Springs Sports Club" width="170" style="display:block;width:170px;height:auto"></div>
<div style="padding:18px 20px;border:1px solid #d3e0de;border-top:0">
${lines.slice(0, -3).map(l => `<p style="margin:0 0 12px">${esc(l)}</p>`).join("")}
<p style="margin:18px 0"><a href="${esc(url)}" style="display:inline-block;background:#B2D049;color:#061a18;padding:12px 22px;text-decoration:none;font-weight:800">Answer the questions →</a></p>
<p style="margin:0 0 12px">Short answers are perfect, and a few fun photos make it - you in action, you as a young athlete, your team, anything that shows your personality.</p>
<p style="margin:0">Thanks!<br>${esc(from)}<br>Dripping Springs Sports Club</p></div></div>`;
  return { subject, html, text: lines.join("\n\n") };
}

// -> { spotlight, sent: { email, sms }, errors: [] }
export async function sendSpotlight(sb, sp, { via = ["email", "sms"], by = "a director", byName = "Drew", reminder = false } = {}) {
  if (!["draft", "sent"].includes(sp.status)) throw new Error(`It's ${sp.status} - nothing to send`);
  if (!(sp.questions || []).length) throw new Error("Add at least one question first");
  const sent = { email: false, sms: false }, errors = [];
  if (via.includes("email") && isEmailish(sp.email)) {
    const m = inviteEmail(sp, { reminder, from: byName });
    const r = await sendResend({ from: dsscFrom(), to: sp.email, reply_to: inboxAddress(), subject: m.subject, html: m.html, text: m.text });
    if (r.ok) sent.email = true; else errors.push("email: " + (r.error || "failed"));
  }
  if (via.includes("sms") && sp.phone) {
    if (!twilioReady("dssc")) errors.push("text: the DSSC number isn't set up");
    else {
      const body = reminder
        ? `DSSC: Hi ${firstName(sp.name)}, quick nudge on your "${SERIES}" questions - 5 min + a few photos: ${formUrl(sp)} Thanks!`
        : `DSSC: Hi ${firstName(sp.name)}! You're our next "${SERIES}" spotlight. A few fun questions + photos here (5 min): ${formUrl(sp)} Thanks! -${byName}`;
      try { await sendOneSms(sb, { to: sp.phone, name: sp.name, kind: "coach", brand: "dssc" }, body, { sent_by_label: "Marketing spotlight" }); sent.sms = true; }
      catch (e) { errors.push("text: " + e.message); }
    }
  }
  if (!sent.email && !sent.sms) throw new Error(errors.length ? errors.join(" · ") : "No email or phone to send to");
  const patch = reminder ? { reminded_at: new Date().toISOString(), error: errors.join(" · ") || null }
    : { status: "sent", sent_at: new Date().toISOString(), sent_via: Object.keys(sent).filter(k => sent[k]), approved_by: by, error: errors.join(" · ") || null };
  const { data, error } = await sb.from("mkt_spotlights").update(patch).eq("id", sp.id).select("*").single();
  if (error) throw new Error(error.message);
  return { spotlight: data, sent, errors };
}

// ── drafts from the answers ──────────────────────────────────────────────────
const D_SCHEMA = {
  type: "object", additionalProperties: false, required: ["quote", "caption", "hashtags", "story_sub", "subject", "preheader", "intro", "qa", "cta_text"],
  properties: {
    quote: { type: "string" }, caption: { type: "string" }, hashtags: { type: "array", items: { type: "string" } }, story_sub: { type: "string" },
    subject: { type: "string" }, preheader: { type: "string" }, intro: { type: "string" }, cta_text: { type: "string" },
    qa: { type: "array", items: { type: "object", additionalProperties: false, required: ["q", "a"], properties: { q: { type: "string" }, a: { type: "string" } } } },
  },
};
const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(w => w.length > 2);
// A quote must be the coach's own words: most of its words appear in an answer.
const isTheirs = (quote, answers) => { const w = words(quote); const all = new Set(words(answers.join(" "))); return w.length >= 3 && w.filter(x => all.has(x)).length / w.length >= 0.85; };
const sentences = (t) => String(t || "").split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length >= 20 && s.length <= 170);

export function templateSpotlightCopy(sp, qa, ep) {
  const first = firstName(sp.name);
  const best = qa.flatMap(x => sentences(x.a)).sort((a, b) => b.length - a.length)[0] || qa[0]?.a?.slice(0, 160) || `Come train with Coach ${first} at DSSC.`;
  return {
    quote: best, caption: `Meet Coach ${first}${sp.role ? `, ${sp.role}` : ""}. "${best}" Get to know the people your athletes train with - more in this week's email.`,
    hashtags: ["DrippingSprings", "DSSC", "MeetTheCoaches"], story_sub: sp.role || `${lineLabel(sp.line)} at DSSC`,
    subject: `${SERIES} #${ep}: Coach ${first}`, preheader: best.slice(0, 85), intro: `Every few weeks we introduce one of the people your athletes train with. This time: Coach ${first}${sp.role ? `, ${sp.role}` : ""}.`,
    qa, cta_text: LINE_LINKS[sp.line]?.cta || "See what's coming up",
  };
}

async function writeSpotlightCopy(sp, qa, ep, settings) {
  const fallback = templateSpotlightCopy(sp, qa, ep);
  if (!aiReady()) return { copy: fallback, ai: false };
  try {
    const j = await claudeJson(
      `You turn a coach's interview answers into Dripping Springs Sports Club's "${SERIES}" pieces: a quote card post, a story and an email to families. The coach's answers are the ONLY facts: you may fix typos and trim, never add a fact, a credential, an achievement or a claim. No prices, no "spots left", never mention "the Flex". Talk to families, warm and local; "Where Dripping Springs plays."
- quote: one sentence the coach actually wrote (verbatim or lightly trimmed), under 160 characters - the most vivid, human line.
- caption: the social caption, 2-4 short sentences introducing the coach and pointing to the email; no URL, no hashtags inside it.
- hashtags: 3-5 without the # (include DrippingSprings and MeetTheCoaches).
- story_sub: a short line for the story graphic (under 50 characters).
- subject: "${SERIES} #${ep}: Coach <first name>" plus, optionally, a short hook; at most one emoji.
- preheader: under 90 characters.
- intro: 2-3 sentences opening the email.
- qa: the questions and the coach's answers (lightly edited), best first; drop a question they skipped; at least 3.
- cta_text: button words, 2-5 words, about their program line.
${flairText(settings?.flair)}${settings?.voice ? `\nDirectors' voice notes: ${String(settings.voice).slice(0, 1500)}` : ""}${rulesText(settings?.rules) ? `\n${rulesText(settings.rules)}` : ""}`,
      JSON.stringify({ coach: sp.name, role: sp.role, line: lineLabel(sp.line), episode: ep, answers: qa, photo_captions: (sp.photos || []).map(p => p.caption).filter(Boolean) }, null, 1),
      D_SCHEMA, { effort: "medium", timeoutMs: 80000 });
    const copy = { ...fallback, ...j };
    if (!isTheirs(copy.quote, qa.map(x => x.a))) copy.quote = fallback.quote;
    copy.qa = (j.qa || []).filter(x => x.q && x.a).length >= 3 ? j.qa.filter(x => x.q && x.a).slice(0, 8) : qa;
    if (/\$\s?\d|spots?\s+left|\bflex\b/i.test([copy.caption, copy.intro, copy.subject].join(" "))) return { copy: fallback, ai: false };
    copy.hashtags = [...new Set((copy.hashtags || []).map(h => String(h).replace(/[^A-Za-z0-9_]/g, "")).filter(Boolean))].slice(0, 6);
    return { copy, ai: true };
  } catch (e) { return { copy: fallback, ai: false, error: e.message }; }
}

// The next date on or after `from` that falls on weekday `dow` (mon..sun).
const nextDow = (from, dow) => { const want = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(dow); for (let i = 0; i < 7; i++) { const d = addDays(from, i); if ((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7 === want) return d; } return from; };

// -> { items, spotlight, ai }
export async function draftSpotlight(sb, sp, { settings = {}, today = ctToday(), by = "auto" } = {}) {
  if (!["answered", "drafted"].includes(sp.status)) throw new Error(`It's ${sp.status} - there are no answers yet`);
  const qa = (sp.questions || []).filter(x => String(x.a || "").trim()).map(x => ({ q: String(x.q), a: String(x.a).trim() }));
  if (!qa.length) throw new Error("The coach didn't answer any questions");
  const { count } = await sb.from("mkt_spotlights").select("id", { count: "exact", head: true }).eq("series", sp.series || SERIES).eq("status", "drafted");
  const ep = sp.episode || (count || 0) + 1;
  const { copy, ai, error: aiErr } = await writeSpotlightCopy(sp, qa, ep, settings);
  const first = firstName(sp.name).toUpperCase();
  const photos = (sp.photos || []).filter(p => p.url);
  const cad = settings.cadence || {};
  const sTime = cad.social?.time || "18:30", eTime = cad.email?.time || "07:30";
  const postDay = addDays(today, 2), storyDay = addDays(today, 3), emailDay = nextDow(addDays(today, 3), cad.email?.dedicated_day || "fri");
  const ctaUrl = lineUrl(sp.line || "club");
  const tag = SERIES.toUpperCase();
  const base = { channel: "social", kind: "spotlight", theme: `${SERIES} #${ep}`, line: sp.line || "club", program: null, programs: [], angle: "spotlight", status: "draft",
    reason: `${SERIES} #${ep}: Coach ${firstName(sp.name)} answered the interview${sp.answered_at ? ` (${fmtDay(String(sp.answered_at).slice(0, 10))})` : ""}`,
    cta_text: copy.cta_text, cta_url: ctaUrl, audience: null, created_by: by, email_subject: null, email_preheader: null, email_html: null, email_blocks: [] };
  const post = { ...base, week_of: mondayOf(postDay), platforms: ["facebook", "instagram"], scheduled_at: ctIso(postDay, sTime), headline: `COACH ${first}`, body: copy.caption, hashtags: copy.hashtags,
    graphic: { template: "quote", format: "post", photo_url: photos[0]?.url || null, headline: `COACH ${first}`, accent: first, sub: sp.role || lineLabel(sp.line), tag, quote: copy.quote, date_label: "", items: [] } };
  const story = { ...base, week_of: mondayOf(storyDay), platforms: ["instagram_story", "facebook_story"], scheduled_at: ctIso(storyDay, sTime), headline: `MEET COACH ${first}`, body: copy.caption, hashtags: copy.hashtags,
    graphic: { template: "photo", format: "story", photo_url: (photos[1] || photos[0])?.url || null, headline: `MEET COACH ${first}`, accent: first, sub: copy.story_sub, tag, date_label: "", items: [] } };
  const email = { ...base, channel: "email", week_of: mondayOf(emailDay), platforms: [], scheduled_at: ctIso(emailDay, eTime), headline: `MEET COACH ${first}`, body: copy.intro, hashtags: [],
    graphic: { template: "quote", format: "email", photo_url: photos[0]?.url || null, headline: `COACH ${first}`, accent: first, sub: sp.role || lineLabel(sp.line), tag, quote: copy.quote, date_label: "", items: [] },
    email_subject: copy.subject, email_preheader: copy.preheader,
    email_blocks: copy.qa.map(x => ({ program_id: null, title: x.q, label: "", date_label: "", blurb: x.a, url: null, cta: null })),
    audience: settings.email_audience && typeof settings.email_audience === "object" ? settings.email_audience : { source: "dssc_contacts" } };
  email.email_html = buildEmail(email).html;
  const { data: items, error } = await sb.from("mkt_items").insert([post, story, email]).select("*");
  if (error) throw new Error("Saving the spotlight drafts: " + error.message);
  const { data: spot } = await sb.from("mkt_spotlights").update({ status: "drafted", episode: ep, item_ids: (items || []).map(i => i.id), error: aiErr ? `AI: ${aiErr} - template copy used` : null }).eq("id", sp.id).select("*").single();
  return { items: items || [], spotlight: spot || sp, ai };
}

// The coach's photos join the library (they said OK to share; any kids in
// them still get the release check once the AI librarian has looked).
export async function addSpotlightPhotos(sb, sp, photos) {
  const rows = (photos || []).filter(p => p.url).map(p => ({
    url: p.url, source: "spotlight", key: p.path || null, filename: p.name || null, tags: ["coach", "people", ...(sp.line && sp.line !== "club" ? [sp.line === "camp_elevate" ? "camp" : sp.line] : [])],
    line: sp.line || null, alt: p.caption || `Coach ${sp.name}`, width: p.w || null, height: p.h || null, active: true,
  }));
  if (!rows.length) return 0;
  const { error } = await sb.from("mkt_photos").upsert(rows, { onConflict: "url", ignoreDuplicates: true });
  return error ? 0 : rows.length;
}
