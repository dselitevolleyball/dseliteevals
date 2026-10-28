// When do families actually sign up? Turns Playbook purchases (dssc_purchases,
// from the registrations export with prices) into a day × hour picture of
// registrations — per line and overall — and recommends the marketing
// schedule from it: which days the rhythm's posts and follow-up stories go
// out, at what time, the weekly and dedicated email days, and the text time.
//
// The idea: a post should land a little BEFORE people buy (they see it, then
// sign up), so each item goes out an hour before the best 3-hour registration
// window of its line on its day. Emails go out the morning of the biggest
// days; texts half an hour before the busiest window.
//
// Counted: paid program sign-ups, one per checkout (invoice), in Central
// time. Court rentals and $0 memberships are left out of the overall picture
// (team bookings by staff would skew it); a line with little data of its own
// borrows from the overall pattern.
//
// Used by Marketing → Settings (the "Best times" panel, Apply) and by the cron
// when Settings → "keep optimizing" is on (cadence.social.auto_times).

import { DAY_KEYS, LINE_KEYS, normRhythm, DEFAULT_CADENCE } from "./marketing-plan.js";

export const TIMING_MIN_SIGNUPS = 100;
const TZ = "America/Chicago";
const DAY_LABEL = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const grid = () => DAY_KEYS.map(() => Array(24).fill(0));
const fmtParts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", hourCycle: "h23" });

// Which marketing line a purchase belongs to.
export function lineOfPurchase(p) {
  const n = String(p?.program || "").toLowerCase();
  if (/camp elevate/.test(n)) return "camp_elevate";
  if (/birthday|party/.test(n)) return "parties";
  if (/open gym/.test(n)) return "open_gym";
  if (p?.category === "facility" || /\bcourts?\b|rental|flex/.test(n)) return "rentals";
  if (["volleyball", "basketball", "reach"].includes(p?.category)) return p.category;
  return "club";
}

// purchases: [{ purchased_at, program, category, amount_cents, invoice }]
// -> { total, overall: [7][24], lines: { line: { total, m: [7][24] } }, from, to }
export function registrationHeatmap(purchases) {
  const seen = new Set();
  const overall = grid(), lines = {};
  let total = 0, from = null, to = null;
  for (const p of purchases || []) {
    if (!p?.purchased_at || !(p.amount_cents > 0)) continue;
    const key = p.invoice ? "inv:" + p.invoice : "id:" + (p.id ?? Math.random());
    if (seen.has(key)) continue;
    seen.add(key);
    const parts = Object.fromEntries(fmtParts.formatToParts(new Date(p.purchased_at)).map(x => [x.type, x.value]));
    const d = DAY_KEYS.indexOf(String(parts.weekday || "").slice(0, 3).toLowerCase());
    const h = Number(parts.hour) % 24;
    if (d < 0 || !Number.isFinite(h)) continue;
    const line = lineOfPurchase(p);
    (lines[line] ||= { total: 0, m: grid() });
    lines[line].m[d][h]++; lines[line].total++;
    if (line === "rentals") continue;
    overall[d][h]++; total++;
    const day = String(p.purchased_at).slice(0, 10);
    if (!from || day < from) from = day;
    if (!to || day > to) to = day;
  }
  return { total, overall, lines, from, to };
}

