// The Marketing Machine's copy desk: turns planned slots (shared/marketing-plan.js)
// into mkt_items rows - headline, caption / email / text, call to action,
// hashtags, a graphic spec for the HQ renderer and a photo from the library.
//
// Claude writes the copy for a whole week in one call (structured JSON, one
// object per slot). Facts come only from the programs feed and the
// director's priorities; links never come from the model - every call to
// action is the program's own register URL or the line's page from
// LINE_LINKS. When ANTHROPIC_API_KEY is missing, the call fails, Claude
// declines (stop_reason "refusal") or runs out of room ("max_tokens"), or a
// draft breaks a rule (a price, "spots left", the Flex), that slot gets the
// deterministic template copy instead - a week always comes back complete.
//
// Model: Claude Opus 5.5 with server-side fallbacks ("default"), effort
// medium, adaptive thinking (the default). No temperature / top_p: this
// model rejects them. The system prompt is byte-stable (no dates) and cached;
// the week, programs and priorities go in the user message.

import Anthropic from "@anthropic-ai/sdk";
import { LINES, LINE_LINKS, lineLabel, lineOf, lineUrl, programRef, addDays, daysBetween, fmtDay, KIND_LABEL } from "../../shared/marketing-plan.js";
import { EMPTY_FILTERS, asciiize } from "../../shared/campaign-audience.js";
import { orientationOf } from "../../shared/marketing-photos.js";
import { rulesText, rulesBroken, guessApart } from "../../shared/marketing-rules.js";

export const AI_MODEL = "claude-opus-5-5";
export const aiReady = () => !!process.env.ANTHROPIC_API_KEY;

const SITE = "https://www.drippingsportsclub.com";
export const CLUB_ADDRESS = "Dripping Springs Sports Club · The Warehouse · 15113 Fitzhugh Rd, Suite 1400, Dripping Springs, TX";
export const PHOTO_TAGS = ["volleyball", "basketball", "reach", "kids", "camp", "parties", "facility", "people", "flagship", "community"];
const LINE_TAGS = {
  volleyball: ["volleyball"], basketball: ["basketball"], reach: ["reach"], camp_elevate: ["camp", "kids"],
  parties: ["parties", "kids"], rentals: ["facility"], open_gym: ["facility", "people"], club: ["flagship", "community"],
};
const HASHTAGS = {
  volleyball: ["DrippingSpringsVolleyball"], basketball: ["4thQuarterAthlete"], reach: ["ReachPerformance"], camp_elevate: ["CampElevate"],
  parties: ["BirthdayParty"], rentals: ["CourtRental"], open_gym: ["OpenGym"], club: ["WhereDrippingSpringsPlays"],
};
// What each line is, in words we can stand behind (no prices, no claims).
const LINE_BLURB = {
  volleyball: "Volleyball programs for every age at DSSC - clinics, pods and classes at the Warehouse.",
  basketball: "4th Quarter Athlete at DSSC - basketball skill labs, shooting labs and clinics.",
  reach: "Reach Performance - speed, strength and athletic development training at DSSC.",
  camp_elevate: "Camp Elevate - a full day of sports and games at DSSC when school's out.",
  parties: "Birthday parties at DSSC. Our party hosts run the fun so you can enjoy the day. See open dates and book online.",
  rentals: "Need a court? Rent a court at the Warehouse for your team, practice or pickup game. See open times and book online.",
  open_gym: "Open gym at the Warehouse - see this week's times on our site.",
  club: "Where Dripping Springs plays: volleyball, basketball, Reach Performance, camps and birthday parties at DSSC.",
};

