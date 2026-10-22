// The DSSC Marketing Machine's planner: which program lines get the week's
// social posts, the weekly email and the occasional text, and why. Pure ESM,
// no I/O - imported by api/marketing*.js (generate, cron) and by the HQ
// Marketing screen (Plan & flow tab), so both show the same plan.
//
// Inputs are the public programs feed (https://www.drippingsportsclub.com/api/programs),
// the director's priorities (mkt_priorities), settings (mkt_settings: weights,
// cadence) and history (mkt_items from the previous 4 weeks). Dates are
// 'YYYY-MM-DD' strings in Central time; date math is done on UTC midnights so
// it never drifts with the server's time zone.
//
// Scoring per line (see planWeek):
//   weight (settings)                       base share of attention
//   + priority boost                        first listed line of an active priority: priority weight x 2;
//                                           the other listed lines: priority weight; avoid_lines: - weight x 2
//   + signal urgency (0..5)                 the most urgent program signal on the line; a priority's
//                                           first line counts at least the priority's weight
//   - fatigue                               used 2+ times on social in the last 2 weeks (not while a
//                                           priority lists the line)
//   + rotation debt                         +2 when the line hasn't been seen in 3+ weeks
// Parties, rentals and open gym are evergreen: one of them is put in every
// week in rotation, and any that would otherwise go 3 weeks unseen is forced.
//
// Two ways to lay out the week's social posts (settings.cadence.social.mode):
//   "rhythm" (default) - the club's own calendar (Annual_Marketing_Table.xlsx):
//     each day belongs to a line or a set of lines - Mon basketball, Wed Reach /
//     parties / camp / rentals / open gym, Thu volleyball - and a story the next
//     day follows up each spotlight, breaking it out program by program
//     ("don't simply repost Monday"). The scores above pick the line on days
//     that allow several, and which program each post is about. An active
//     priority (weight 4+) gets its headline line onto a day that lists it, or
//     takes over the weakest day when none does; "less X" opens X's day to the
//     other lines. The last week of a month adds a "what's coming in <month>"
//     preview post.
//   "balance" - the original: per_week posts on cadence days, best lines first.
// Email: the weekly roundup ("what's happening now + what's coming"), plus a
// dedicated email on one line when a priority asks for it or a line in
// cadence.email.dedicated_lines is due (at most dedicated_per_month).
// Every post carries a theme - a content idea for its line from the
// calendar's notes (DEFAULT_THEMES), or the directors' own (settings.themes).

export const LINES = [
  { key: "volleyball",   label: "Volleyball",        color: "#0F8B76" },
  { key: "basketball",   label: "Basketball",        color: "#FF7300" },
  { key: "reach",        label: "Reach Performance", color: "#B2D049" },
  { key: "camp_elevate", label: "Camp Elevate",      color: "#F2C230" },
  { key: "parties",      label: "Birthday parties",  color: "#E86FA6" },
  { key: "rentals",      label: "Court rentals",     color: "#5FA8D3" },
  { key: "open_gym",     label: "Open gym",          color: "#a9b7b1" },
  { key: "club",         label: "The club",          color: "#F4F0E8" },
];
export const LINE_KEYS = LINES.map(l => l.key);
export const lineLabel = (k) => (LINES.find(l => l.key === k) || {}).label || String(k || "");

export const DEFAULT_WEIGHTS = { volleyball: 3, basketball: 3, reach: 2, camp_elevate: 2, parties: 2, rentals: 1, open_gym: 1, club: 1 };

// The week from the club's marketing calendar. A `follow` entry is a story
// that follows up the post made on that day.
export const DEFAULT_RHYTHM = [
  { day: "mon", lines: ["basketball"], format: "post" },
  { day: "tue", follow: "mon", format: "story" },
  { day: "wed", lines: ["reach", "parties", "camp_elevate", "rentals", "open_gym"], format: "post" },
  { day: "thu", lines: ["volleyball"], format: "post" },
  { day: "fri", follow: "thu", format: "story" },
];

export const DEFAULT_CADENCE = {
  social: { mode: "rhythm", rhythm: DEFAULT_RHYTHM, month_preview: true, preview_day: "sat", per_week: 4, days: ["mon", "wed", "fri", "sat"], time: "18:30" },
  email: { day: "tue", time: "07:30", dedicated_per_month: 2, dedicated_day: "fri", dedicated_lines: ["parties", "reach"] },
  sms: { per_month: 2, time: "17:30" },
};

// Content ideas per line, from the notes in the club's marketing calendar.
// Ideas the machine can write from the programs feed alone; anything that
// needs footage or a person (a Q&A, a staff interview) stays a director's job.
export const DEFAULT_THEMES = {
  volleyball: [
    "Break it out by who it's for: younger beginners, developing youth players and adults - each to the program that fits them.",
    "What's next in volleyball: the programs families can still join this season.",
    "Pods: small-group, position-specific development with a low athlete-to-coach ratio.",
    "Women's Academy: for women who want to learn, return to the game, get a workout or simply play again. Beginner and intermediate friendly.",
  ],
  basketball: [
    "Multiple ways to train this season: clinics, 3v3 and pods - then register.",
    "Sell the why of 3v3: more touches, decision-making, spacing, reads and live game reps.",
    "Weekly Skill Lab and Shooting Lab: consistent development, high reps - shooting, ball handling, finishing, game-ready skills.",
    "Need a team? Individual registration and team or coach requests are welcome.",
  ],
  reach: [
    "Sell the why: strength, speed, explosiveness, movement and performance - not just \"we offer training\".",
    "Training that complements their sport season.",
    "Answer one question parents ask about speed and strength training for young athletes.",
  ],
  camp_elevate: [
    "Three days of activity when school's out - pick one day or all three.",
    "What a day at Camp Elevate looks like: every sport, games, friends, a full day of moving.",
  ],
  parties: [
    "POV: you're a kid at a DSSC birthday party.",
    "A place to actually DO something for a birthday - host-led activities, not another generic party venue.",
    "Fall and holiday birthdays: book the date early.",
  ],
  rentals: [
    "Need a court? Teams, practices and pickup games - book online.",
    "Your team's home court for the season: regular practice times at the Warehouse.",
  ],
  open_gym: [
    "Open gym: come play this week.",
  ],
  club: [
    "What's happening now and what's coming at DSSC.",
    "A motivational line for athletes and their families.",
    "Thank the families who make DSSC what it is - where Dripping Springs plays.",
  ],
};
export const KINDS = ["post", "story", "follow_up", "preview", "roundup", "dedicated", "text"];
export const KIND_LABEL = { post: "Post", story: "Story", follow_up: "Follow-up story", preview: "Month preview", roundup: "Weekly email", dedicated: "Dedicated email", text: "Text" };
const STORY_PLATFORMS = ["instagram_story", "facebook_story"];
const POST_PLATFORMS = ["facebook", "instagram"];