const sum = (a) => a.reduce((s, x) => s + x, 0);
// A line's pattern, leaning on the overall one when it has little data.
function blended(heat, lineKeys) {
  const ls = (lineKeys || []).map(l => heat.lines[l]).filter(Boolean);
  const lt = ls.reduce((s, l) => s + l.total, 0);
  const w = Math.min(1, lt / 40);
  const ot = heat.total || 1;
  return DAY_KEYS.map((_, d) => Array.from({ length: 24 }, (_, h) => {
    const lv = ls.reduce((s, l) => s + l.m[d][h], 0);
    return (lt ? w * lv / lt : 0) + (1 - w) * heat.overall[d][h] / ot;
  }));
}
// Start hour of the busiest 3-hour window on day d (between 7 am and 9 pm).
export function bestWindow(m, d, width = 3) {
  let best = 11, bestV = -1;
  for (let h = 7; h <= 21 - width + 1; h++) { const v = sum(m[d].slice(h, h + width)); if (v > bestV + 1e-9) { bestV = v; best = h; } }
  return best;
}
const hhmm = (mins) => { const m = Math.max(7 * 60, Math.min(20 * 60 + 30, Math.round(mins / 30) * 30)); return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
const leadTime = (m, d, leadMin = 60) => hhmm(bestWindow(m, d) * 60 - leadMin);
// The line's own pattern for that day, else the overall one, else the fallback time.
const timeOn = (heat, m, d, fallback, leadMin = 60) => sum(m[d]) > 0 ? leadTime(m, d, leadMin) : sum(heat.overall[d]) > 0 ? leadTime(heat.overall, d, leadMin) : fallback;
const dayScores = (m) => m.map(row => sum(row));

// -> { ok, reason?, cadence (the whole cadence with new days/times), changes: [text], summary }
export function recommendCadence(heat, cadence) {
  if (!heat || heat.total < TIMING_MIN_SIGNUPS) return { ok: false, reason: `Need at least ${TIMING_MIN_SIGNUPS} paid sign-ups with times (have ${heat?.total || 0}) — import a longer Playbook registrations export.` };
  const cad = { social: { ...DEFAULT_CADENCE.social, ...(cadence?.social || {}) }, email: { ...DEFAULT_CADENCE.email, ...(cadence?.email || {}) }, sms: { ...DEFAULT_CADENCE.sms, ...(cadence?.sms || {}) } };
  const changes = [];
  const overallScore = dayScores(heat.overall);
  const rhythm = normRhythm(cad.social.rhythm);
  const posts = rhythm.filter(e => !e.follow), follows = rhythm.filter(e => e.follow);
  const previewIdx = cad.social.month_preview !== false ? DAY_KEYS.indexOf(String(cad.social.preview_day || "sat")) : -1;
  const used = new Set(previewIdx >= 0 ? [previewIdx] : []);
  const lineVol = (ls) => (ls || []).reduce((s, l) => s + (heat.lines[l]?.total || 0), 0);
  // Biggest lines pick their days first; a post with a follow-up needs a free
  // day after it (the week wraps: Monday's post can have Tuesday's story).
  const order = posts.map((e, i) => ({ e, i, vol: lineVol(e.lines) })).sort((a, b) => b.vol - a.vol || a.i - b.i);
  const placed = new Map();
  for (const { e } of order) {
    const m = blended(heat, e.lines);
    const sc = dayScores(m);
    const needFollow = follows.some(f => f.follow === e.day);
    const cands = DAY_KEYS.map((_, d) => d).filter(d => !used.has(d) && (!needFollow || DAY_KEYS.some((_, x) => x !== d && !used.has(x)))).sort((a, b) => sc[b] - sc[a]);
    const d = cands.length ? cands[0] : DAY_KEYS.indexOf(e.day);
    used.add(d);
    placed.set(e, { d, m });
  }
  const out = [], pairs = [];
  for (const e of posts) {
    const { d, m } = placed.get(e);
    const n = { ...e, day: DAY_KEYS[d], time: timeOn(heat, m, d, cad.social.time) };
    out.push(n); pairs.push([e, n]);
  }
  for (const f of follows) {
    const post = posts.find(p => p.day === f.follow);
    const pd = post ? placed.get(post).d : DAY_KEYS.indexOf(f.follow);
    const m = post ? placed.get(post).m : heat.overall;
    const sc = dayScores(m);
    const cands = [(pd + 1) % 7, (pd + 2) % 7].filter(x => !used.has(x)).sort((a, b) => sc[b] - sc[a]);
    const d = cands.length ? cands[0] : ([1, 2, 3, 4, 5, 6].map(k => (pd + k) % 7).find(x => !used.has(x)) ?? -1);
    if (d < 0) { changes.push(`Follow-up story after ${DAY_LABEL[f.follow]}: dropped (no free day after its post)`); continue; }
    used.add(d);
    const n = { day: DAY_KEYS[d], follow: DAY_KEYS[pd], format: "story", time: timeOn(heat, m, d, cad.social.time) };
    out.push(n); pairs.push([f, n, post]);
  }
  out.sort((a, b) => DAY_KEYS.indexOf(a.day) - DAY_KEYS.indexOf(b.day));
  for (const [o, n, post] of pairs) {
    const what = o.follow ? `Follow-up story (${(post?.lines || []).map(l => l.replace(/_/g, " ")).join(" / ") || "post"})` : `${(o.lines || []).map(l => l.replace(/_/g, " ")).join(" / ") || "Open"} post`;
    const was = `${DAY_LABEL[o.day]} ${o.time || cad.social.time}`, now = `${DAY_LABEL[n.day]} ${n.time}`;
    if (was !== now) changes.push(`${what}: ${was} → ${now}`);
  }
  // Emails: the weekly one the morning of the biggest day, the dedicated one the next-best day.
  const byDay = DAY_KEYS.map((k, d) => ({ k, s: overallScore[d] })).sort((a, b) => b.s - a.s);
  const emailDay = byDay[0].k;
  const dedicatedDay = (byDay.find(x => x.k !== emailDay) || byDay[0]).k;
  const emailTime = bestWindow(heat.overall, DAY_KEYS.indexOf(emailDay)) <= 9 ? "06:30" : "07:30";
  if (cad.email.day !== emailDay || cad.email.time !== emailTime) changes.push(`Weekly email: ${DAY_LABEL[cad.email.day] || cad.email.day} ${cad.email.time} → ${DAY_LABEL[emailDay]} ${emailTime}`);
  if (cad.email.dedicated_day !== dedicatedDay) changes.push(`Dedicated email: ${DAY_LABEL[cad.email.dedicated_day] || cad.email.dedicated_day} → ${DAY_LABEL[dedicatedDay]} ${emailTime}`);
  // Texts and everything without its own time: just before the busiest window of the week.
  let bestD = 0; for (let d = 1; d < 7; d++) if (overallScore[d] > overallScore[bestD]) bestD = d;
  const smsTime = leadTime(heat.overall, bestD, 30);
  const socialTime = leadTime(heat.overall, bestD);
  if (cad.sms.time !== smsTime) changes.push(`Texts: ${cad.sms.time} → ${smsTime}`);
  if (cad.social.time !== socialTime) changes.push(`Other posts (month preview, extras): ${cad.social.time} → ${socialTime}`);
  const top = byDay.slice(0, 3).map(x => DAY_LABEL[x.k]).join(", ");
  const w = bestWindow(heat.overall, bestD);
  const summary = `${heat.total} paid sign-ups${heat.from ? ` (${heat.from} to ${heat.to})` : ""}: busiest days ${top}; the busiest window is ${DAY_LABEL[DAY_KEYS[bestD]]} ${fmtHour(w)}–${fmtHour(w + 3)}.`;
  return {
    ok: true, summary, changes,
    cadence: {
      social: { ...cad.social, rhythm: out, time: socialTime },
      email: { ...cad.email, day: emailDay, time: emailTime, dedicated_day: dedicatedDay },
      sms: { ...cad.sms, time: smsTime },
    },
  };
}
export const fmtHour = (h) => { const x = ((h % 24) + 24) % 24; return (x % 12 || 12) + (x < 12 ? " am" : " pm"); };

// The best time for one item on its day (re-timing drafts after Apply).
export function bestTimeFor(heat, line, dayKey, channel = "social") {
  const d = DAY_KEYS.indexOf(dayKey);
  if (d < 0 || !heat?.total) return null;
  if (channel === "email") return bestWindow(heat.overall, d) <= 9 ? "06:30" : "07:30";
  const m = blended(heat, LINE_KEYS.includes(line) ? [line] : []);
  return leadTime(m, d, channel === "sms" ? 30 : 60);
}
