// Public "training" block for /api/site-data: upcoming DSSC volleyball sessions
// (synced from Playbook into dssc_clinics), grouped by program, linked to the
// matching Playbook registration page. Whitelisted field by field — never
// coach names, pay, rosters, plans, notes, feedback, ids or anything per kid.
import { classSport } from "../../shared/dssc-sport.js";

const PB = "https://drippingsports.playbookapi.com/programs";
export const TRAINING_LINKS = {
  volleyball: `${PB}/register/volleyball/`,
  pods: `${PB}/register/volleyball_pods/`,
  reach: `${PB}/register/reach_performance/`,
  calendar: `${PB}/calendar`,
};
const WINDOW_DAYS = 75, MAX_PROGRAMS = 12, MAX_DATES = 4;
const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const ymdOk = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : null);
const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);

// "6:00pm" / "6pm" / "18:00" → "18:00"
export function hhmm(s) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])?m?$/i.exec(clean(s));
  if (!m) return null;
  let h = +m[1]; const min = +(m[2] || 0);
  if (m[3]) { h = h % 12 + (m[3].toLowerCase() === "p" ? 12 : 0); }
  return h < 24 && min < 60 ? String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0") : null;
}
export function trainingKind(name, category, kind) {
  const t = `${name} ${category}`;
  if (/\bpods?\b/i.test(t)) return "pod";
  if (/camp/i.test(t) || clean(kind).toLowerCase() === "camp") return "camp";
  if (/clinic|^guaranteed to/i.test(clean(name)) || /clinic/i.test(clean(category))) return "clinic";
  return "program";
}
export function registerUrl(name, category, kind) {
  const t = `${name} ${category}`;
  if (kind === "pod") return TRAINING_LINKS.pods;
  if (/reach|strength|conditioning|athlete development/i.test(t)) return TRAINING_LINKS.reach;
  return TRAINING_LINKS.volleyball;
}
export const trainingVenue = (loc) => (/warehouse/i.test(loc || "") ? "warehouse" : /flex/i.test(loc || "") ? "flex" : null);

export function buildTraining(rows, today) {
  const to = addDays(today, WINDOW_DAYS);
  const byName = new Map();
  for (const c of rows || []) {
    if (classSport(c) !== "volleyball") continue;
    const name = clean(c.name), category = clean(c.category);
    if (!name || /adult/i.test(`${name} ${category}`)) continue;
    let sess = Array.isArray(c.sessions) && c.sessions.length ? c.sessions : (ymdOk(c.clinic_date) ? [{ date: c.clinic_date }] : []);
    const live = [];
    for (const s of sess) {
      const date = ymdOk(s && s.date);
      if (!date || date < today || date > to || (s && (s.cancelled || s.cancelled_at))) continue;
      live.push({ date, start: hhmm(s.start_time) || hhmm(c.start_time), end: hhmm(s.end_time) || hhmm(c.end_time) });
    }
    if (!live.length) continue;
    const key = name.toLowerCase();
    const g = byName.get(key) || { name, category, kind: c.kind, ages: null, venue: null, sess: [] };
    g.ages = g.ages || clean(c.age_group) || null;
    g.venue = g.venue || trainingVenue(c.location);
    g.sess.push(...live);
    byName.set(key, g);
  }
  const programs = [];
  for (const g of byName.values()) {
    g.sess.sort((a, b) => a.date.localeCompare(b.date) || String(a.start).localeCompare(String(b.start)));
    const dates = [...new Set(g.sess.map((s) => s.date))];
    const next = g.sess[0];
    const kind = trainingKind(g.name, g.category, g.kind);
    programs.push({
      name: g.name, kind, ages: g.ages, next_dates: dates.slice(0, MAX_DATES),
      start_time: next.start || null, end_time: next.end || null, sessions_left: g.sess.length,
      venue: g.venue, register_url: registerUrl(g.name, g.category, kind),
    });
  }
  const pri = (k) => (k === "pod" ? 1 : 0);   // pods are many and team-specific: they yield to clinics/camps on the same date
  programs.sort((a, b) => a.next_dates[0].localeCompare(b.next_dates[0]) || pri(a.kind) - pri(b.kind) || a.name.localeCompare(b.name));
  return programs.slice(0, MAX_PROGRAMS);
}

// Returns { programs, links } or null (query failed / nothing upcoming) so the endpoint can omit it.
export async function loadTraining(sb, today) {
  try {
    const { data, error } = await sb.from("dssc_clinics")
      .select("name, kind, category, sport, clinic_date, end_date, start_time, end_time, location, age_group, sessions")
      .or(`end_date.gte.${today},clinic_date.gte.${today}`);
    if (error) throw error;
    const programs = buildTraining(data, today);
    return programs.length ? { programs, links: { ...TRAINING_LINKS } } : null;
  } catch (e) {
    console.error("site-data training", e && e.message);
    return null;
  }
}