const SITE = "https://www.drippingsportsclub.com";
const PB = "https://drippingsports.playbookapi.com/programs";
// page = the public page on the club site; book = where a family signs up / books.
export const LINE_LINKS = {
  volleyball:   { page: `${SITE}/volleyball`,        book: `${PB}/register/volleyball/`,        cta: "See volleyball programs" },
  basketball:   { page: `${SITE}/basketball`,        book: `${PB}/register/basketball/`,        cta: "See basketball programs" },
  reach:        { page: `${SITE}/reach-performance`, book: `${PB}/register/reach_performance/`, cta: "Train with Reach" },
  camp_elevate: { page: `${SITE}/camp-elevate`,      book: `${PB}/more_info/class_package/78326/`, cta: "Sign up for Camp Elevate" },
  parties:      { page: `${SITE}/parties`,           book: `${PB}/rentals/?resource_type=resource_group&resource_group_pks=175,176`, cta: "Book a party" },
  rentals:      { page: `${SITE}/rentals`,           book: `${PB}/rentals/?resource_type=resource_group&resource_group_pks=103,101`, cta: "Book a court" },
  open_gym:     { page: `${SITE}/open-gym`,          book: null,                                cta: "See open gym times" },
  club:         { page: `${SITE}/programs`,          book: `${PB}/register/`,                   cta: "See what's coming up" },
};
// The link an item's call to action uses for a line with no specific program.
export const lineUrl = (line) => { const l = LINE_LINKS[line] || LINE_LINKS.club; return l.book || l.page; };

const EVERGREEN = ["parties", "rentals", "open_gym"];
const DATED = ["camp_elevate"]; // lines that exist only around their program dates
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// ── dates ────────────────────────────────────────────────────────────────────
const toD = (s) => new Date(String(s).slice(0, 10) + "T00:00:00Z");
const ymd = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
export const daysBetween = (a, b) => Math.round((toD(b) - toD(a)) / 864e5);
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").slice(0, 10));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const fmtDay = (s) => { if (!isYmd(s)) return ""; const d = toD(s); return `${DOW[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };

// The Monday of the week a date falls in (weeks run Monday-Sunday).
export function mondayOf(dateStr) {
  const s = dateStr instanceof Date ? ymd(dateStr) : String(dateStr || "").slice(0, 10);
  if (!isYmd(s)) return "";
  const back = (toD(s).getUTCDay() + 6) % 7;
  return addDays(s, -back);
}

// ── lines ────────────────────────────────────────────────────────────────────
// Which marketing line a feed program belongs to.
export function lineOf(p) {
  const name = String(p?.name || ""), kind = String(p?.kind || "").toLowerCase(), sport = String(p?.sport || "").toLowerCase();
  const all = `${name} ${p?.category || ""}`;
  if (/camp\s*elevate/i.test(all)) return "camp_elevate";
  if (kind === "open-gym" || /open\s*gym/i.test(all)) return "open_gym";
  if (/birthday|\bpart(y|ies)\b/i.test(all)) return "parties";
  if (/\brental|court\s*rent/i.test(all)) return "rentals";
  if (sport === "volleyball" || sport === "basketball" || sport === "reach") return sport;
  if (/volley/i.test(all)) return "volleyball";
  if (/basket|hoops|3v3|4th\s*quarter/i.test(all)) return "basketball";
  if (/\breach\b/i.test(all)) return "reach";
  return "club";
}

// What a slot / item carries about its program (mkt_items.program).
export function programRef(p) {
  if (!p) return null;
  const line = lineOf(p);
  return {
    id: String(p.id ?? ""), name: p.name || "", url: p.register_url || p.sport_url || lineUrl(line),
    first_date: p.first_date || null, last_date: p.last_date || null, status: p.status || null, sport: p.sport || null,
    line, kind: p.kind || null, ages: p.ages || null, days: Array.isArray(p.days) ? p.days : [], time: p.time || null,
  };
}

// ── signals ──────────────────────────────────────────────────────────────────
// [{ line, program, angle, urgency 0..5, reason }], most urgent first.
//   starts in 0-7 days   -> last_call      (5)
//   starts in 8-21 days  -> starting_soon  (4 within two weeks, else 3)
//   started 1-7 days ago -> just_started   (3)
//   is_new (otherwise)   -> new            (2)   [just_started once it has begun]
//   ongoing              -> evergreen      (1)
// Programs that ended before `today`, or are mid-run and not ongoing, give no signal.
export function signalsFor(programs, today) {
  const out = [];
  if (!isYmd(today)) return out;
  for (const p of programs || []) {
    if (!p || !isYmd(p.first_date)) continue;
    const end = isYmd(p.last_date) ? p.last_date : p.first_date;
    if (end < today) continue;
    const line = lineOf(p);
    const d = daysBetween(today, p.first_date);
    const when = fmtDay(p.first_date);
    let angle = null, urgency = 0, reason = "";
    if (d >= 0 && d <= 7) { angle = "last_call"; urgency = 5; reason = d === 0 ? `${p.name} starts today` : `${p.name} starts ${when} (${d} day${d === 1 ? "" : "s"} out)`; }
    else if (d > 7 && d <= 21) { angle = "starting_soon"; urgency = d <= 14 ? 4 : 3; reason = `${p.name} starts ${when} (${d} days out)`; }
    else if (d < 0 && d >= -7) { angle = "just_started"; urgency = 3; reason = `${p.name} just started (${when})`; }
    else if (p.is_new) { angle = d < 0 ? "just_started" : "new"; urgency = 2; reason = `${p.name} is new on the schedule`; }
    else if (p.ongoing) { angle = "evergreen"; urgency = 1; reason = `${p.name} runs year-round`; }
    if (angle) out.push({ line, program: p, angle, urgency, reason });
  }
  return out.sort((a, b) => b.urgency - a.urgency || String(a.program.first_date).localeCompare(String(b.program.first_date)) || String(a.program.name).localeCompare(String(b.program.name)));
}

