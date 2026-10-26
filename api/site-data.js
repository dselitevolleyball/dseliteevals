// Public website data — everything dselitevolleyball.com shows about teams,
// rosters, coaches, practices and tournaments, in one whitelisted JSON payload.
//
//   GET /api/site-data      → SiteData (below). No login, CORS *, noindex.
//
// The website (Astro, its own repo) fetches this server side and re-renders
// every 5 minutes (ISR); it never sees a Supabase key. RLS keeps every table
// here closed to the anon key, so this reads with the service role — which is
// why every select names its columns and every output object is built field by
// field. Never spread a DB row into the output.
//
// What is public (Drew, 14 Oct 2026 — website spec §0):
//   teams      practice_teams minus event teams (0 practices/week, e.g. 14 Crystal)
//   rosters    first + last name, jersey #, position, grad year — only girls who
//              ACCEPTED (offer_status accepted|locked), this season, on a public
//              team, and not players.site_hidden (a family's opt-out). Never DOB,
//              school, height, contact, parents, scores, notes or any status.
//   coaches    head/assistant/third coach names + site_staff (title, bio, photo);
//              placeholders (TBD, floater) dropped; show_on_site=false hides.
//   practice   each team's weekly pattern per phase (days, times, building), plus
//              Speed & Agility (sa_sessions) when the same slot recurs on every
//              remaining date of the phase. The per-team ICS feed
//              (/api/calendar?team=) has the exceptions and the one-off S&A dates.
//   tournaments  events with ≥1 non-dropped assignment for a public team, not
//              cancelled, not over; planned/in_progress entries are "tentative".
//              Never cost, notes, housing, registration or assignment overrides.
//              The in-house tournament (team_events 'Tournament…') is one entry.
//
// Shape:
//   { ok, generated_at, season, today,
//     counts: { teams, athletes, coaches, tournaments, planned_tournaments, travel_tournaments, qualifiers, states },
//     venues: { warehouse: Venue, flex: Venue },
//     teams: Team[], staff: Staff[], tournaments: Tournament[],
//     this_weekend: { label: 'This weekend'|'Next up', start, end, tournaments } | null,
//     links: { hq, hub },
//     training?: { programs: Program[], links: { volleyball, pods, reach, calendar } } }   (omitted when nothing upcoming / query fails)
//   Program    { name, kind: pod|camp|clinic|program, ages, next_dates (<=4 YYYY-MM-DD), start_time, end_time (HH:MM Central, next session),
//                sessions_left, venue: warehouse|flex|null, register_url } - upcoming volleyball sessions, next 75 days (api/_lib/site-training.js)
//   counts.tournaments / travel_tournaments / qualifiers / states are over events with at least one
//   CONFIRMED public-team entry; planned_tournaments = events whose public entries are all tentative.
//   Venue      { key, name, address, map_url }
//   Team       { slug, name, age, age_div, gem, level, practices_per_week, coaches: [{ slug, name, role }],
//                roster: Player[], roster_count, practice: { current_phase, phases: Phase[] },
//                tournaments: TeamTournament[], next_tournament, live, links: { hub, calendar_ics, calendar_webcal, calendar_google } }
//   Player     { number, first_name, last_name, name, position, pos_code, grad_year }
//              (a "(Legal) Preferred" name is published as the text outside the parentheses)
//   practice.current_phase = the phase running today, else the next upcoming phase id, null only when none remain.
//   Phase      { id, label, from, to, sessions: Session[], note? }
//   Session    { day, day_label, start, end, label, kind: 'court'|'sa', venue, from?, to? }
//              kind 'court' → label is the time ('3–5 pm'); kind 'sa' (Speed & Agility, always the Warehouse)
//              → label is 'Speed & Agility'. from/to (inclusive dates) appear only when the session covers part of
//              the phase (a Flex venue window ends/starts mid-phase); absent = the whole phase.
//              note appears when Speed & Agility happens only on some dates of the phase.
//   TeamTournament { id, kind, name, start, end, city, venue, division, status, qualifier, qualifier_type, travel, url, session }
//   Tournament { id, kind, name, start, end, city, venue, qualifier, qualifier_type, travel, url, teams: [{ slug, name, division, status }] }
//   Staff      { slug, name, title, bio, photo_url, leadership, sort_order, teams: [{ slug, name, role }] }
// scripts/site-data-check.mjs asserts the privacy rules against this builder.
//
// Cache: public, s-maxage=120, stale-while-revalidate=600. Errors: 500, no-store.
// Any query string → 400 { ok:false, error:'no query parameters' } (public, s-maxage=3600), so cache-busting
// URLs can't make the endpoint rebuild the payload on every hit.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";
import { isEventTeam } from "../shared/event-teams.js";
import { isAustinArea } from "../shared/austin-area.js";
import { PHASE_RANGES, PHASE_LABEL, PRESEASON_DATES, span, isPlaceholder } from "../shared/day-schedule.js";
import { localNow, tzForTournament, withNext, fmtDay, fmtTime, ordinal } from "../shared/tournament-feed.js";
import { PROD_ORIGIN } from "../shared/app-origin.js";
import { personSlug } from "../shared/site-slug.js";
import { seasonForDate } from "./_lib/season.js";
import { slugOf } from "./hub-data.js";
import { loadTraining } from "./_lib/site-training.js";