// ── small helpers ────────────────────────────────────────────────────────────
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOWL = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const md = (s) => { const d = new Date(String(s).slice(0, 10) + "T00:00:00Z"); return isNaN(d) ? "" : `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
export const dateRange = (a, b) => {
  if (!a) return ""; if (!b || b === a) return md(a);
  const [ma, da] = md(a).split(" "), [mb, db] = md(b).split(" ");
  return ma === mb ? `${ma} ${da}–${db}` : `${md(a)}–${md(b)}`;
};
export const shortName = (name) => String(name || "")
  .replace(/\s*(w\/|with)\s+coach\b.*$/i, "").replace(/\s*\|\s*/g, " ").replace(/\s*\((october|november|december|fall|winter|spring|summer)[^)]*\)/ig, "")
  .replace(/[^\x20-\x7E–]/g, "").replace(/\s{2,}/g, " ").trim();
const EMOJI = /\p{Extended_Pictographic}/gu;
const limitEmoji = (s, n) => { let k = 0; return String(s || "").replace(EMOJI, (m) => (++k <= n ? m : "")).replace(/ {2,}/g, " ").trim(); };
const noEmoji = (s) => String(s || "").replace(EMOJI, "").replace(/\u{FE0F}/gu, "").replace(/ {2,}/g, " ").trim();
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const daysText = (days) => { const d = (days || []).filter(Boolean); if (!d.length) return ""; if (d.length === 1) return DOWL[d[0]] ? DOWL[d[0]] + "s" : d[0]; return d.join("/"); };
const scheduleBits = (p) => [daysText(p?.days), p?.time].filter(Boolean).join(" · ");
// A slot or item's kind; rows from before kinds existed are posts / roundups / texts.
export const kindOf = (s) => s?.kind || (s?.channel === "email" ? "roundup" : s?.channel === "sms" ? "text" : "post");
const isStory = (s) => ["story", "follow_up"].includes(kindOf(s));
const MONTH_FULL = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
// "MON · Skill Lab 3-5th" (running: its day) / "NOV 23 · Camp Elevate" (not
// started by `day`: its start date) - one row of a list graphic.
const listRow = (x, day) => `${(!day || !x.first_date || x.first_date <= day) && (x.days || [])[0] ? String(x.days[0]).toUpperCase() : md(x.first_date).toUpperCase()} · ${shortName(x.name)}`.slice(0, 48);

// Central time "YYYY-MM-DD" + "HH:MM" -> UTC ISO string.
export function ctIso(day, time = "12:00") {
  const [y, mo, d] = String(day).slice(0, 10).split("-").map(Number);
  const [h, mi] = String(time || "12:00").split(":").map(Number);
  const want = Date.UTC(y, mo - 1, d, h || 0, mi || 0);
  const guess = want + 6 * 3600e3;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess)).map(p => [p.type, p.value]));
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (wall - want)).toISOString();
}
export const ctToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

// What Claude is told about a program. No location, venue or court: the feed
// names buildings we don't mention (the Flex), and facts stay to the schedule.
export function programFacts(p) {
  if (!p) return null;
  return {
    id: String(p.id ?? ""), name: p.name, short_name: shortName(p.name), line: lineOf(p), kind: p.kind || null, audience: p.audience || null, ages: p.ages || null,
    first_date: p.first_date || null, first_date_label: fmtDay(p.first_date), last_date: p.last_date || null, date_range: dateRange(p.first_date, p.last_date),
    days: p.days || [], time: p.time || null, sessions_total: p.sessions_total ?? null,
    next_dates: (p.next_dates || []).slice(0, 6), is_new: !!p.is_new, ongoing: !!p.ongoing,
  };
}

// ── photos ───────────────────────────────────────────────────────────────────
// The library photo for a line: line match, then tag overlap (plus hinted
// tags), least used first, not one already used in this batch.
// The AI librarian's fields help when present: quality (1-5), the photo's
// shape against the graphic's (a story wants a tall photo, an email banner a
// wide one), and what it's good for. A photo a director marked "don't post"
// (release_ok false) is never picked.
export function pickPhoto(photos, line, { used = new Set(), hints = [], exclude = null, seed = "", format = "post" } = {}) {
  const want = LINE_TAGS[line] || [];
  const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; };
  const shape = format === "story" ? "portrait" : format === "email" ? "landscape" : null;
  const use = format === "story" ? "story" : format === "email" ? "email_banner" : "social_post";
  const scored = (photos || []).filter(p => p && p.url && p.active !== false && p.release_ok !== false && p.url !== exclude).map(p => {
    const tags = p.tags || [];
    let s = (p.line === line ? 4 : 0) + tags.filter(t => want.includes(t)).length * 2 + tags.filter(t => hints.includes(t)).length * 3;
    if (p.quality) s += (p.quality - 3) * 1.5;
    const o = orientationOf(p);
    if (shape && o === shape) s += 2.5;
    else if (format === "story" && o === "landscape") s -= 1;     // a wide photo crops badly to 9:16
    if ((p.uses || []).includes(use)) s += 1;
    s -= Math.min(3, (p.used_count || 0) * 0.25);
    if (used.has(p.url)) s -= 3;                       // repeat a photo before borrowing another line's
    if (p.line && p.line !== line) s -= 4;
    if (line !== "basketball" && tags.includes("basketball") && !tags.includes(line)) s -= 3;
    if (line !== "volleyball" && tags.includes("volleyball") && !tags.includes(line)) s -= 3;
    return { p, s: s + hash(p.url + seed) * 0.5 };
  }).sort((a, b) => b.s - a.s);
  return scored[0]?.p || null;
}

// ── templates (also the fallback when Claude isn't available) ────────────────
function accentOf(headline, prefer) {
  const words = String(headline || "").split(/\s+/).filter(Boolean);
  if (prefer && words.some(w => w.toLowerCase() === String(prefer).toLowerCase())) return words.find(w => w.toLowerCase() === String(prefer).toLowerCase());
  return words.filter(w => /[a-z]/i.test(w)).pop() || words.pop() || "";
}

export function templateCopy(slot, { program = null, programs = [], feedById = new Map() } = {}) {
  const line = slot.line, p = program;
  const name = p ? shortName(p.name) : lineLabel(line);
  const when = p ? fmtDay(p.first_date) : "";
  const sched = p ? scheduleBits(p) : "";
  const ages = p?.ages ? `For ${p.ages}.` : "";
  const isCamp = line === "camp_elevate";
  const hashtags = ["DrippingSprings", "DSSC", ...(HASHTAGS[line] || [])];
  const linkCta = LINE_LINKS[line]?.cta || "Register";
  let headline, accent, sub, tag, body;

  if (slot.channel === "email") {
    const list = (slot.programs || []).map(r => feedById.get(String(r.id)) || r);
    const lead = p ? (isCamp ? `Camp Elevate: ${dateRange(p.first_date, p.last_date)}` : `${name} starts ${md(p.first_date)}`) : `This week at DSSC`;
    headline = p ? (isCamp ? "CAMP ELEVATE" : name.toUpperCase()) : "THIS WEEK AT DSSC";
    accent = accentOf(headline, isCamp ? "ELEVATE" : null);
    const intro = [
      `Here's what's coming up at Dripping Springs Sports Club.`,
      p ? (isCamp
        ? `Camp Elevate runs ${dateRange(p.first_date, p.last_date)}${p.days?.length ? ` (${p.days.join("/")})` : ""}${p.time ? `, ${p.time}` : ""}.`
        : `${p.name} starts ${when}${sched ? ` - ${sched}` : ""}.${p.ages ? ` ${ages}` : ""}`) : LINE_BLURB[line],
    ].join(" ");
    const blocks = list.map(r => ({ ref: String(r.id), blurb: templateBlurb(r) }));
    if (slot.evergreen) blocks.push({ ref: slot.evergreen, blurb: LINE_BLURB[slot.evergreen] });
    const more = Math.max(0, list.length - (p ? 1 : 0));
    return {
      headline, accent, sub: p ? `${when}${p.time ? " · " + p.time : ""}` : "Where Dripping Springs plays.", tag: lineLabel(line).toUpperCase(),
      body: intro, cta_text: p ? (isCamp ? "Sign up for Camp Elevate" : "Register") : linkCta, hashtags: [],
      email_subject: lead, email_preheader: more ? `Plus ${more} more program${more === 1 ? "" : "s"} starting soon at DSSC.` : "Where Dripping Springs plays.",
      email_blocks: blocks, photo_tags: [],
    };
  }

  if (slot.channel === "sms") {
    const txt = p
      ? (isCamp ? `DSSC: Camp Elevate is ${dateRange(p.first_date, p.last_date)}${p.time ? `, ${p.time}` : ""}.` : `DSSC: ${name} starts ${when}${p.time ? `, ${p.time}` : ""}.`) + (slot.angle === "last_call" ? " Last call to sign up." : " Registration is open.")
      : `DSSC: ${LINE_BLURB[line]}`;
    return { headline: name, accent: "", sub: "", tag: "", body: txt, cta_text: "Register", hashtags: [], email_subject: "", email_preheader: "", email_blocks: [], photo_tags: [] };
  }

  // social: the month preview and follow-up stories list programs
  const listed = (slot.programs || []).map(r => feedById.get(String(r.id)) || r).filter(x => x && x.name);
  if (kindOf(slot) === "preview") {
    const month = MONTH_FULL[+String(addDays(slot.day, 7)).slice(5, 7) - 1] || "NEXT MONTH";
    headline = `COMING IN ${month}`; accent = month;
    body = listed.length ? `Coming up at DSSC in ${month[0] + month.slice(1).toLowerCase()}: ${listed.map(x => `${shortName(x.name)} (${md(x.first_date)})`).join(", ")}. See everything that's coming on our site.` : `${month[0] + month.slice(1).toLowerCase()} at DSSC: see what's coming up on our site.`;
    return { headline, accent, sub: "Where Dripping Springs plays.", tag: "NEXT MONTH", body, cta_text: "See what's coming", hashtags, email_subject: "", email_preheader: "", email_blocks: [], photo_tags: [] };
  }
  if (kindOf(slot) === "follow_up" && listed.length >= 2) {
    const H2 = { volleyball: "WAYS TO PLAY", basketball: "WAYS TO TRAIN", reach: "WAYS TO TRAIN", camp_elevate: "CAMP ELEVATE", parties: "PARTY DAY", rentals: "BOOK A COURT", open_gym: "OPEN GYM", club: "AT DSSC" };
    headline = H2[line] || "WAYS TO PLAY"; accent = accentOf(headline);
    body = listed.map(x => `${shortName(x.name)}: ${[x.first_date ? (x.first_date <= slot.day ? "running now" : `starts ${md(x.first_date)}`) : "", scheduleBits(x), x.ages ? `for ${x.ages}` : ""].filter(Boolean).join(", ")}.`).join(" ") + " Details on our site.";
    return { headline, accent, sub: listed.map(x => shortName(x.name)).slice(0, 3).join(" - ").slice(0, 50), tag: lineLabel(line).toUpperCase(), body, cta_text: linkCta, hashtags, email_subject: "", email_preheader: "", email_blocks: [], photo_tags: [] };
  }
  tag = slot.angle === "last_call" ? "LAST CALL" : slot.angle === "new" ? "NEW" : lineLabel(line).toUpperCase();
  if (p) {
    headline = isCamp ? "CAMP ELEVATE" : name.toUpperCase().split(/\s+/).slice(0, 5).join(" ");
    accent = accentOf(headline, isCamp ? "ELEVATE" : null);
    sub = isCamp ? `${dateRange(p.first_date, p.last_date)}${p.time ? " · " + p.time : ""}` : `Starts ${when}${p.time ? " · " + p.time : ""}`;
    const what = isCamp ? `Camp Elevate is ${dateRange(p.first_date, p.last_date)}${p.days?.length ? ` (${p.days.join("/")})` : ""}${p.time ? `, ${p.time}` : ""}.` : null;
    switch (slot.angle) {
      case "last_call": body = isCamp ? `Last call for Camp Elevate: ${dateRange(p.first_date, p.last_date)}${p.days?.length ? ` (${p.days.join("/")})` : ""}${p.time ? `, ${p.time}` : ""}. Sign up at the link.` : `Last call: ${p.name} starts ${when}.${sched ? ` ${sched}.` : ""}${ages ? " " + ages : ""} Register before it starts.`; break;
      case "just_started": body = `${p.name} kicked off ${when}.${sched ? ` ${sched}.` : ""}${ages ? " " + ages : ""} Details at the link.`; break;
      case "new": body = `New at DSSC: ${p.name}. It starts ${when}.${sched ? ` ${sched}.` : ""}${ages ? " " + ages : ""}`; break;
      case "evergreen": body = `${p.name} runs all season at DSSC.${sched ? ` ${sched}.` : ""}${ages ? " " + ages : ""}`; break;
      case "reminder": body = isCamp ? `Reminder: ${what} Sign up at the link.` : `Reminder: ${p.name} starts ${when}.${sched ? ` ${sched}.` : ""}${ages ? " " + ages : ""}`; break;
      default: body = isCamp ? `${what} Sign up at the link.` : `${p.name} starts ${when}.${sched ? ` ${sched}.` : ""}${ages ? " " + ages : ""} Registration is open.`;
    }
  } else {
    const H = { volleyball: "PLAY VOLLEYBALL AT DSSC", basketball: "4TH QUARTER ATHLETE", reach: "TRAIN WITH REACH", camp_elevate: "CAMP ELEVATE", parties: "BIRTHDAY PARTIES AT DSSC", rentals: "RENT A COURT", open_gym: "OPEN GYM", club: "WHERE DRIPPING SPRINGS PLAYS" };
    const A = { volleyball: "VOLLEYBALL", basketball: "ATHLETE", reach: "REACH", camp_elevate: "ELEVATE", parties: "PARTIES", rentals: "COURT", open_gym: "GYM", club: "PLAYS" };
    headline = H[line] || "DSSC"; accent = A[line] || accentOf(headline); sub = "Where Dripping Springs plays."; body = LINE_BLURB[line] || LINE_BLURB.club;
  }
  return { headline, accent, sub, tag, body, cta_text: p ? (isCamp ? "Sign up for Camp Elevate" : "Register") : linkCta, hashtags, email_subject: "", email_preheader: "", email_blocks: [], photo_tags: [] };
}
function templateBlurb(r) {
  return [r.first_date ? `Starts ${fmtDay(r.first_date)}.` : "", scheduleBits(r) ? `${scheduleBits(r)}.` : "", r.ages ? `For ${r.ages}.` : ""].filter(Boolean).join(" ");
}

// ── rules every draft must pass ──────────────────────────────────────────────
const BANNED = [
  [/\$\s?\d|\b\d+\s?(dollars|bucks)\b|\bfor\s+free\b|\bfree\s+(of\s+charge|admission|entry|class|session|trial|to\s+(join|attend))\b|\bno\s+cost\b|\b\d+\s?%\s?off\b|\bdiscount/i, "mentions a price"],
  [/\b(spots?|seats?|openings?|places?)\s+(left|remaining)\b|\bonly\s+\d+\s+(spots?|seats?)\b|\bsell(s|ing)?\s+out\b|\bsold\s+out\b|\bfilling\s+(up|fast)\b/i, "claims availability"],
  [/\bflex\b/i, "mentions the Flex"],
];
export function ruleProblems(text) {
  const t = String(text || "");
  return BANNED.filter(([re]) => re.test(t)).map(([, why]) => why);
}
const stripUrls = (s) => String(s || "").replace(/\s*(?:\b(?:at|here|via|on)\b\s*:?|:)?\s*\(?https?:\/\/[^\s)]*[^\s).,!?;:]\)?/gi, "").replace(/\blink in (?:our )?bio\b/gi, "").replace(/[ \t]{2,}/g, " ").replace(/ +([.,!?])/g, "$1").trim();

// Normalise one copy object; null when it breaks a rule (caller falls back).
export function cleanCopy(raw, slot, fallback, rules = []) {
  if (!raw || typeof raw !== "object") return { copy: null, problems: ["empty"] };
  const c = { ...fallback, ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v != null && v !== "")) };
  const all = [c.headline, c.sub, c.body, c.email_subject, c.email_preheader, ...(c.email_blocks || []).map(b => b.blurb)].join(" \n ");
  const problems = [...ruleProblems(all), ...rulesBroken(all, [slot.line, ...(slot.programs || []).map(p => p?.line), slot.evergreen], rules)];
  if (problems.length) return { copy: null, problems };
  c.headline = noEmoji(c.headline).replace(/\s+/g, " ").slice(0, ["pov", "note"].includes(slot?.template) ? 180 : 60).trim() || fallback.headline;
  c.accent = accentOf(c.headline, noEmoji(c.accent));
  c.sub = noEmoji(c.sub).slice(0, 80);
  c.tag = noEmoji(c.tag).slice(0, 24);
  c.cta_text = noEmoji(stripUrls(c.cta_text)).slice(0, 40) || fallback.cta_text;
  c.hashtags = [...new Set((Array.isArray(c.hashtags) ? c.hashtags : []).map(h => String(h).replace(/[^A-Za-z0-9_]/g, "")).filter(Boolean))].slice(0, 6);
  if (slot.channel === "social") { c.body = limitEmoji(stripUrls(c.body), 2).slice(0, 1800); if (!c.hashtags.length) c.hashtags = fallback.hashtags; }
  if (slot.channel === "email") {
    c.body = noEmoji(stripUrls(c.body)).slice(0, 2000);
    c.email_subject = limitEmoji(c.email_subject, 1).slice(0, 120) || fallback.email_subject;
    c.email_preheader = noEmoji(c.email_preheader).slice(0, 140);
    c.email_blocks = (Array.isArray(c.email_blocks) ? c.email_blocks : []).map(b => ({ ref: String(b?.ref || ""), blurb: noEmoji(stripUrls(b?.blurb)).slice(0, 400), section: noEmoji(stripUrls(b?.section)).replace(/\s+/g, " ").trim().slice(0, 40) })).filter(b => b.ref);
    c.hashtags = [];
  }
  if (slot.channel === "sms") { c.body = asciiize(noEmoji(stripUrls(c.body).replace(/\s*reply stop.*$/i, ""))).slice(0, 280); c.hashtags = []; }
  c.photo_tags = (Array.isArray(c.photo_tags) ? c.photo_tags : []).filter(t => PHOTO_TAGS.includes(t));
  return { copy: c, problems: [] };
}

// ── Claude ───────────────────────────────────────────────────────────────────
const SYSTEM = `You write marketing copy for Dripping Springs Sports Club (DSSC) in Dripping Springs, Texas - the club's Facebook and Instagram posts, its weekly email to families, and an occasional text message. A director reviews and approves every draft before anything is published.

The club: youth and adult volleyball, basketball (branded "4th Quarter Athlete at DSSC"), Reach Performance (speed, strength and athletic development training), Camp Elevate (a full-day camp when school is out), birthday parties, court rentals and open gym. The building is "the Warehouse" (Warehouse I & II, on Fitzhugh Rd at Trautwein Rd). Tagline: "Where Dripping Springs plays."

Voice:
- Local, warm, confident and short. Talk to families ("your kids", "your athlete"), never "customers".
- Specific: use the real dates, days, times, grades and ages from the facts you are given, and say what kids actually do.
- One clear call to action per piece.
- Social: 0 to 2 emojis. Email subject: at most one emoji. Text messages: no emojis.
- Birthday parties are run by party hosts (not coaches).
- Never mention "the Flex" or any building other than the Warehouse. Only say a program is at the Warehouse if its facts say so; otherwise just say "at DSSC".

Facts - the hard rules:
- Use only the facts provided in the request: program names, dates, days, times, ages/grades, session counts, and the director's priority notes and instructions. Never invent anything else.
- No prices or costs, no discounts, no "free", no "spots left", "filling fast" or "sold out", no claims about coaches, results, rankings or outcomes unless they are in the facts.
- Do not write URLs or "link in bio" - the system adds the real link and button for each piece. Do not write hashtags inside the caption; put them in the hashtags field.
- If a fact you would like to use is not given, leave it out.

Output: JSON matching the schema, one object per slot, with "slot" set to the slot number you were given.
Fields by channel:
- social: headline = the big words on the graphic, 2 to 5 words; accent = ONE word from the headline to color; sub = a short line under it (dates/times), at most 50 characters; tag = a 1-3 word label (e.g. "CAMP ELEVATE", "LAST CALL", "NEW"); body = the caption, 2 to 5 short sentences, no URL, no hashtags; cta_text = the button words (2 to 5 words, e.g. "Register now", "Book a party"); hashtags = 3 to 5 tags without the # sign (always include DrippingSprings); email_subject, email_preheader = ""; email_blocks = []; photo_tags = 0 to 2 tags describing the ideal photo.
- email: headline = the email's big headline, 2 to 6 words; accent = one word of it; sub = a short line under the headline; tag = a 1-3 word label; body = the opening, 2 to 4 sentences that lead with the featured program and why it matters this week; cta_text = the main button words; email_subject = under 60 characters, specific (name the featured program and its date); email_preheader = under 90 characters, adds to the subject; email_blocks = one entry per listed program (ref = the program id) and one for the evergreen line if given (ref = the line key), each blurb 1 to 2 sentences built from that program's facts, and section = a short heading (1 to 3 words, e.g. "Volleyball", "Court rentals") shown above that block when it starts a new group - give consecutive blocks of the same group the same section, use "" for none; add sections when the email moves between different lines (e.g. from birthday parties to volleyball) or when the director asks for headers or a transition; hashtags = []; photo_tags as above.
- sms: body = the whole text, under 230 characters, starting with "DSSC:", plain characters only, no URL and no opt-out line (both are added); headline = the program name; accent, sub, tag, email_subject, email_preheader = ""; cta_text = "Register"; email_blocks = []; hashtags = []; photo_tags = [].
Keep the club's priorities in mind: the request lists what the directors want pushed this week and why each slot was planned. When one slot repeats a line from earlier in the week, take a different angle so the two posts don't read alike.

Each slot has a kind:
- post: a Facebook + Instagram feed post.
- story: a full-screen Instagram/Facebook story. Stories show no caption - the graphic carries the message, so make the headline and sub do the work (sub = the key date or time). body = one or two short sentences.
- follow_up: a story the day after a post on the same line. Do not repeat the post - break it out: the slot's "programs" are the ways to take part, so the sub names them in order (e.g. "Clinics - 3v3 - Pods") and the body gives each one a quick frame (who it's for, when), ending on how to register.
- preview: the month-preview post - what's coming at DSSC next month: the programs in "programs" with their dates, plus anything the priorities mention. Headline like "COMING IN NOVEMBER".
- roundup: the weekly email - what's happening now and what's coming, without making it long.
- dedicated: an email about ONE line only - sell the why to families, cover that line's programs in "programs", one call to action. The subject names the line or its lead program.
- text: a text message.
A slot may carry a "theme": a content idea from the directors' marketing calendar. Use it as the angle when it fits the facts you were given; never invent a fact to make it fit.