// ── settings / priorities / history ──────────────────────────────────────────
function normSettings(s) {
  const st = s || {};
  const w = { ...DEFAULT_WEIGHTS };
  for (const [k, v] of Object.entries(st.weights || {})) if (LINE_KEYS.includes(k) && Number.isFinite(+v)) w[k] = Math.max(0, +v);
  const c = st.cadence || {};
  const cadence = {
    social: { ...DEFAULT_CADENCE.social, ...(c.social || {}) },
    email: { ...DEFAULT_CADENCE.email, ...(c.email || {}) },
    sms: { ...DEFAULT_CADENCE.sms, ...(c.sms || {}) },
  };
  cadence.social.per_week = Math.max(0, Math.min(14, Math.round(+cadence.social.per_week || 0)));
  cadence.social.days = (Array.isArray(cadence.social.days) ? cadence.social.days : []).map(d => String(d).slice(0, 3).toLowerCase()).filter(d => DAY_KEYS.includes(d));
  if (!cadence.social.days.length) cadence.social.days = DEFAULT_CADENCE.social.days.slice();
  cadence.social.days.sort((a, b) => DAY_KEYS.indexOf(a) - DAY_KEYS.indexOf(b));
  cadence.sms.per_month = Math.max(0, Math.round(+cadence.sms.per_month || 0));
  cadence.social.mode = cadence.social.mode === "balance" ? "balance" : "rhythm";
  cadence.social.rhythm = normRhythm(cadence.social.rhythm);
  cadence.social.preview_day = DAY_KEYS.includes(cadence.social.preview_day) ? cadence.social.preview_day : "sat";
  cadence.email.dedicated_per_month = Math.max(0, Math.min(8, Math.round(+cadence.email.dedicated_per_month || 0)));
  cadence.email.dedicated_day = DAY_KEYS.includes(cadence.email.dedicated_day) ? cadence.email.dedicated_day : "fri";
  cadence.email.dedicated_lines = (Array.isArray(cadence.email.dedicated_lines) ? cadence.email.dedicated_lines : []).filter(l => LINE_KEYS.includes(l));
  return { weights: w, cadence, emailOn: cadence.email.day !== "off" && cadence.email.enabled !== false, themes: normThemes(st.themes) };
}

// A rhythm entry: { day, lines: [line] (empty = any line), format: post|story,
// time? } or a follow-up story { day, follow: <day of the post it follows>,
// format: story }. Unknown days / lines are dropped; a follow-up whose post
// isn't earlier in the week is dropped too.
export function normRhythm(r) {
  const src = Array.isArray(r) && r.length ? r : DEFAULT_RHYTHM;
  const out = [];
  for (const e of src.slice(0, 14)) {
    const day = String(e?.day || "").slice(0, 3).toLowerCase();
    if (!DAY_KEYS.includes(day)) continue;
    const time = /^\d{2}:\d{2}$/.test(String(e?.time || "")) ? e.time : undefined;
    if (e?.follow) {
      const f = String(e.follow).slice(0, 3).toLowerCase();
      if (DAY_KEYS.indexOf(f) >= 0 && DAY_KEYS.indexOf(f) < DAY_KEYS.indexOf(day)) out.push({ day, follow: f, format: "story", ...(time ? { time } : {}) });
      continue;
    }
    const lines = (Array.isArray(e?.lines) ? e.lines : []).filter(l => LINE_KEYS.includes(l));
    out.push({ day, lines: [...new Set(lines)], format: e?.format === "story" ? "story" : "post", ...(time ? { time } : {}) });
  }
  out.sort((a, b) => DAY_KEYS.indexOf(a.day) - DAY_KEYS.indexOf(b.day));
  return out.filter(e => !e.follow || out.some(m => !m.follow && m.day === e.follow));
}

// settings.themes over DEFAULT_THEMES, line by line (an empty list = defaults).
export function normThemes(t) {
  const out = {};
  for (const l of LINE_KEYS) {
    const own = Array.isArray(t?.[l]) ? t[l].map(x => String(x || "").trim()).filter(Boolean).slice(0, 20) : [];
    out[l] = own.length ? own : (DEFAULT_THEMES[l] || []);
  }
  return out;
}
const weekNo = (weekOf) => Math.floor(daysBetween("2026-01-05", weekOf) / 7);
// The idea a line's n-th post this week uses; rotates week to week.
function themeFor(themes, line, weekOf, n = 0) {
  const ideas = themes[line] || [];
  return ideas.length ? ideas[((weekNo(weekOf) + n) % ideas.length + ideas.length) % ideas.length] : null;
}
const DAY_NAME = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Priorities in effect for a week (any overlap with Monday-Sunday) on a channel.
function activePriorities(priorities, weekOf, channel) {
  const end = addDays(weekOf, 6);
  return (priorities || []).filter(p => p && p.active !== false
    && (!p.starts_on || String(p.starts_on).slice(0, 10) <= end)
    && (!p.ends_on || String(p.ends_on).slice(0, 10) >= weekOf)
    && (!channel || !Array.isArray(p.channels) || !p.channels.length || p.channels.includes(channel)))
    .map(p => ({ ...p, weight: Math.max(1, Math.min(5, Math.round(+p.weight || 3))), lines: (p.lines || []).filter(l => LINE_KEYS.includes(l)), avoid_lines: (p.avoid_lines || []).filter(l => LINE_KEYS.includes(l)) }));
}

const counted = (h) => h && h.status !== "rejected" && LINE_KEYS.includes(h.line);
// Weeks since a line last appeared (on `channel`, or any channel when null).
// Never seen: as old as the history goes, plus one; no history at all: 2.
function weeksSince(history, line, weekOf, channel) {
  let last = null, earliest = null;
  for (const h of history || []) {
    if (!counted(h) || !isYmd(h.week_of) || h.week_of >= weekOf) continue;
    if (!earliest || h.week_of < earliest) earliest = h.week_of;
    if (h.line === line && (!channel || h.channel === channel) && (!last || h.week_of > last)) last = h.week_of;
  }
  if (last) return Math.round(daysBetween(last, weekOf) / 7);
  if (earliest) return Math.round(daysBetween(earliest, weekOf) / 7) + 1;
  return 2;
}