const APP = PROD_ORIGIN;
// Same buildings and addresses as api/calendar.js (the ICS feeds).
const VENUES = {
  warehouse: { key: "warehouse", name: "Dripping Springs Sports Club — Warehouse", address: "15113 Fitzhugh Rd, Suite 1400, Dripping Springs, TX" },
  flex: { key: "flex", name: "Dripping Springs Sports Club — Flex", address: "13673 Fitzhugh Rd, Suite 200, Dripping Springs, TX" },
};
const venueOut = (v) => ({ key: v.key, name: v.name, address: v.address, map_url: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("Dripping Springs Sports Club, " + v.address) });

const LEVEL_ORDER = { National: 0, Regional: 1, Rise: 2 };
// practice_teams.level → The Ladder. Developmental is what the club calls Rise.
const levelOf = (level, name) => (/rise/i.test(name || "") || /develop/i.test(level || "") ? "Rise" : /national/i.test(level || "") ? "National" : "Regional");
const CONFIRMED = new Set(["locked", "registered", "accepted", "rostered", "need_to_drop"]);
const PUBLIC_OFFER = ["accepted", "locked"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LABEL = { Sun: "Sunday", Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday" };

const byName = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const ymd = (d) => String(d || "").slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(ymd(d) + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const sundayOf = (d) => addDays(d, (7 - new Date(Date.parse(ymd(d) + "T12:00:00Z")).getUTCDay()) % 7);
const nameKey = (s) => clean(s).toLowerCase();
const dayOf = (d) => DAYS[new Date(Date.parse(ymd(d) + "T12:00:00Z")).getUTCDay()];
const sundaysBetween = (from, to) => { const out = []; for (let d = sundayOf(from); d <= to; d = addDays(d, 7)) out.push(d); return out; };
const chunks = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

// PostgREST answers at most 1,000 rows a request; page through (build() makes a
// fresh, ordered query each time) so a table that keeps growing never gets
// silently cut off.
async function pageAll(build, what, size = 1000) {
  const out = [];
  for (let at = 0; ; at += size) {
    const r = await build().range(at, at + size - 1);
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    const rows = r.data || [];
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

// Coach contact details never go out, even if one is typed into a bio in HQ.
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const EMAIL_RE = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi;
const scrub = (s) => String(s).replace(EMAIL_RE, "").replace(PHONE_RE, "").replace(/[ \t]{2,}/g, " ");
const bioOut = (s) => {
  if (!s) return null;
  const paras = scrub(s).replace(/\r\n?/g, "\n").split(/\n\s*\n/).map(clean).filter(Boolean);
  return paras.length ? paras.join("\n\n") : null;
};

// ---- positions + grad year ------------------------------------------------------

// roster_pos is the coach's slot on the lineup (S1, Pin2, M1, L, DS1, U1); the
// public sees the category, not the depth chart.
const POS = { S: "Setter", Pin: "Pin Hitter", OH: "Outside Hitter", RS: "Opposite", M: "Middle Blocker", L: "Libero", DS: "Defensive Specialist", U: "Utility" };
function positionOf(p) {
  const rp = clean(p.roster_pos);
  const fromSlot = /^DS/i.test(rp) ? "DS" : /^S\d*$/i.test(rp) ? "S" : /^Pin/i.test(rp) ? "Pin" : /^M\d*$/i.test(rp) ? "M" : /^L\d*$/i.test(rp) ? "L" : /^U/i.test(rp) ? "U" : null;
  if (fromSlot) return { position: POS[fromSlot], pos_code: fromSlot };
  const word = (s) => {
    const v = clean(s).toUpperCase();
    if (!v) return null;
    if (v === "OH" || /^OUTSIDE/.test(v)) return "OH";
    if (v === "RS" || v === "OPP" || /^OPPOSITE|^RIGHT/.test(v)) return "RS";
    if (v === "MB" || v === "M" || /^MIDDLE/.test(v)) return "M";
    if (v === "S" || /^SETTER/.test(v)) return "S";
    if (v === "L" || /^LIBERO/.test(v)) return "L";
    if (v === "DS" || /^DEFENSIVE/.test(v)) return "DS";
    if (v === "PIN") return "Pin";
    if (v === "U" || /^UTIL/.test(v)) return "U";
    return null;
  };
  const code = word(p.primary_position) || word(Array.isArray(p.positions) ? p.positions[0] : null);
  return code ? { position: POS[code], pos_code: code } : { position: null, pos_code: null };
}
// '9th' for the 2026-27 season → class of 2030 (season end year + (12 − grade)).
// The report belongs to the player's season row (we only read this season's
// players), so the CURRENT season decides the year — not the date the form was
// submitted, which a July submission would push into the previous season.
function gradYearOf(report, season) {
  if (!report) return null;
  const g = parseInt(String(report.grade || ""), 10);
  if (!(g >= 1 && g <= 12)) return null;
  const end = parseInt(String(season).slice(0, 4), 10) + 1;
  return Number.isFinite(end) ? end + (12 - g) : null;
}

// Some families are stored as "(Legal) Preferred" — the public sees the text
// outside the parentheses ("Preferred"). If nothing is outside them, the words
// inside are the best name there is.
export function publicName(s) {
  const raw = String(s ?? "");
  const outside = clean(raw.replace(/\([^)]*(?:\)|$)/g, " ").replace(/[()]/g, " "));
  return outside || clean(raw.replace(/[()]/g, " "));
}

// ---- practice --------------------------------------------------------------------

const hhmm = (h) => String(Math.floor(h)).padStart(2, "0") + ":" + String(Math.round((h % 1) * 60)).padStart(2, "0");
const h12 = (h) => { const w = Math.floor(h), m = Math.round((h - w) * 60), x = w % 12 === 0 ? 12 : w % 12; return x + (m ? ":" + String(m).padStart(2, "0") : ""); };
const ampm = (h) => (h >= 12 ? "pm" : "am");
const timeLabel = (s, e) => (ampm(s) === ampm(e) ? `${h12(s)}–${h12(e)} ${ampm(e)}` : `${h12(s)} ${ampm(s)}–${h12(e)} ${ampm(e)}`);

// Which building, for one slice of a phase (from..to). Mirrors locFor() in
// api/calendar.js: summer court 5 is the Flex; an explicit venue wins inside its
// venue_start..venue_end window. practiceFor() cuts the phase at every window
// edge first, so a slice is either wholly inside a window or wholly outside it.
function venueKey(a, phase, from, to) {
  const derivedFlex = phase === "summer" && Number(a.court) === 5;
  const v = clean(a.venue).toLowerCase();
  const applies = v && (!a.venue_start || ymd(a.venue_start) <= from) && (!a.venue_end || ymd(a.venue_end) >= to);
  return (applies ? v === "flex" : derivedFlex) ? "flex" : "warehouse";
}

// Back-to-back / overlapping [start, end] hours → one block.
function mergeSpans(list) {
  const merged = [];
  for (const [s, e] of list.slice().sort((x, y) => x[0] - y[0])) {
    const p = merged[merged.length - 1];
    if (p && s <= p[1]) p[1] = Math.max(p[1], e); else merged.push([s, e]);
  }
  return merged;
}

// Speed & Agility (sa_sessions: one row per team, Sunday and hour). A slot that
// is there on EVERY remaining Sunday of the phase is a weekly session like a
// court block; anything patchier (the regular-season S&A dates are scattered)
// can't be a weekly pattern, so the phase just says so and the team's calendar
// feed carries the dates. Mirrors how api/calendar.js reads the same rows.
function saFor(saRows, id, from, to, today) {
  const winFrom = from > today ? from : today;
  const required = PRESEASON_DATES[id] ? PRESEASON_DATES[id].filter((d) => d >= winFrom && d <= to) : sundaysBetween(winFrom, to);
  const groups = new Map();                                    // slot → Set(dates)
  for (const r of saRows) {
    const d = ymd(r.session_date);
    if (!d || d < winFrom || d > to) continue;
    const slot = clean(r.slot);
    if (!groups.has(slot)) groups.set(slot, new Set());
    groups.get(slot).add(d);
  }
  const weekly = [];
  let partial = false;
  for (const [slot, dates] of groups) {
    const [s, e] = span(slot);
    const sundays = [...dates].every((d) => dayOf(d) === "Sun");
    if (s < 99 && e > s && sundays && required.length && required.every((d) => dates.has(d))) weekly.push([s, e]);
    else partial = true;
  }
  return { weekly: mergeSpans(weekly), partial };
}

const SA_NOTE = "Speed & Agility sessions on select dates — see the team calendar.";

export function practiceFor(rows, saRows, today) {
  const phases = [];
  for (const [id, from, to] of PHASE_RANGES) {
    if (to < today) continue;                                  // only phases that haven't ended
    const mine = rows.filter((a) => (a.phase || "season") === id);
    const sa = saFor(saRows, id, from, to, today);
    if (!mine.length && !sa.weekly.length) continue;

    // Cut the phase wherever an explicit-venue window starts or ends inside it,
    // then work out each slice's building on its own.
    const cuts = new Set([from]);
    for (const a of mine) {
      // ...and wherever a slot that runs for only part of the phase starts or stops.
      for (const [st, en] of [[a.venue_start, a.venue_end], [a.active_from, a.active_to]]) {
        if (st === a.venue_start && !clean(a.venue)) continue;
        const s = ymd(st), e = en ? addDays(ymd(en), 1) : "";
        if (s > from && s <= to) cuts.add(s);
        if (e > from && e <= to) cuts.add(e);
      }
    }
    const starts = [...cuts].sort();
    const slices = starts.map((s, i) => [s, i + 1 < starts.length ? addDays(starts[i + 1], -1) : to]).filter(([, e]) => e >= today);

    const court = new Map();                                   // day|start|end|venue → [{ ..., from, to }]
    for (const [sFrom, sTo] of slices) {
      const groups = new Map();                                // day|venue → [[s,e]]
      for (const a of mine) {
        if ((a.active_from && ymd(a.active_from) > sFrom) || (a.active_to && ymd(a.active_to) < sTo)) continue;
        const day = DAYS.find((d) => d === clean(a.day).slice(0, 3));
        const [s, e] = span(a.slot);
        if (!day || !(s < 99) || !(e > s)) continue;
        const k = day + "|" + venueKey(a, id, sFrom, sTo);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push([s, e]);
      }
      for (const [k, list] of groups) {
        const [day, venue] = k.split("|");
        for (const [s, e] of mergeSpans(list)) {
          const key = [day, hhmm(s), hhmm(e), venue].join("|");
          const runs = court.get(key) || [];
          const last = runs[runs.length - 1];
          if (last && addDays(last.to, 1) === sFrom) last.to = sTo;   // same block, next slice → one session
          else runs.push({ day, venue, s, e, from: sFrom, to: sTo });
          court.set(key, runs);
        }
      }
    }

    const sessions = [];
    for (const runs of court.values()) {
      for (const r of runs) {
        const x = { day: r.day, day_label: DAY_LABEL[r.day], start: hhmm(r.s), end: hhmm(r.e), label: timeLabel(r.s, r.e), kind: "court", venue: r.venue };
        if (r.from !== from || r.to !== to) { x.from = r.from; x.to = r.to; }
        sessions.push(x);
      }
    }
    for (const [s, e] of sa.weekly) sessions.push({ day: "Sun", day_label: DAY_LABEL.Sun, start: hhmm(s), end: hhmm(e), label: "Speed & Agility", kind: "sa", venue: "warehouse" });
    sessions.sort((x, y) => DAYS.indexOf(x.day) - DAYS.indexOf(y.day) || x.start.localeCompare(y.start) || (x.from || "").localeCompare(y.from || ""));
    if (!sessions.length) continue;
    const phase = { id, label: PHASE_LABEL[id] || id, from, to, sessions };
    if (sa.partial) phase.note = SA_NOTE;
    phases.push(phase);
  }
  // The phase running today; between phases, the next one to start.
  const cur = phases.find((p) => p.from <= today && today <= p.to) || phases.find((p) => p.from > today);
  return { current_phase: cur ? cur.id : null, phases };
}

// ---- tournaments ------------------------------------------------------------------

const CITY_STATE = [
  [/^anaheim\b/i, "CA"], [/^los angeles\b|^long beach\b|^san diego\b/i, "CA"], [/^new orleans\b/i, "LA"], [/^honolulu\b/i, "HI"],
  [/^las vegas\b/i, "NV"], [/^orlando\b|^kissimmee\b/i, "FL"], [/^chicago\b/i, "IL"], [/^oklahoma city\b|^okc\b/i, "OK"],
  [/^(?:austin|dallas|houston|san antonio|fort worth|buda|waco|bryan|new braunfels|converse|universal city|seguin|round rock)\b/i, "TX"],
];
const STATE_NAMES = { texas: "TX", california: "CA", louisiana: "LA", hawaii: "HI", nevada: "NV", florida: "FL", illinois: "IL", oklahoma: "OK" };
function stateOf(city) {
  const s = clean(city);
  if (!s) return null;
  const codes = [...s.matchAll(/,\s*([A-Z]{2})\b/g)];
  if (codes.length) return codes[codes.length - 1][1];
  const nm = Object.keys(STATE_NAMES).find((n) => new RegExp("\\b" + n + "\\b", "i").test(s));
  if (nm) return STATE_NAMES[nm];
  const hit = CITY_STATE.find(([re]) => re.test(s));
  if (hit) return hit[1];
  return isAustinArea({ location: s }) ? "TX" : null;
}
const cityOut = (location) => {
  const c = clean(location);
  if (!c) return null;
  if (/,\s*[A-Z]{2}\b/.test(c)) return c;
  const st = stateOf(c);
  return st ? `${c}, ${st}` : c;
};
const venueOutT = (venue, city) => {
  // "McCormick Place Convention Center  2301 S Martin Luther King Dr., Chicago, IL 60616" → the name only.
  const v = clean(venue).replace(/\s+\d{2,6}\s+[^,]+,\s*[^,]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?$/, "").trim();
  if (!v) return null;
  const c = nameKey(city), first = nameKey(String(city || "").split(",")[0]);
  return nameKey(v) === c || nameKey(v) === first ? null : v;
};
const tnName = (s) => clean(s).replace(/#\s+(?=\d)/g, "#").replace(/\s+--\s+/g, " — ");
const urlOut = (u) => (/^https?:\/\//i.test(clean(u)) ? clean(u) : null);

// The hub's snapshot (shared/tournament-feed.js TeamSnapshot) reduced to a line or two.
function liveOut(t, row, today) {
  const snap = row && row.snapshot && row.snapshot.v ? withNext(row.snapshot, localNow(tzForTournament(t))) : null;
  if (!snap) return null;
  const done = !!(snap.finish || (snap.done && snap.platform !== "otto"));
  const status = today > t.end || done ? "final" : today >= t.start ? "live" : "upcoming";
  const r = snap.record;
  const out = { tournament: tnName(t.name), status };
  if (r && Number.isFinite(Number(r.mw)) && Number.isFinite(Number(r.ml))) out.record = `${Number(r.mw)}-${Number(r.ml)}` + (Number.isFinite(Number(r.sw)) && Number.isFinite(Number(r.sl)) ? ` (sets ${Number(r.sw)}-${Number(r.sl)})` : "");
  const fin = snap.finish ? clean(snap.finish.text) || ordinal(snap.finish.rank) : null;
  if (fin) out.finish = fin;
  const nx = snap.next && (snap.next.live || snap.next.play);
  if (nx && nx.start && !done) out.next = [fmtDay(nx.start) + " " + fmtTime(nx.start), nx.court != null && clean(nx.court) ? (/^\d+$/.test(clean(nx.court)) ? "Court " + clean(nx.court) : clean(nx.court)) : "", nx.opponent ? "vs " + clean(nx.opponent) : ""].filter(Boolean).join(" · ");
  if (row.synced_at) out.updated_at = new Date(row.synced_at).toISOString();
  return out;
}

// ---- links --------------------------------------------------------------------------

function teamLinks(name, slug) {
  const ics = `${APP}/api/calendar?team=${encodeURIComponent(name)}`;
  const webcal = ics.replace(/^https?:\/\//i, "webcal://");
  return { hub: `${APP}/hub?team=${slug}`, calendar_ics: ics, calendar_webcal: webcal, calendar_google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` };
}

// ---- builder ------------------------------------------------------------------------

export async function buildSiteData(sb, { now = new Date() } = {}) {
  const today = localNow("America/Chicago", now).slice(0, 10);
  const season = seasonForDate(today);
  const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data || []; };

  const [ptRes, evRes, staffRes] = await Promise.all([
    sb.from("practice_teams").select("team_name, level, age_div, head_coach, assistant_coach, third_coach, practices_per_week"),
    sb.from("team_events").select("team_name, title, event_date, start_time").ilike("title", "Tournament%").gte("event_date", today),
    sb.from("site_staff").select("name, slug, title, bio, photo_url, leadership, sort_order, show_on_site"),
  ]);

  // Teams
  const teamRows = must(ptRes, "practice_teams").filter((t) => clean(t.team_name) && !isEventTeam(t));
  const teamBase = teamRows.map((t) => {
    const name = clean(t.team_name);
    const age = parseInt(name, 10) || parseInt(String(t.age_div || "").replace(/\D/g, ""), 10) || null;
    return {
      row: t, name, slug: slugOf(name), age, age_div: clean(t.age_div) || (age ? "U" + age : null),
      gem: clean(name.replace(/^\d+\s*/, "").replace(/\s+\d+$/, "")) || null, level: levelOf(t.level, name),
      practices_per_week: t.practices_per_week == null ? null : Number(t.practices_per_week),
    };
  }).sort((a, b) => (a.age ?? 99) - (b.age ?? 99) || LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || byName(a.name, b.name));
  const teamBy = new Map(teamBase.map((t) => [t.name, t]));
  const teamIdx = new Map(teamBase.map((t, i) => [t.name, i]));

  // Everything else is keyed to the public teams, so ask for only their rows —
  // paged, and (for the tables that keep every season) cut to what still matters.
  const teamNames = teamBase.map((t) => t.name);
  const [playerRows, paRows, saRows, asgRows] = teamNames.length ? await Promise.all([
    pageAll(() => sb.from("players").select("id, team_assignment, first_name, last_name, jersey_number, roster_pos, primary_position, positions")
      .in("offer_status", PUBLIC_OFFER).eq("season", season).eq("site_hidden", false).in("team_assignment", teamNames).order("id"), "players"),
    pageAll(() => sb.from("practice_assignments").select("team_name, phase, day, slot, court, venue, venue_start, venue_end, active_from, active_to").in("team_name", teamNames).order("id"), "practice_assignments"),
    pageAll(() => sb.from("sa_sessions").select("team_name, session_date, slot").in("team_name", teamNames).gte("session_date", today).order("id"), "sa_sessions"),
    pageAll(() => sb.from("tournament_assignments").select("tournament_id, team_id, division, status").in("team_id", teamNames).neq("status", "dropped").order("id"), "tournament_assignments"),
  ]) : [[], [], [], []];
  const practiceBy = new Map(teamBase.map((t) => [t.name, []]));
  for (const a of paRows) practiceBy.get(clean(a.team_name))?.push(a);
  const saBy = new Map(teamBase.map((t) => [t.name, []]));
  for (const a of saRows) saBy.get(clean(a.team_name))?.push(a);

  // Staff rows (site_staff) by roster name
  const staffRows = must(staffRes, "site_staff");
  const staffBy = new Map(staffRows.map((r) => [nameKey(r.name), r]));
  const hidden = (name) => staffBy.get(nameKey(name))?.show_on_site === false;
  const slugFor = (name) => clean(staffBy.get(nameKey(name))?.slug) || personSlug(name);

  // Coaches per team (head first) and teams per coach
  const coachTeams = new Map();   // nameKey → { name, teams: [] }
  const teamCoaches = new Map();
  for (const t of teamBase) {
    const list = [];
    for (const [raw, role] of [[t.row.head_coach, "head"], [t.row.assistant_coach, "assistant"], [t.row.third_coach, "assistant"]]) {
      const name = clean(raw);
      if (!name || isPlaceholder(name) || hidden(name) || list.some((c) => nameKey(c.name) === nameKey(name))) continue;
      list.push({ slug: slugFor(name), name, role });
      const k = nameKey(name);
      if (!coachTeams.has(k)) coachTeams.set(k, { name, teams: [] });
      coachTeams.get(k).teams.push({ slug: t.slug, name: t.name, role });
    }
    teamCoaches.set(t.name, list);
  }

  // Rosters + grad year
  const players = playerRows.filter((p) => teamBy.has(clean(p.team_assignment)));
  const ids = players.map((p) => p.id);
  const reports = [];
  for (const part of chunks(ids, 150)) reports.push(...must(await sb.from("school_team_reports").select("player_id, grade, submitted_at, updated_at").in("player_id", part), "school_team_reports"));
  const latest = new Map();
  for (const r of reports) {
    const at = r.updated_at || r.submitted_at || "";
    const cur = latest.get(r.player_id);
    if (!cur || at > (cur.updated_at || cur.submitted_at || "")) latest.set(r.player_id, r);
  }
  const rosterBy = new Map(teamBase.map((t) => [t.name, []]));
  for (const p of players) {
    const first = publicName(p.first_name), last = publicName(p.last_name);
    if (!first) continue;
    const n = Number(p.jersey_number);
    const pos = positionOf(p);
    rosterBy.get(clean(p.team_assignment)).push({
      number: p.jersey_number != null && p.jersey_number !== "" && Number.isFinite(n) ? n : null,
      first_name: first, last_name: last, name: clean(first + " " + last),
      position: pos.position, pos_code: pos.pos_code, grad_year: gradYearOf(latest.get(p.id), season),
    });
  }
  for (const list of rosterBy.values()) list.sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9) || byName(a.first_name, b.first_name) || byName(a.last_name, b.last_name));

  // Tournaments: non-dropped assignments for public teams → upcoming, not cancelled
  const asg = asgRows.filter((a) => a.status !== "dropped" && teamBy.has(clean(a.team_id)));
  const tnIds = [...new Set(asg.map((a) => a.tournament_id))];
  const tnRows = [];
  for (const part of chunks(tnIds, 100)) {
    tnRows.push(...must(await sb.from("tournaments").select("id, name, start_date, end_date, location, venue, is_qualifier, qualifier_type, stay_over, source_url, cancelled, time_zone")
      .in("id", part).or(`end_date.gte.${today},and(end_date.is.null,start_date.gte.${today})`), "tournaments"));
  }
  const tns = new Map();
  for (const t of tnRows) {
    if (t.cancelled || !t.start_date) continue;
    const start = ymd(t.start_date), end = ymd(t.end_date || t.start_date);
    if (end < today) continue;
    tns.set(t.id, { raw: t, start, end });
  }
  // A tournament row with no link borrows one from a duplicate of the same event
  // (same name, same first day) — the sync keeps SportWrench / AES copies apart.
  const nameNorm = (s) => tnName(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const linkless = [...tns.values()].filter((x) => !urlOut(x.raw.source_url));
  const urlByEvent = new Map();   // normalized name|start → first usable link of another row
  if (linkless.length) {
    const days = [...new Set(linkless.map((x) => x.start))];
    const twins = [];
    for (const part of chunks(days, 100)) twins.push(...must(await sb.from("tournaments").select("id, name, start_date, source_url, cancelled").in("start_date", part), "tournaments (links)"));
    twins.sort((a, b) => (a.cancelled ? 1 : 0) - (b.cancelled ? 1 : 0) || a.id - b.id);
    for (const t of twins) {
      const u = urlOut(t.source_url), k = nameNorm(t.name) + "|" + ymd(t.start_date);
      if (u && !urlByEvent.has(k)) urlByEvent.set(k, u);
    }
  }
  const feedIds = [...tns.values()].filter((x) => addDays(x.start, -3) <= today && today <= addDays(x.end, 1)).map((x) => x.raw.id);
  const feedRows = feedIds.length ? must(await sb.from("tournament_team_feed").select("tournament_id, team_name, snapshot, synced_at").in("tournament_id", feedIds), "tournament_team_feed") : [];

  const event = (x) => {
    const t = x.raw, city = cityOut(t.location);
    return {
      id: String(t.id), kind: "event", name: tnName(t.name), start: x.start, end: x.end, city, venue: venueOutT(t.venue, city),
      qualifier: !!t.is_qualifier, qualifier_type: clean(t.qualifier_type) || null,
      travel: !!t.stay_over || !isAustinArea({ location: t.location }), url: urlOut(t.source_url) || urlByEvent.get(nameNorm(t.name) + "|" + x.start) || null,
    };
  };
  const teamTn = new Map(teamBase.map((t) => [t.name, []]));
  const tnTeams = new Map();      // tournament id → [{ slug, name, division, status }]
  const tnBase = new Map();
  for (const a of asg) {
    const x = tns.get(a.tournament_id);
    if (!x) continue;
    const team = teamBy.get(clean(a.team_id));
    const base = tnBase.get(a.tournament_id) || event(x);
    tnBase.set(a.tournament_id, base);
    const status = CONFIRMED.has(a.status) ? "confirmed" : "tentative";
    const division = clean(a.division) || null;
    const list = tnTeams.get(a.tournament_id) || [];
    const dup = list.find((e) => e.name === team.name);
    if (dup) { if (status === "confirmed") dup.status = "confirmed"; continue; }
    list.push({ slug: team.slug, name: team.name, division, status });
    tnTeams.set(a.tournament_id, list);
  }
  for (const [id, list] of tnTeams) {
    const base = tnBase.get(id);
    for (const e of list) {
      teamTn.get(e.name).push({
        id: base.id, kind: "event", name: base.name, start: base.start, end: base.end, city: base.city, venue: base.venue,
        division: e.division, status: e.status, qualifier: base.qualifier, qualifier_type: base.qualifier_type, travel: base.travel, url: base.url, session: null,
      });
    }
  }

  // In-house tournament: one entry per team per date (rows are one per match).
  const tmin = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(clean(s)); return m ? +m[1] * 60 + +m[2] : null; };
  const inhouse = new Map();      // date → Map(team → first match minute)
  for (const e of must(evRes, "team_events")) {
    const team = clean(e.team_name), date = ymd(e.event_date), m = tmin(e.start_time);
    if (!teamBy.has(team) || !date || m == null || !/^Tournament/i.test(clean(e.title))) continue;
    if (!inhouse.has(date)) inhouse.set(date, new Map());
    const byTeam = inhouse.get(date);
    if (!byTeam.has(team) || m < byTeam.get(team)) byTeam.set(team, m);
  }
  const allTn = [...tnTeams.keys()].map((id) => ({ ...tnBase.get(id), teams: tnTeams.get(id).slice().sort((a, b) => teamIdx.get(a.name) - teamIdx.get(b.name)) }));
  for (const [date, byTeam] of inhouse) {
    const id = "inhouse-" + date;
    const base = { id, kind: "in_house", name: "DS Elite In-House Tournament", start: date, end: date, city: "Dripping Springs, TX", venue: "DSSC Warehouse", qualifier: false, qualifier_type: null, travel: false, url: null };
    const teamsHere = [...byTeam.keys()].sort((a, b) => teamIdx.get(a) - teamIdx.get(b));
    for (const team of teamsHere) {
      // Same session windows as api/calendar.js (Drew, 10 Oct 2026).
      const session = byTeam.get(team) < 15 * 60 ? "11:00 am–3:00 pm" : "4:00–8:00 pm";
      teamTn.get(team).push({ ...base, division: null, status: "confirmed", session });
    }
    allTn.push({ ...base, teams: teamsHere.map((n) => ({ slug: teamBy.get(n).slug, name: n, division: null, status: "confirmed" })) });
  }
  const byStart = (a, b) => a.start.localeCompare(b.start) || byName(a.name, b.name);
  allTn.sort(byStart);
  for (const list of teamTn.values()) list.sort(byStart);

  // Teams out
  const teams = teamBase.map((t) => {
    const roster = rosterBy.get(t.name);
    const tlist = teamTn.get(t.name);
    let live = null;
    for (const r of feedRows.filter((r) => clean(r.team_name) === t.name)) {
      const x = tns.get(r.tournament_id);
      const l = x ? liveOut({ ...x.raw, start: x.start, end: x.end }, r, today) : null;
      if (l && (!live || (l.status === "live" && live.status !== "live"))) live = l;
    }
    return {
      slug: t.slug, name: t.name, age: t.age, age_div: t.age_div, gem: t.gem, level: t.level, practices_per_week: t.practices_per_week,
      coaches: teamCoaches.get(t.name).map((c) => ({ slug: c.slug, name: c.name, role: c.role })),
      roster, roster_count: roster.length,
      practice: practiceFor(practiceBy.get(t.name), saBy.get(t.name), today),
      tournaments: tlist, next_tournament: tlist[0] || null, live,
      links: teamLinks(t.name, t.slug),
    };
  });

  // Staff out: every public coach + leadership rows
  const people = new Map(coachTeams);
  for (const r of staffRows) if (r.leadership && !people.has(nameKey(r.name))) people.set(nameKey(r.name), { name: clean(r.name), teams: [] });
  const lastName = (n) => clean(n).split(" ").slice(1).join(" ") || clean(n);
  const staff = [];
  for (const [k, p] of people) {
    const r = staffBy.get(k);
    if (r && r.show_on_site === false) continue;
    const teamsOf = p.teams.slice().sort((a, b) => (a.role === "head" ? 0 : 1) - (b.role === "head" ? 0 : 1) || teamIdx.get(a.name) - teamIdx.get(b.name));
    staff.push({
      slug: slugFor(p.name), name: p.name, title: r && clean(r.title) ? clean(scrub(r.title)) : null, bio: r ? bioOut(r.bio) : null,
      photo_url: r && /^(https?:\/\/|\/)/i.test(clean(r.photo_url)) ? clean(r.photo_url) : null,
      leadership: !!(r && r.leadership), sort_order: r && Number.isFinite(Number(r.sort_order)) ? Number(r.sort_order) : 100,
      teams: teamsOf.map((x) => ({ slug: x.slug, name: x.name, role: x.role })),
    });
  }
  staff.sort((a, b) => (b.leadership ? 1 : 0) - (a.leadership ? 1 : 0) || a.sort_order - b.sort_order || byName(lastName(a.name), lastName(b.name)) || byName(a.name, b.name));

  // This weekend / next up
  const sunday = sundayOf(today);
  let label = "This weekend";
  let wk = allTn.filter((t) => t.start <= sunday && t.end >= today);
  if (!wk.length) {
    const fut = allTn.filter((t) => t.start > sunday);
    if (fut.length) { const S = sundayOf(fut[0].start); wk = fut.filter((t) => sundayOf(t.start) === S); label = "Next up"; }
  }
  const this_weekend = wk.length
    ? { label, start: wk.map((t) => t.start).sort()[0], end: wk.map((t) => t.end).sort().pop(), tournaments: wk }
    : null;

  // The headline numbers count only events at least one public team is really going to
  // (a confirmed entry); events every team still has "planned" are counted apart.
  const going = allTn.filter((t) => t.teams.some((e) => e.status === "confirmed"));
  const states = new Set(going.map((t) => stateOf(t.city)).filter(Boolean));
  const training = await loadTraining(sb, today);
  return {
    ok: true, generated_at: new Date(now).toISOString(), season, today,
    counts: {
      teams: teams.length, athletes: teams.reduce((n, t) => n + t.roster_count, 0), coaches: staff.length,
      tournaments: going.length, planned_tournaments: allTn.length - going.length,
      travel_tournaments: going.filter((t) => t.travel).length, qualifiers: going.filter((t) => t.qualifier).length, states: states.size,
    },
    venues: { warehouse: venueOut(VENUES.warehouse), flex: venueOut(VENUES.flex) },
    teams, staff, tournaments: allTn, this_weekend,
    links: { hq: APP, hub: `${APP}/hub` },
    ...(training ? { training } : {}),
  };
}

export function siteSupabase() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD, OPTIONS");
    return res.status(405).json({ ok: false, error: "GET only" });
  }
  // One URL, one cached copy: a query string (cache-busting ?x=1, tracking tags) is refused.
  if (new URL(req.url || "/", "http://localhost").search.length > 1) {
    res.setHeader("Cache-Control", "public, s-maxage=3600");
    return res.status(400).json({ ok: false, error: "no query parameters" });
  }
  try {
    const sb = siteSupabase();
    if (!sb) throw new Error("Supabase isn't configured");
    const out = await buildSiteData(sb, { now: new Date() });
    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
    return res.status(200).json(out);
  } catch (e) {
    console.error("site-data", e);
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ ok: false, error: "Couldn't load the club's data right now. Try again in a minute." });
  }
}