A slot may carry a "look" - a trend-style graphic - and a "trend" it adapts:
- look "pov": the TikTok / Reels caption look. headline = the on-screen caption in sentence case, written the way that trend is written ("POV: ...", "Tell me you ... without telling me", "Not all angels are in heaven... some are ...", "Things that just make sense: ..."), 6 to 16 words, funny or relatable for Dripping Springs families; accent = ""; sub = an optional short second line (or ""); tag = "".
- look "note": a handwritten note on crumpled paper. headline = the note itself, 1 to 3 short sentences in sentence case, warm and personal; sub = a "P.S. ..." line or ""; tag = the signature - a coach's name only if the facts or theme give it, otherwise "DSSC".
- trend: keep the trend's format recognizable but make it about the club. Never name a song or quote lyrics, and don't make it depend on a sound - the post has to work as a still image with its caption.`;

const BLOCK = { type: "object", additionalProperties: false, required: ["ref", "blurb", "section"], properties: { ref: { type: "string" }, blurb: { type: "string" }, section: { type: "string" } } };
const ITEM_PROPS = {
  slot: { type: "integer" }, headline: { type: "string" }, accent: { type: "string" }, sub: { type: "string" }, tag: { type: "string" },
  body: { type: "string" }, cta_text: { type: "string" }, hashtags: { type: "array", items: { type: "string" } },
  email_subject: { type: "string" }, email_preheader: { type: "string" }, email_blocks: { type: "array", items: BLOCK },
  photo_tags: { type: "array", items: { type: "string", enum: PHOTO_TAGS } },
};
const ITEM = { type: "object", additionalProperties: false, required: Object.keys(ITEM_PROPS), properties: ITEM_PROPS };
const WEEK_SCHEMA = { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: ITEM } } };

// How much personality the copy gets (settings.flair). Facts rules never bend.
export const FLAIR = [
  "Flair: plain. Clear, warm and informative; no gimmicks.",
  "Flair: some personality. Open with a hook that stops the scroll, keep it playful but clear, and use a fun format (POV, this-or-that, a countdown, \"tag someone who...\") when it fits the slot - not every time.",
  "Flair: bold. Every piece opens with a scroll-stopping hook; lean into fun formats (POV, this-or-that, hot takes about drills, \"tag a friend who...\", challenges), wordplay and energy. Still short, still kind, still no invented facts.",
];
export const flairText = (n) => FLAIR[Math.max(0, Math.min(2, Number.isFinite(+n) ? Math.round(+n) : 1))];
function voiceBlock(voice, flair = 1, rules = []) {
  const v = String(voice || "").trim();
  const r = rulesText(rules);
  return `${flairText(flair)}\n\n${r ? r + "\n\n" : ""}` + (v ? `Extra notes from the club's directors about voice and brand (follow them unless they conflict with the facts rules):\n${v.slice(0, 4000)}` : "No extra voice notes from the directors.");
}