// ── the week ─────────────────────────────────────────────────────────────────
const DECAY = 6; // what a second post on the same line in one week costs its score

function lineScores({ weekOf, ref, programs, prios, weights, history, channel, signals }) {
  const scores = {}, why = {};
  const twoWeeksAgo = addDays(weekOf, -14);
  for (const line of LINE_KEYS) {
    const w = weights[line] ?? 0;
    const parts = [];
    let s = w, boost = 0, urg = 0, inPriority = false;
    for (const pr of prios) {
      const i = pr.lines.indexOf(line);
      if (i === 0) { boost += pr.weight * 2; inPriority = true; urg = Math.max(urg, pr.weight); parts.push(`priority "${pr.title}" (first line, +${pr.weight * 2})`); }
      else if (i > 0) { boost += pr.weight; inPriority = true; parts.push(`priority "${pr.title}" (+${pr.weight})`); }
      if (pr.avoid_lines.includes(line)) { boost -= pr.weight * 2; parts.push(`priority "${pr.title}" says less of this (-${pr.weight * 2})`); }
    }
    const top = signals.find(sg => sg.line === line);
    if (top && top.urgency > urg) urg = top.urgency;
    s += boost + urg;
    let fatigue = 0;
    if (channel === "social" && !inPriority) {
      const uses = (history || []).filter(h => counted(h) && h.channel === "social" && h.line === line && h.week_of >= twoWeeksAgo && h.week_of < weekOf).length;
      if (uses >= 2) { fatigue = (uses - 1) * 2; parts.push(`posted ${uses}x in the last 2 weeks (-${fatigue})`); }
    }
    s -= fatigue;
    const since = weeksSince(history, line, weekOf, channel === "email" ? null : channel);
    if (since >= 3) { s += 2; parts.push(`not seen in ${since} weeks (+2)`); }
    if (top) parts.unshift(top.reason);
    scores[line] = w <= 0 ? -99 : Math.round(s * 10) / 10;
    why[line] = parts;
  }
  return { scores, why };
}

// The program a slot on `line` is about: the most urgent signal not yet used
// this week, else the line's next program that hasn't started, else null.
function pickProgram(line, signals, programs, used, ref) {
  const sig = signals.find(s => s.line === line && !used.has(String(s.program.id)) && s.angle !== "evergreen")
    || signals.find(s => s.line === line && !used.has(String(s.program.id)));
  if (sig) return { program: sig.program, angle: sig.angle, reason: sig.reason, urgency: sig.urgency };
  const next = (programs || []).filter(p => lineOf(p) === line && isYmd(p.first_date) && p.first_date >= ref && !used.has(String(p.id)))
    .sort((a, b) => a.first_date.localeCompare(b.first_date))[0];
  if (next) return { program: next, angle: null, reason: `${next.name} starts ${fmtDay(next.first_date)}`, urgency: 0 };
  return null;
}

function socialDays(weekOf, cadence, n, today) {
  const days = cadence.social.days.map(k => addDays(weekOf, DAY_KEYS.indexOf(k)));
  if (!n) return [];
  const out = [];
  if (n <= days.length) {
    for (let i = 0; i < n; i++) out.push(days[Math.floor(i * days.length / n)]);
  } else {
    for (let i = 0; i < n; i++) out.push(days[i % days.length]);
    out.sort();
  }
  return today ? out.filter(d => d >= today) : out;
}