async function callClaude(userText, { voice, flair, rules, timeoutMs = 95000 } = {}) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: timeoutMs, maxRetries: 0 });
  const msg = await client.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: WEEK_SCHEMA } },
    system: [
      { type: "text", text: SYSTEM },
      { type: "text", text: voiceBlock(voice, flair, rules), cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: userText }],
  });
  if (msg.stop_reason === "refusal") return { items: null, model: msg.model, error: "Claude declined" + (msg.stop_details?.category ? ` (${msg.stop_details.category})` : "") };
  if (msg.stop_reason === "max_tokens") return { items: null, model: msg.model, error: "Claude ran out of room (max_tokens)" };
  const text = (msg.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  try {
    const j = JSON.parse(text);
    return { items: Array.isArray(j?.items) ? j.items : null, model: msg.model, usage: msg.usage, error: Array.isArray(j?.items) ? null : "No items in the response" };
  } catch {
    return { items: null, model: msg.model, error: "Couldn't read Claude's JSON" };
  }
}

function slotForAi(slot, i, feedById) {
  const full = slot.program ? feedById.get(String(slot.program.id)) || slot.program : null;
  return {
    slot: i, channel: slot.channel, kind: slot.kind || kindOf(slot), day: slot.day, day_label: fmtDay(slot.day), line: slot.line, line_label: lineLabel(slot.line), angle: slot.angle, why_planned: slot.reason,
    theme: slot.theme || undefined,
    look: ["pov", "note"].includes(slot.template) ? slot.template : undefined,
    trend: slot.trend || undefined,
    program: programFacts(full),
    programs: (slot.programs || []).length ? (slot.programs || []).map(r => programFacts(feedById.get(String(r.id)) || r)) : undefined,
    evergreen: slot.channel === "email" && slot.evergreen ? { ref: slot.evergreen, line: lineLabel(slot.evergreen), about: LINE_BLURB[slot.evergreen] } : undefined,
    line_about: LINE_BLURB[slot.line],
  };
}

// ── email HTML ───────────────────────────────────────────────────────────────
export const UNSUB_TOKEN = "{{unsubscribe_url}}";
const FONT_H = "'Barlow Condensed','Arial Narrow',Impact,'Helvetica Neue',Arial,sans-serif";
const FONT_B = "'Schibsted Grotesk',Helvetica,Arial,sans-serif";
const accentHtml = (headline, accent) => {
  const h = esc(String(headline || "").toUpperCase()), a = String(accent || "").toUpperCase();
  if (!a) return h;
  const i = h.indexOf(esc(a));
  return i < 0 ? h : `${h.slice(0, i)}<span style="color:#B2D049">${esc(a)}</span>${h.slice(i + esc(a).length)}`;
};
const paras = (t) => String(t || "").split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

// item-ish: { email_subject, email_preheader, headline, graphic:{accent, sub}, body, cta_text, cta_url, email_blocks, hero_url }
export function buildEmail(it) {
  const hero = it.hero_url || it.asset_url || it.graphic?.photo_url || "";
  const blocks = Array.isArray(it.email_blocks) ? it.email_blocks : [];
  const btn = (text, url, bg = "#FF7300", fg = "#061a18") => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 4px"><tr><td style="background:${bg};padding:14px 26px"><a href="${esc(url)}" style="font-family:${FONT_H};font-weight:900;font-size:20px;letter-spacing:.5px;text-transform:uppercase;color:${fg};text-decoration:none">${esc(text)} &rarr;</a></td></tr></table>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(it.email_subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@800;900&family=Schibsted+Grotesk:wght@400;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#061a18">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(it.email_preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#061a18"><tr><td align="center" style="padding:0">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
<tr><td style="padding:22px 24px 18px"><a href="${SITE}"><img src="${SITE}/brand/logo-light.png" width="190" alt="Dripping Springs Sports Club" style="display:block;width:190px;height:auto;border:0"></a></td></tr>
${hero ? `<tr><td style="padding:0">${it.cta_url ? `<a href="${esc(it.cta_url)}" style="display:block">` : ""}<img data-hero src="${esc(hero)}" width="600" alt="${esc(it.headline)}" style="display:block;width:100%;max-width:600px;height:auto;border:0">${it.cta_url ? "</a>" : ""}</td></tr>` : ""}
<tr><td style="background:#061a18;padding:26px 24px 18px">
${it.graphic?.tag ? `<div style="font-family:${FONT_H};font-weight:800;font-size:14px;letter-spacing:2px;text-transform:uppercase;color:#061a18;background:#B2D049;display:inline-block;padding:4px 10px;margin-bottom:12px">${esc(it.graphic.tag)}</div>` : ""}
<div style="font-family:${FONT_H};font-weight:900;font-size:46px;line-height:.95;text-transform:uppercase;color:#F4F0E8">${accentHtml(it.headline, it.graphic?.accent)}</div>
${it.graphic?.sub ? `<div style="font-family:${FONT_B};font-size:16px;color:#a9b7b1;margin-top:10px">${esc(it.graphic.sub)}</div>` : ""}
</td></tr>
<tr><td style="background:#F4F0E8;padding:26px 24px 10px;font-family:${FONT_B};font-size:16px;line-height:1.55;color:#061a18">
${paras(it.body)}
${it.cta_url ? btn(it.cta_text || "Register", it.cta_url) : ""}
</td></tr>
${blocks.map((b, i) => `${b.section && b.section !== (blocks[i - 1] || {}).section ? `<tr><td style="background:#F4F0E8;padding:28px 24px 0"><div style="font-family:${FONT_H};font-weight:900;font-size:34px;line-height:1;text-transform:uppercase;color:#104946">${esc(b.section)}</div></td></tr>` : ""}<tr><td style="background:#F4F0E8;padding:18px 24px 6px;font-family:${FONT_B};font-size:15px;line-height:1.5;color:#061a18">
<div style="border-top:3px solid #0F8B76;padding-top:14px">
${b.label ? `<div style="font-family:${FONT_H};font-weight:800;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#0F8B76">${esc(b.label)}</div>` : ""}
<div style="font-family:${FONT_H};font-weight:900;font-size:26px;line-height:1;text-transform:uppercase;color:#061a18;margin:4px 0 6px">${esc(b.title)}</div>
${b.date_label ? `<div style="font-weight:700;color:#104946;margin-bottom:6px">${esc(b.date_label)}</div>` : ""}
${b.blurb ? `<div style="margin-bottom:8px">${esc(b.blurb)}</div>` : ""}
${b.url ? `<a href="${esc(b.url)}" style="font-family:${FONT_H};font-weight:900;font-size:17px;letter-spacing:.5px;text-transform:uppercase;color:#0F8B76;text-decoration:none">${esc(b.cta || "Details")} &rarr;</a>` : ""}
</div></td></tr>`).join("\n")}
<tr><td style="background:#F4F0E8;padding:8px 24px 26px"></td></tr>
<tr><td style="background:#061a18;padding:24px;font-family:${FONT_B};font-size:13px;line-height:1.6;color:#a9b7b1">
<div style="font-family:${FONT_H};font-weight:900;font-size:22px;text-transform:uppercase;color:#F4F0E8;margin-bottom:6px">Where Dripping Springs <span style="color:#B2D049">plays.</span></div>
${esc(CLUB_ADDRESS)}<br>
<a href="${SITE}" style="color:#B2D049;text-decoration:none">drippingsportsclub.com</a><br><br>
You're getting this because your family has signed up for a program at DSSC. <a href="${UNSUB_TOKEN}" style="color:#a9b7b1;text-decoration:underline">Unsubscribe</a>.
</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    String(it.headline || "").toUpperCase(), it.graphic?.sub || "", "", String(it.body || ""), "",
    it.cta_url ? `${it.cta_text || "Register"}: ${it.cta_url}` : "", "",
    ...blocks.flatMap((b, i) => [...(b.section && b.section !== (blocks[i - 1] || {}).section ? ["== " + String(b.section).toUpperCase() + " ==", ""] : []), String(b.title || "").toUpperCase(), b.date_label || "", b.blurb || "", b.url ? `${b.cta || "Details"}: ${b.url}` : "", ""]),
    "Where Dripping Springs plays.", CLUB_ADDRESS, SITE, "", `Unsubscribe: ${UNSUB_TOKEN}`,
  ].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { html, text };
}
// The hero swaps to the rendered graphic once the UI has made one.
export const withHero = (html, url) => url ? String(html || "").replace(/(<img data-hero src=")[^"]*(")/, `$1${esc(url)}$2`) : String(html || "");

// Section headers the writer left out. When the email moves between lines
// (a birthday-party email that goes on to volleyball, then court rentals) or
// a director asked for headers, a block without one gets its line's name, or
// the header of the block before it when that block is the same line.
const groupOf = (b) => b.program_id ? b.label : lineLabel(b.line);
export function fillSections(blocks, { line, force = false } = {}) {
  const groups = new Set(blocks.map(groupOf).filter(Boolean));
  if (!force && !(groups.size > 1 || (line && groups.size && !groups.has(lineLabel(line))))) return blocks;
  return blocks.reduce((out, b) => {
    const prev = out[out.length - 1];
    const section = b.section || (prev && groupOf(prev) === groupOf(b) ? prev.section : groupOf(b)) || "";
    return [...out, { ...b, section }];
  }, []);
}

// Email blocks from the slot's programs + Claude's (or the template's) blurbs.
function emailBlocks(slot, copy, feedById) {
  const blurbs = new Map((copy.email_blocks || []).map(b => [String(b.ref), b.blurb]));
  const sections = new Map((copy.email_blocks || []).map(b => [String(b.ref), b.section || ""]));
  const out = (slot.programs || []).map(r => {
    const p = feedById.get(String(r.id)) || r;
    return {
      program_id: String(r.id), title: shortName(p.name), label: lineLabel(r.line || lineOf(p)),
      date_label: [p.first_date ? (r.angle === "just_started" ? `Started ${fmtDay(p.first_date)}` : `Starts ${fmtDay(p.first_date)}`) : "", scheduleBits(p)].filter(Boolean).join(" · "),
      blurb: blurbs.get(String(r.id)) || templateBlurb(p), url: r.url || programRef(p)?.url || lineUrl(lineOf(p)), cta: lineOf(p) === "camp_elevate" ? "Sign up" : "Details",
      section: sections.get(String(r.id)) || "",
    };
  });
  if (slot.evergreen) out.push({ program_id: null, line: slot.evergreen, title: lineLabel(slot.evergreen), label: "Any time", date_label: "", blurb: blurbs.get(slot.evergreen) || LINE_BLURB[slot.evergreen], url: lineUrl(slot.evergreen), cta: LINE_LINKS[slot.evergreen]?.cta || "Details", section: sections.get(slot.evergreen) || "" });
  return fillSections(out, { line: slot.line });
}

// ── graphic spec ─────────────────────────────────────────────────────────────
export function graphicFor(slot, copy, photo, { programs = [] } = {}) {
  if (slot.channel === "sms") return null;
  const p = slot.program;
  const daysOut = p?.first_date ? daysBetween(slot.day, p.first_date) : null;
  let template = "photo";
  let date_label = p?.first_date ? md(p.first_date).toUpperCase() : "";
  let items = [];
  const listed = (slot.programs || []).filter(x => x && x.name);
  if (slot.channel === "email") template = "photo";
  else if (["preview", "follow_up"].includes(kindOf(slot)) && listed.length >= 2) {
    template = "list"; items = listed.slice(0, 4).map(x => listRow(x, kindOf(slot) === "preview" ? "0000-00-00" : slot.day));
  } else if (p && (slot.angle === "last_call" || (["priority", "reminder"].includes(slot.angle) && daysOut != null && daysOut >= 0 && daysOut <= 10))) {
    template = "countdown";
    date_label = daysOut <= 0 ? "TODAY" : daysOut === 1 ? "TOMORROW" : daysOut <= 7 ? `${daysOut} DAYS` : "LAST CALL";
  } else if (p && ["starting_soon", "new", "priority", "reminder"].includes(slot.angle)) template = "starts";
  // A trend look asked for by an idea wins; otherwise a line-only post lists the line's programs.
  if (["pov", "note"].includes(slot.template) && slot.channel === "social") { template = slot.template; items = []; }
  else if (!p && slot.channel !== "email" && template === "photo") {
    const same = (programs || []).filter(x => lineOf(x) === slot.line && x.first_date && (x.ongoing || (x.last_date || x.first_date) >= slot.day)).slice(0, 4);
    if (same.length >= 2) { template = "list"; items = same.map(x => `${(x.days || [])[0] ? String(x.days[0]).toUpperCase() : md(x.first_date).toUpperCase()} · ${shortName(x.name)}`.slice(0, 48)); }
  }
  return {
    template, format: slot.channel === "email" ? "email" : isStory(slot) ? "story" : "post",
    photo_url: photo?.url || null, photo_key: photo?.key || null,
    headline: copy.headline, accent: copy.accent, sub: copy.sub, tag: copy.tag, date_label, items,
  };
}

// ── the week ─────────────────────────────────────────────────────────────────
// composeItems({ slots, weekOf, programs (feed), priorities, settings, photos, instruction, by })
//   -> { rows: [mkt_items insert rows], ai: { used, model, error, fallbacks:[{slot, why}] } }
export async function composeItems({ slots, weekOf, programs = [], priorities = [], settings = {}, photos = [], instruction = "", by = "auto", timeoutMs } = {}) {
  const feedById = new Map((programs || []).map(p => [String(p.id), p]));
  const templates = slots.map(s => templateCopy(s, { program: s.program ? feedById.get(String(s.program.id)) || s.program : null, programs: s.programs, feedById }));
  const ai = { used: false, model: null, error: null, fallbacks: [] };
  let aiItems = null;
  if (aiReady() && slots.length) {
    const active = (priorities || []).filter(p => p.active !== false && (!p.starts_on || p.starts_on <= addDays(weekOf, 6)) && (!p.ends_on || p.ends_on >= weekOf));
    const req = {
      week_of: weekOf, week_label: `Week of ${fmtDay(weekOf)}`,
      director_instruction: String(instruction || "").trim() || null,
      priorities: active.map(p => ({ title: p.title, notes: p.notes || "", lines: (p.lines || []).map(lineLabel), less_of: (p.avoid_lines || []).map(lineLabel), weight: p.weight })),
      slots: slots.map((s, i) => slotForAi(s, i, feedById)),
    };
    try {
      const r = await callClaude("Write the drafts for these slots. Request (JSON):\n" + JSON.stringify(req, null, 1), { voice: settings.voice, flair: settings.flair, rules: settings.rules, timeoutMs });
      ai.model = r.model || null; ai.error = r.error || null; aiItems = r.items; ai.usage = r.usage;
    } catch (e) {
      ai.error = e?.message || String(e);
    }
  } else if (!aiReady()) ai.error = "ANTHROPIC_API_KEY is not set - template copy";
  const bySlot = new Map((aiItems || []).map(x => [Number(x.slot), x]));
  const used = new Set();
  const rows = slots.map((slot, i) => {
    let copy = templates[i];
    if (aiItems) {
      const { copy: c, problems } = cleanCopy(bySlot.get(i), slot, templates[i], settings.rules);
      if (c) { copy = c; ai.used = true; } else ai.fallbacks.push({ slot: i, why: problems.join(", ") });
    }
    return rowFor(slot, copy, { weekOf, feedById, photos, used, settings, programs, by, seed: weekOf + ":" + i });
  });
  return { rows, ai };
}

export function rowFor(slot, copy, { weekOf, feedById = new Map(), photos = [], used = new Set(), settings = {}, programs = [], by = "auto", seed = "" }) {
  const photo = slot.channel === "sms" ? null : pickPhoto(photos, slot.line, { used, hints: copy.photo_tags || [], seed, format: slot.channel === "email" ? "email" : isStory(slot) ? "story" : "post" });
  if (photo) used.add(photo.url);
  const cta_url = slot.program?.url || lineUrl(slot.line);
  const graphic = graphicFor(slot, copy, photo, { programs });
  const row = {
    week_of: weekOf, channel: slot.channel, kind: kindOf(slot), theme: slot.theme || null, platforms: slot.channel === "social" ? (slot.platforms || ["facebook", "instagram"]) : [],
    line: slot.line, program: slot.program || null, programs: slot.programs || [], reason: slot.reason, angle: slot.angle,
    status: "draft", scheduled_at: ctIso(slot.day, slot.time),
    headline: copy.headline, body: copy.body, cta_text: copy.cta_text, cta_url, hashtags: copy.hashtags || [],
    graphic, audience: null, created_by: by,
    // Every row carries every column: a batch insert sends the union of the
    // rows' keys, and a key a row lacks goes in as NULL (email_blocks is NOT NULL).
    email_subject: null, email_preheader: null, email_html: null, email_blocks: [],
  };
  if (slot.channel === "email") {
    row.email_subject = copy.email_subject; row.email_preheader = copy.email_preheader;
    row.email_blocks = emailBlocks(slot, copy, feedById);
    row.email_html = buildEmail({ ...row }).html;
    row.audience = settings.email_audience && typeof settings.email_audience === "object" ? settings.email_audience : { source: "dssc_contacts" };
  }
  if (slot.channel === "sms") {
    row.body = smsBody(copy.body, cta_url);
    row.audience = { ...EMPTY_FILTERS, ...(settings.sms_filters || {}) };
  }
  return row;
}
// A text ends with its link and the opt-out line.
export const smsBody = (text, url) => {
  const t = asciiize(stripUrls(String(text || "")).replace(/\s*reply stop.*$/i, "")).trim();
  return `${t}${url ? ` ${url}` : ""}\nReply STOP to opt out.`;
};
export const smsCore = (body) => stripUrls(String(body || "").replace(/\s*reply stop.*$/i, "")).trim();

// ── revise one item ──────────────────────────────────────────────────────────
// -> { patch, model, error } ; patch has headline, body, email_*, cta_text, hashtags, graphic, email_html
export async function reviseItem({ item, instruction, programs = [], settings = {}, photos = [], timeoutMs } = {}) {
  if (!aiReady()) return { patch: null, error: "ANTHROPIC_API_KEY is not set - edit the text directly" };
  const feedById = new Map((programs || []).map(p => [String(p.id), p]));
  const slot = { channel: item.channel, kind: kindOf(item), theme: item.theme || null, day: String(item.scheduled_at ? new Date(item.scheduled_at).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) : item.week_of), line: item.line, angle: item.angle, reason: item.reason, program: item.program, programs: item.programs || [], evergreen: (item.email_blocks || []).find(b => !b.program_id && b.line)?.line || null };
  const current = {
    headline: item.headline, accent: item.graphic?.accent || "", sub: item.graphic?.sub || "", tag: item.graphic?.tag || "",
    body: item.channel === "sms" ? smsCore(item.body) : item.body, cta_text: item.cta_text, hashtags: item.hashtags || [],
    email_subject: item.email_subject || "", email_preheader: item.email_preheader || "",
    email_blocks: (item.email_blocks || []).map(b => ({ ref: String(b.program_id || b.line || ""), blurb: b.blurb || "", section: b.section || "", title: b.title || "" })),
  };
  const req = { director_instruction: String(instruction || "").trim(), slot: slotForAi(slot, 0, feedById), current_draft: current };
  let r;
  try {
    r = await callClaude("Rewrite this one draft following the director's instruction. Keep what the instruction doesn't touch. Section headers inside an email are email_blocks[].section: asking for a header or a transition changes those and leaves the headline, subject and opening as they are. Return exactly one item with slot 0. Request (JSON):\n" + JSON.stringify(req, null, 1), { voice: settings.voice, flair: settings.flair, rules: settings.rules, timeoutMs });
  } catch (e) { return { patch: null, error: e?.message || String(e) }; }
  const raw = (r.items || []).find(x => Number(x.slot) === 0) || (r.items || [])[0];
  if (!raw) return { patch: null, model: r.model, error: r.error || "No rewrite came back" };
  const base = { ...current, hashtags: current.hashtags, email_blocks: current.email_blocks, photo_tags: [] };
  const { copy, problems } = cleanCopy(raw, slot, base, settings.rules);
  if (!copy) return { patch: null, model: r.model, error: `The rewrite broke a rule (${problems.join(", ")}) - try different wording` };
  const wantsPhoto = /\b(photo|picture|pic|image|shot)\b/i.test(instruction || "");
  let photo = item.graphic?.photo_url ? { url: item.graphic.photo_url, key: item.graphic.photo_key } : null;
  if (wantsPhoto && item.channel !== "sms") photo = pickPhoto(photos, item.line, { hints: copy.photo_tags, exclude: item.graphic?.photo_url, seed: String(Date.now()), format: item.graphic?.format || "post" }) || photo;
  const graphic = item.channel === "sms" ? null : { ...(item.graphic || {}), headline: copy.headline, accent: copy.accent, sub: copy.sub, tag: copy.tag, photo_url: photo?.url || null, photo_key: photo?.key || null };
  const patch = { headline: copy.headline, body: copy.body, cta_text: copy.cta_text, hashtags: copy.hashtags, graphic };
  if (item.channel === "sms") patch.body = smsBody(copy.body, item.cta_url);
  if (item.channel === "email") {
    patch.email_subject = copy.email_subject; patch.email_preheader = copy.email_preheader;
    const byRef = new Map(copy.email_blocks.map(b => [b.ref, b]));
    const merged = (item.email_blocks || []).map(b => { const n = byRef.get(String(b.program_id || b.line || "")); return { ...b, blurb: n?.blurb || b.blurb, section: n ? n.section : (b.section || "") }; });
    const wantsHeaders = /\b(header|heading|section|transition)s?\b/i.test(instruction || "");
    patch.email_blocks = fillSections(merged, { line: item.line, force: wantsHeaders });
    // "Add a Volleyball header" once turned a birthday-party email into a
    // volleyball one. A header request keeps the email's own headline,
    // subject, opening and graphic unless it names them.
    if (wantsHeaders && !/\b(subject|headline|intro|opening|first paragraph|body|rewrite|graphic|photo|button)\b/i.test(instruction || "")) {
      Object.assign(patch, { headline: item.headline, body: item.body, cta_text: item.cta_text, email_subject: item.email_subject, email_preheader: item.email_preheader, graphic: item.graphic });
    }
    patch.email_html = buildEmail({ ...item, ...patch }).html;
  }
  if (patch.graphic && (patch.graphic.photo_url !== item.graphic?.photo_url || patch.graphic.headline !== item.graphic?.headline)) { patch.asset_url = null; patch.asset_story_url = null; }
  return { patch, model: r.model, error: null };
}

// A director's rule in plain words -> the lines it keeps apart, if it is that
// kind of rule ("Don't combine sport programming and birthday parties"
// -> sports | parties). Falls back to a keyword reading without Claude.
const RULE_SCHEMA = { type: "object", additionalProperties: false, required: ["keeps_apart", "side_a", "side_b"], properties: {
  keeps_apart: { type: "boolean" }, side_a: { type: "array", items: { type: "string", enum: LINES.map(l => l.key) } }, side_b: { type: "array", items: { type: "string", enum: LINES.map(l => l.key) } } } };
export async function interpretRule(text) {
  const t = String(text || "").trim().slice(0, 300);
  if (!t) return null;
  if (!aiReady()) return guessApart(t);
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 30000, maxRetries: 1 });
    const msg = await client.beta.messages.create({
      model: AI_MODEL, max_tokens: 2000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: RULE_SCHEMA } },
      system: `Dripping Springs Sports Club's marketing has these program lines: ${LINES.map(l => `${l.key} (${l.label})`).join(", ")}. Volleyball, basketball, Reach Performance and Camp Elevate are the sport programming. A director wrote a rule for the club's posts and emails. If the rule says two groups of lines must not appear together in the same post, story or email, set keeps_apart and list the two sides; otherwise keeps_apart is false and both sides are empty.`,
      messages: [{ role: "user", content: t }],
    });
    if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") return guessApart(t);
    const j = JSON.parse((msg.content || []).filter(b => b.type === "text").map(b => b.text).join(""));
    return j.keeps_apart && j.side_a.length && j.side_b.length ? [j.side_a, j.side_b] : null;
  } catch { return guessApart(t); }
}