// planWeek({ weekOf, programs, priorities, settings, history, today? })
//   -> { slots: [{ channel, platforms?, day, time, line, program|null, programs?, evergreen?, angle, reason }],
//        scores: { line: number }   (social scores),
//        notes: [string] }
// `today` (optional): signals are measured from max(weekOf, today) and slots
// before today are dropped - pass it when planning the current week.
export function planWeek({ weekOf, programs = [], priorities = [], settings = {}, history = [], today = null } = {}) {
  weekOf = mondayOf(weekOf);
  if (!weekOf) return { slots: [], scores: {}, notes: ["No week given"] };
  const { weights, cadence, emailOn, themes } = normSettings(settings);
  const ref = today && isYmd(today) && today > weekOf ? today : weekOf;
  const live = (programs || []).filter(p => p && isYmd(p.first_date) && ((isYmd(p.last_date) ? p.last_date : p.first_date) >= weekOf));
  const signals = signalsFor(live, ref);
  const notes = [];
  const slots = [];
  // A dated line (Camp Elevate) is only posted on days before one of its
  // programs starts - never after camp is over, never with no camp on the books.
  const lastDay = {};
  for (const l of DATED) lastDay[l] = live.filter(p => lineOf(p) === l).map(p => p.first_date).sort().pop() || "";
  const allowedOn = (l, day) => !DATED.includes(l) || (lastDay[l] && day <= lastDay[l]);

  // ── social ──
  const sPrios = activePriorities(priorities, weekOf, "social");
  for (const pr of sPrios) notes.push(`Priority in effect: "${pr.title}" (weight ${pr.weight}) - ${pr.lines.map(lineLabel).join(", ") || "no lines"}${pr.avoid_lines.length ? `; less ${pr.avoid_lines.map(lineLabel).join(", ")}` : ""}`);
  const { scores, why } = lineScores({ weekOf, ref, programs: live, prios: sPrios, weights, history, channel: "social", signals });
  if (cadence.social.mode === "rhythm") {
    const r = rhythmSocial({ weekOf, ref, today, live, signals, sPrios, scores, why, cadence, themes, allowedOn });
    slots.push(...r.slots); notes.push(...r.notes);
  } else balanceSocial();
  function balanceSocial() {
  const days = socialDays(weekOf, cadence, cadence.social.per_week, today && today > weekOf ? today : null);
  const n = days.length;
  const maxPer = Math.max(1, Math.ceil(n / 2));
  const picks = [];           // line keys (multiset)
  const forcedWhy = {};
  if (n >= 2) {
    const ever = EVERGREEN.filter(l => (weights[l] ?? 0) > 0).map(l => ({ l, since: weeksSince(history, l, weekOf, "social") }))
      .sort((a, b) => b.since - a.since || (weights[b.l] ?? 0) - (weights[a.l] ?? 0) || EVERGREEN.indexOf(a.l) - EVERGREEN.indexOf(b.l));
    const hard = ever.filter(e => e.since >= 3).slice(0, n >= 4 ? 2 : 1);
    const forced = hard.length ? hard : ever.filter(e => e.since >= 2).slice(0, 1);
    for (const e of forced) { picks.push(e.l); forcedWhy[e.l] = `${lineLabel(e.l)} is evergreen and due (${e.since >= 3 ? `${e.since} weeks unseen` : "rotation"})`; }
    if (forced.length) notes.push(`Evergreen rotation: ${forced.map(e => lineLabel(e.l)).join(", ")} this week`);
  }
  const slotsFor = (l) => days.filter(d => allowedOn(l, d)).length;
  const count = (l) => picks.filter(x => x === l).length;
  for (const l of [...picks]) if (!slotsFor(l)) picks.splice(picks.indexOf(l), 1);
  while (picks.length < n) {
    const best = LINE_KEYS.filter(l => scores[l] > -50 && count(l) < Math.min(maxPer, slotsFor(l)))
      .map(l => ({ l, s: scores[l] - count(l) * DECAY }))
      .sort((a, b) => b.s - a.s || scores[b.l] - scores[a.l] || LINE_KEYS.indexOf(a.l) - LINE_KEYS.indexOf(b.l))[0];
    if (!best) break;
    picks.push(best.l);
  }
  // Order: best line first, never the same line twice in a row.
  const remaining = {}; for (const l of picks) remaining[l] = (remaining[l] || 0) + 1;
  const byScore = (a, b) => scores[b] - scores[a] || LINE_KEYS.indexOf(a) - LINE_KEYS.indexOf(b);
  const order = [];
  for (let i = 0; i < picks.length; i++) {
    const left = picks.length - i, prev = order[order.length - 1];
    let cands = Object.keys(remaining).filter(l => remaining[l] > 0 && l !== prev && allowedOn(l, days[i]));
    if (!cands.length) cands = LINE_KEYS.filter(l => l !== prev && scores[l] > -50 && allowedOn(l, days[i])).sort(byScore).slice(0, 1);
    if (!cands.length) break;
    // A dated line running out of days goes first; then a line that would
    // otherwise be forced into back-to-back slots; then the best score.
    const must = cands.filter(l => remaining[l] > 0 && DATED.includes(l) && remaining[l] >= days.slice(i).filter(d => allowedOn(l, d)).length)[0]
      || cands.find(l => remaining[l] * 2 > left);
    const l = must || cands.sort(byScore)[0];
    order.push(l); if (remaining[l]) remaining[l]--;
  }
  const usedPrograms = new Set();
  const lineUses = {};
  order.forEach((line, i) => {
    lineUses[line] = (lineUses[line] || 0) + 1;
    const ref_i = days[i] > ref ? days[i] : ref;
    let pick = pickProgram(line, signals, live.filter(p => !DATED.includes(line) || p.first_date >= days[i]), usedPrograms, ref_i);
    let again = false;
    if (!pick?.program && lineUses[line] > 1) { pick = pickProgram(line, signals, live.filter(p => p.first_date >= days[i]), new Set(), ref_i); again = !!pick?.program; }
    if (pick?.program && DATED.includes(line) && pick.program.first_date < days[i]) pick = null;
    const pr = sPrios.find(p => p.lines.includes(line));
    let angle = again ? "reminder" : (pick?.angle || (pr ? "priority" : "evergreen"));
    if (pick?.program) usedPrograms.add(String(pick.program.id));
    if (lineUses[line] > 1 && !pick?.angle && !again) angle = pr ? "priority" : "reminder";
    const reason = [forcedWhy[line] && lineUses[line] === 1 ? forcedWhy[line] : null, pr ? `Priority "${pr.title}"` : null, again ? `second post this week on ${lineLabel(line)}` : null, pick?.reason, ...(why[line] || []).filter(w => !/^priority|starts|started|is new|runs year/.test(w))]
      .filter(Boolean).filter((v, j, a) => a.indexOf(v) === j).join(" · ") || `${lineLabel(line)} - balance (weight ${weights[line]})`;
    slots.push({ channel: "social", kind: "post", format: "post", platforms: POST_PLATFORMS.slice(), day: days[i], time: cadence.social.time, line, program: programRef(pick?.program), angle, reason, theme: themeFor(themes, line, weekOf, lineUses[line] - 1) });
  });
  }

  // ── email ──
  const ePrios = activePriorities(priorities, weekOf, "email");
  const eDay = addDays(weekOf, Math.max(0, DAY_KEYS.indexOf(String(cadence.email.day).slice(0, 3))));
  const ded = emailOn ? dedicatedEmail({ weekOf, ref, today, live, signals, ePrios, history, cadence, themes, allowedOn }) : { slot: null, note: null };
  if (ded.slot) slots.push(ded.slot);
  if (ded.note) notes.push(ded.note);
  if (emailOn && DAY_KEYS.includes(String(cadence.email.day).slice(0, 3)) && (!today || eDay >= today)) {
    const { scores: es } = lineScores({ weekOf, ref, programs: live, prios: ePrios, weights, history, channel: "email", signals });
    // The roundup leads with something other than this week's dedicated email.
    const featured = LINE_KEYS.filter(l => l !== "club" && l !== ded.slot?.line && es[l] > -50 && allowedOn(l, eDay) && (!EVERGREEN.includes(l) || ePrios.some(p => p.lines[0] === l))).sort((a, b) => es[b] - es[a] || LINE_KEYS.indexOf(a) - LINE_KEYS.indexOf(b))[0] || "club";
    const fpick = pickProgram(featured, signals, live, new Set(), ref);
    const soon = signals.filter(s => ["last_call", "starting_soon", "new", "just_started"].includes(s.angle));
    const list = [];
    const seen = new Set(fpick?.program ? [String(fpick.program.id)] : []);
    const ep = ePrios.find(p => p.lines[0] === featured) || ePrios.find(p => p.lines.includes(featured));
    if (fpick?.program) list.push({ ...programRef(fpick.program), angle: fpick.angle || (ep ? "priority" : "evergreen") });
    // One per line first (variety), then fill to 4 by urgency.
    for (const pass of [0, 1]) for (const s of soon) {
      if (list.length >= 4) break;
      const id = String(s.program.id);
      if (seen.has(id)) continue;
      if (pass === 0 && list.some(x => x.line === s.line)) continue;
      if (pass === 0 && !["last_call", "starting_soon"].includes(s.angle)) continue;
      seen.add(id); list.push({ ...programRef(s.program), angle: s.angle });
    }
    // The evergreen line the email closes with rotates week by week.
    const evOn = EVERGREEN.filter(l => (weights[l] ?? 0) > 0 && l !== featured);
    const ever = evOn.length ? evOn[Math.floor(daysBetween("2026-01-05", weekOf) / 7) % evOn.length] : null;
    slots.push({
      channel: "email", kind: "roundup", day: eDay, time: cadence.email.time, line: featured, program: programRef(fpick?.program), programs: list, evergreen: ever,
      angle: fpick?.angle || (ep ? "priority" : "evergreen"),
      reason: [ep ? `Priority "${ep.title}"` : `Top line this week: ${lineLabel(featured)}`, fpick?.reason, list.length > 1 ? `${list.length} programs starting soon` : null, ever ? `plus ${lineLabel(ever)}` : null].filter(Boolean).join(" · "),
    });
  }

  // ── sms ──
  const sms = smsSlot({ weekOf, ref, today, live, signals, priorities, history, cadence, plannedSms: [] });
  if (sms.slot) slots.push(sms.slot);
  if (sms.note) notes.push(sms.note);

  slots.sort((a, b) => a.day.localeCompare(b.day) || ["email", "social", "sms"].indexOf(a.channel) - ["email", "social", "sms"].indexOf(b.channel));
  return { slots, scores, notes };
}

// ── the calendar's rhythm ────────────────────────────────────────────────────
// -> { slots, notes }. Lines are assigned to every post of the week (so a
// follow-up knows what it follows), but only days from `today` on are planned.
function rhythmSocial({ weekOf, ref, today, live, signals, sPrios, scores, why, cadence, themes, allowedOn }) {
  const notes = [], slots = [];
  const entries = cadence.social.rhythm.map(e => ({ ...e, date: addDays(weekOf, DAY_KEYS.indexOf(e.day)) }));
  const main = entries.filter(e => !e.follow);
  const avoid = new Set(sPrios.flatMap(p => p.avoid_lines));
  const usable = (l, e) => scores[l] > -50 && allowedOn(l, e.date);
  const own = (e) => (e.lines.length ? e.lines : LINE_KEYS).filter(l => usable(l, e));
  const assign = new Map();                 // entry -> { line, why }
  const used = (l) => [...assign.values()].filter(a => a.line === l).length;

  // 1. Priorities (weight 4+) first: the headline line goes on a day that
  //    lists it (the most flexible one); with none, it takes over the day
  //    whose own best line scores lowest.
  for (const pr of sPrios.slice().sort((a, b) => b.weight - a.weight)) {
    const L = pr.lines[0];
    if (!L || pr.weight < 4 || used(L) || avoid.has(L)) continue;
    const free = main.filter(e => !assign.has(e) && allowedOn(L, e.date));
    const natural = free.filter(e => e.lines.includes(L)).sort((a, b) => b.lines.length - a.lines.length)[0]
      || free.filter(e => !e.lines.length)[0];
    if (natural) { assign.set(natural, { line: L, why: `Priority "${pr.title}"` }); continue; }
    const weakest = free.map(e => ({ e, best: Math.max(-99, ...own(e).map(l => scores[l])) })).sort((a, b) => a.best - b.best)[0];
    if (weakest) assign.set(weakest.e, { line: L, why: `Priority "${pr.title}" takes ${DAY_NAME[weakest.e.day]}'s spot` });
  }
  // 2. Every other day: its best line, a repeat costing DECAY, never the same
  //    line as the post before. A day whose lines are all "less of" opens up.
  let prev = null;
  for (const e of main) {
    if (assign.has(e)) { prev = assign.get(e).line; continue; }
    let cands = own(e).filter(l => !avoid.has(l));
    let opened = false;
    if (!cands.length) { cands = LINE_KEYS.filter(l => usable(l, e) && !avoid.has(l)); opened = !!e.lines.length; }
    const best = cands.map(l => ({ l, s: scores[l] - used(l) * DECAY - (l === prev ? 50 : 0) }))
      .sort((a, b) => b.s - a.s || LINE_KEYS.indexOf(a.l) - LINE_KEYS.indexOf(b.l))[0];
    if (!best) { notes.push(`${DAY_NAME[e.day]}: nothing to post`); continue; }
    assign.set(e, { line: best.l, why: opened ? `${e.lines.map(lineLabel).join("/")} is on "less" this week` : e.lines.length > 1 ? `best of ${e.lines.map(lineLabel).join(", ")} this week` : null });
    prev = best.l;
  }
  notes.push("Weekly rhythm: " + entries.map(e => `${DAY_NAME[e.day]} ${e.follow ? "follow-up story" : assign.has(e) ? lineLabel(assign.get(e).line) + (e.format === "story" ? " story" : "") : "-"}`).join(" · "));

  // 3. Programs, angles, themes - post by post.
  const usedPrograms = new Set(), lineUses = {}, made = new Map();
  for (const e of main) {
    const a = assign.get(e);
    if (!a) continue;
    const line = a.line;
    lineUses[line] = (lineUses[line] || 0) + 1;
    const ref_i = e.date > ref ? e.date : ref;
    let pick = pickProgram(line, signals, live.filter(p => !DATED.includes(line) || p.first_date >= e.date), usedPrograms, ref_i);
    if (pick?.program && DATED.includes(line) && pick.program.first_date < e.date) pick = null;
    if (pick?.program) usedPrograms.add(String(pick.program.id));
    const pr = sPrios.find(p => p.lines.includes(line));
    const angle = pick?.angle || (pr ? "priority" : "evergreen");
    const reason = [`${DAY_NAME[e.day]} is ${e.lines.length ? e.lines.map(lineLabel).join("/") : "open"} on the calendar`, a.why, pr && !/^Priority/.test(a.why || "") ? `Priority "${pr.title}"` : null, pick?.reason,
      ...(why[line] || []).filter(w => !/^priority|starts|started|is new|runs year/.test(w))].filter(Boolean).filter((v, j, arr) => arr.indexOf(v) === j).join(" · ");
    const slot = {
      channel: "social", kind: e.format === "story" ? "story" : "post", format: e.format, platforms: (e.format === "story" ? STORY_PLATFORMS : POST_PLATFORMS).slice(),
      day: e.date, time: e.time || cadence.social.time, line, program: programRef(pick?.program), angle, reason, theme: themeFor(themes, line, weekOf, lineUses[line] - 1),
    };
    made.set(e.day, slot);
    if (!today || e.date >= today) slots.push(slot);
  }
  // 4. Follow-up stories: the same line, broken out program by program.
  for (const e of entries.filter(x => x.follow)) {
    const src = made.get(e.follow);
    if (!src || (today && e.date < today)) continue;
    const others = live.filter(p => lineOf(p) === src.line && String(p.id) !== String(src.program?.id || "") && (p.ongoing || (isYmd(p.last_date) ? p.last_date : p.first_date) >= e.date) && (!DATED.includes(src.line) || p.first_date >= e.date))
      .sort((a, b) => String(a.first_date).localeCompare(String(b.first_date))).slice(0, 3);
    slots.push({
      channel: "social", kind: "follow_up", format: "story", platforms: STORY_PLATFORMS.slice(), day: e.date, time: e.time || cadence.social.time,
      line: src.line, program: src.program, programs: [src.program, ...others.map(programRef)].filter(Boolean), angle: "follow_up", follows: e.follow,
      reason: `Follows up ${DAY_NAME[e.follow]}'s ${lineLabel(src.line)} post - break it out, don't repeat it`, theme: src.theme,
    });
  }
  // 5. The last week of the month previews the next one.
  if (cadence.social.month_preview !== false) {
    const d = addDays(weekOf, DAY_KEYS.indexOf(cadence.social.preview_day));
    const next = addDays(d, 7).slice(0, 7);
    if (next !== d.slice(0, 7) && (!today || d >= today)) {
      const mName = MONTHS[+next.slice(5, 7) - 1];
      const coming = live.filter(p => String(p.first_date).slice(0, 7) === next).sort((a, b) => a.first_date.localeCompare(b.first_date));
      const pickLines = []; const list = [];
      for (const p of coming) { if (list.length >= 4) break; const l = lineOf(p); if (pickLines.includes(l) && coming.some(q => !pickLines.includes(lineOf(q)))) continue; pickLines.push(l); list.push(programRef(p)); }
      for (const p of coming) { if (list.length >= 4) break; if (!list.some(x => x.id === String(p.id))) list.push(programRef(p)); }
      slots.push({
        channel: "social", kind: "preview", format: "post", platforms: POST_PLATFORMS.slice(), day: d, time: cadence.social.time, line: "club", program: null, programs: list,
        angle: "preview", reason: `Last week of the month: what's coming in ${mName}${coming.length ? ` (${coming.length} program${coming.length === 1 ? "" : "s"} start)` : ""}`,
        theme: `Month preview: what's coming at DSSC in ${mName} - holiday events, camps, what opens for registration.`,
      });
    }
  }
  return { slots, notes };
}

// A dedicated email on one line: a priority's headline line (no dedicated
// email on it in 14 days), else the next due line from dedicated_lines (none
// on it for 4 weeks). At most dedicated_per_month a calendar month.
function dedicatedEmail({ weekOf, ref, today, live, signals, ePrios, history, cadence, themes, allowedOn }) {
  const cap = cadence.email.dedicated_per_month;
  if (!cap) return { slot: null, note: null };
  const day = addDays(weekOf, DAY_KEYS.indexOf(cadence.email.dedicated_day));
  if (today && day < today) return { slot: null, note: null };
  const isDed = (h) => counted(h) && h.channel === "email" && h.kind === "dedicated";
  const lastOn = (l) => (history || []).filter(h => isDed(h) && h.line === l).map(h => String(h.scheduled_at || h.week_of).slice(0, 10)).sort().pop() || null;
  const month = day.slice(0, 7);
  const usedMonth = (history || []).filter(h => isDed(h) && monthOf(h) === month).length;
  if (usedMonth >= cap) return { slot: null, note: `Dedicated email skipped: ${usedMonth} of ${cap} this month already` };
  let line = null, reason = null, pr = null;
  for (const p of ePrios.slice().sort((a, b) => b.weight - a.weight)) {
    const L = p.lines[0];
    if (!L || p.weight < 4 || !allowedOn(L, day)) continue;
    const last = lastOn(L);
    if (last && daysBetween(last, day) < 14) continue;
    line = L; pr = p; reason = `Priority "${p.title}" - its own email`; break;
  }
  if (!line) {
    const due = cadence.email.dedicated_lines.filter(l => allowedOn(l, day)).map(l => ({ l, last: lastOn(l) }))
      .filter(x => !x.last || daysBetween(x.last, day) >= 28)
      .sort((a, b) => String(a.last || "").localeCompare(String(b.last || "")))[0];
    if (due) { line = due.l; reason = `${lineLabel(due.l)} is due its own email${due.last ? ` (last one ${fmtDay(due.last)})` : ""}`; }
  }
  if (!line) return { slot: null, note: null };
  const sigs = signals.filter(s => s.line === line);
  const lead = sigs.find(s => s.angle !== "evergreen") || sigs[0] || null;
  const list = [];
  for (const s of sigs) { if (list.length >= 4) break; list.push({ ...programRef(s.program), angle: s.angle }); }
  if (!list.length) for (const p of live.filter(p => lineOf(p) === line && p.first_date >= ref).sort((a, b) => a.first_date.localeCompare(b.first_date)).slice(0, 4)) list.push({ ...programRef(p), angle: "starting_soon" });
  return {
    slot: {
      channel: "email", kind: "dedicated", day, time: cadence.email.time, line, program: programRef(lead?.program) || (list[0] ? { ...list[0] } : null), programs: list, evergreen: null,
      angle: lead?.angle || (pr ? "priority" : "evergreen"), reason: [reason, lead?.reason].filter(Boolean).join(" · "), theme: themeFor(themes, line, weekOf, 1),
    },
    note: null,
  };
}

// A priority text is due on a week when the priority's first line has a
// program starting within two weeks of that Monday.
function priorityTextFor(priorities, weekOf, live) {
  for (const pr of activePriorities(priorities, weekOf, "sms")) {
    const line = pr.lines[0];
    if (!line) continue;
    const sig = signalsFor(live, weekOf).find(s => s.line === line && s.urgency >= 4);
    if (sig) return { pr, sig };
  }
  return null;
}

const monthOf = (h) => String(h.scheduled_at || h.day || h.week_of || "").slice(0, 7);

function smsSlot({ weekOf, ref, today, live, signals, priorities, history, cadence }) {
  const cap = cadence.sms.per_month;
  if (!cap) return { slot: null, note: null };
  const pri = priorityTextFor(priorities, weekOf, live);
  const lastCall = signals.find(s => s.angle === "last_call" && s.program.first_date >= ref && ["program", "camp", "clinic", "league", "academy", "tryout-prep"].includes(String(s.program.kind || "program")));
  let cand = null;
  if (pri) cand = { line: pri.pr.lines[0], program: pri.sig.program, angle: pri.sig.angle === "last_call" ? "last_call" : "priority", reason: `Priority "${pri.pr.title}" · ${pri.sig.reason}`, priority: true };
  else if (lastCall) cand = { line: lastCall.line, program: lastCall.program, angle: "last_call", reason: lastCall.reason, priority: false };
  if (!cand) return { slot: null, note: null };
  const fd = cand.program.first_date;
  let day = cand.angle === "last_call" ? addDays(fd, -2) : addDays(weekOf, 1);
  if (day < weekOf) day = weekOf;
  if (day > addDays(weekOf, 6)) day = addDays(weekOf, 6);
  if (today && day < today) day = today;
  if (day > addDays(weekOf, 6) || day >= fd && cand.angle !== "last_call") return { slot: null, note: null };
  const month = day.slice(0, 7);
  const used = (history || []).filter(h => counted(h) && h.channel === "sms" && monthOf(h) === month).length;
  // Keep room for priority texts still to come this month.
  let reserved = 0;
  if (!cand.priority) for (let w = addDays(weekOf, 7); w.slice(0, 7) <= month && w <= addDays(weekOf, 35); w = addDays(w, 7)) if (addDays(w, 1).slice(0, 7) === month && priorityTextFor(priorities, w, live)) reserved++;
  if (used + reserved >= cap) return { slot: null, note: `Text skipped: ${used} of ${cap} this month already${reserved ? `, ${reserved} kept for a priority later in the month` : ""}` };
  return { slot: { channel: "sms", kind: "text", day, time: cadence.sms.time, line: cand.line, program: programRef(cand.program), angle: cand.angle, reason: cand.reason }, note: null };
}

// planFlow({ startWeek, weeks = 6, programs, priorities, settings, history })
//   -> [{ weekOf, lines: { line: count }, notes, social: [line], email: line|null, sms: line|null, slots }]
// Each planned week becomes history for the next, so the rotation is visible.
export function planFlow({ startWeek, weeks = 6, programs = [], priorities = [], settings = {}, history = [], today = null } = {}) {
  const out = [];
  let hist = (history || []).slice();
  let w = mondayOf(startWeek);
  if (!w) return out;
  for (let i = 0; i < Math.max(1, Math.min(26, +weeks || 6)); i++, w = addDays(w, 7)) {
    const plan = planWeek({ weekOf: w, programs, priorities, settings, history: hist, today: i === 0 ? today : null });
    const lines = {};
    for (const s of plan.slots) lines[s.line] = (lines[s.line] || 0) + 1;
    out.push({
      weekOf: w, lines, notes: plan.notes,
      social: plan.slots.filter(s => s.channel === "social").map(s => s.line),
      email: plan.slots.find(s => s.channel === "email")?.line || null,
      sms: plan.slots.find(s => s.channel === "sms")?.line || null,
      slots: plan.slots,
    });
    hist = hist.concat(plan.slots.map(s => ({ week_of: w, channel: s.channel, kind: s.kind, line: s.line, status: "planned", scheduled_at: s.day })));
  }
  return out;
}

// A director's week-level ask ("more Reach, less volleyball", "push Camp
// Elevate harder") -> the lines it names. Used by the `brief` action to
// store the ask as a one-week priority.
const LINE_WORDS = {
  camp_elevate: /camp\s*elevate|\belevate\b/i,
  volleyball: /volley|v-?ball|\bpods?\b/i,
  basketball: /basket|hoops|\b4qa\b|4th\s*quarter|skill\s*lab|shooting\s*lab|3v3/i,
  reach: /\breach\b|strength|speed\s*(and|&)\s*agility|performance\s*training/i,
  parties: /birthday|\bpart(y|ies)\b/i,
  rentals: /rental|rent(ing)?\s+(a\s+)?court|court\s*rent/i,
  open_gym: /open\s*gym/i,
  club: /\bthe\s+club\b|community|membership/i,
};
export function parseBrief(text) {
  const t = String(text || "");
  const lines = [], avoid = [];
  const hits = [];
  for (const [line, re] of Object.entries(LINE_WORDS)) {
    const g = new RegExp(re.source, "gi");
    let m;
    while ((m = g.exec(t))) { hits.push({ line, at: m.index }); if (!g.global) break; }
  }
  hits.sort((a, b) => a.at - b.at);
  for (const h of hits) {
    // The clause before the mention: the nearer cue word wins ("more Reach, less volleyball").
    const clause = t.slice(0, h.at).split(/[,.;!?]|\bbut\b/i).pop().toLowerCase();
    const last = (re) => { let i = -1, m; const g = new RegExp(re.source, "gi"); while ((m = g.exec(clause))) i = m.index; return i; };
    const neg = last(/\b(less|fewer|no|not|skip|stop|pause|without|drop|cut|ease off)\b/) > last(/\b(more|push|plus|focus|extra|hard|and|also)\b/);
    if (lines.includes(h.line) || avoid.includes(h.line)) continue;
    (neg ? avoid : lines).push(h.line);
  }
  return { lines, avoid_lines: avoid };
}
