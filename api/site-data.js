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
//   practice   each team's weekly pattern per phase (days, times, building).
//              The per-team ICS feed (/api/calendar?team=) has the exceptions.
//   tournaments  events with ≥1 non-dropped assignment for a public team, not
//              cancelled, not over; planned/in_progress entries are "tentative".
//              Never cost, notes, housing, registration or assignment overrides.
//              The in-house tournament (team_events 'Tournament…') is one entry.
//
// Shape:
//   { ok, generated_at, season, today,
//     counts: { teams, athletes, coaches, tournaments, travel_tournaments, qualifiers, states },
//     venues: { warehouse: Venue, flex: Venue },
//     teams: Team[], staff: Staff[], tournaments: Tournament[],
//     this_weekend: { label: 'This weekend'|'Next up', start, end, tournaments } | null,
//     links: { hq, hub, calendar_index } }
//   Venue      { key, name, address, map_url }
//   Team       { slug, name, age, age_div, gem, level, practices_per_week, coaches: [{ slug, name, role }],
//                roster: Player[], roster_count, practice: { current_phase, phases: Phase[] },
//                tournaments: TeamTournament[], next_tournament, live, links: { hub, calendar_ics, calendar_webcal, calendar_google } }
//   Player     { number, first_name, last_name, name, position, pos_code, grad_year }
//   Phase      { id, label, from, to, sessions: [{ day, day_label, start, end, label, venue }] }
//   TeamTournament { id, kind, name, start, end, city, venue, division, status, qualifier, qualifier_type, travel, url, session }
//   Tournament { id, kind, name, start, end, city, venue, qualifier, qualifier_type, travel, url, teams: [{ slug, name, division, status }] }
//   Staff      { slug, name, title, bio, photo_url, leadership, sort_order, teams: [{ slug, name, role }] }
// scripts/site-data-check.mjs asserts the privacy rules against this builder.
//
// Cache: public, s-maxage=120, stale-while-revalidate=600. Errors: 500, no-store.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";
import { isEventTeam } from "../shared/event-teams.js";
import { isAustinArea } from "../shared/austin-area.js";
import { PHASE_RANGES, PHASE_LABEL, span, isPlaceholder } from "../shared/day-schedule.js";
import { localNow, tzForTournament, withNext, fmtDay, fmtTime, ordinal } from "../shared/tournament-feed.js";
import { PROD_ORIGIN } from "../shared/app-origin.js";
import { personSlug } from "../shared/site-slug.js";
import { seasonForDate } from "./_lib/season.js";
import { slugOf } from "./hub-data.js";

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
// '9th' in a report from the 2026-27 season → class of 2030.
function gradYearOf(report, season) {
  if (!report) return null;
  const g = parseInt(String(report.grade || ""), 10);
  if (!(g >= 1 && g <= 12)) return null;
  const s = seasonForDate(report.submitted_at || report.updated_at) || season;
  const end = parseInt(String(s).slice(0, 4), 10) + 1;
  return Number.isFinite(end) ? end + (12 - g) : null;
}

// ---- practice --------------------------------------------------------------------

const hhmm = (h) => String(Math.floor(h)).padStart(2, "0") + ":" + String(Math.round((h % 1) * 60)).padStart(2, "0");
const h12 = (h) => { const w = Math.floor(h), m = Math.round((h - w) * 60), x = w % 12 === 0 ? 12 : w % 12; return x + (m ? ":" + String(m).padStart(2, "0") : ""); };
const ampm = (h) => (h >= 12 ? "pm" : "am");
const timeLabel = (s, e) => (ampm(s) === ampm(e) ? `${h12(s)}–${h12(e)} ${ampm(e)}` : `${h12(s)} ${ampm(s)}–${h12(e)} ${ampm(e)}`);

// Which building, for the part of the phase still to come. Mirrors locFor() in
// api/calendar.js: summer court 5 is the Flex; an explicit venue wins inside
// its venue_start..venue_end window.
function venueKey(a, phase, from, to) {
  const derivedFlex = phase === "summer" && Number(a.court) === 5;
  const v = clean(a.venue).toLowerCase();
  const applies = v && (!a.venue_start || ymd(a.venue_start) <= to) && (!a.venue_end || ymd(a.venue_end) >= from);
  return (applies ? v === "flex" : derivedFlex) ? "flex" : "warehouse";
}

function practiceFor(rows, today) {
  const phases = [];
  for (const [id, from, to] of PHASE_RANGES) {
    if (to < today) continue;                                  // only phases that haven't ended
    const mine = rows.filter((a) => (a.phase || "season") === id);
    if (!mine.length) continue;
    const winFrom = from > today ? from : today;
    const groups = new Map();                                  // day|venue → [[s,e]]
    for (const a of mine) {
      const day = DAYS.find((d) => d === clean(a.day).slice(0, 3));
      const [s, e] = span(a.slot);
      if (!day || !(s < 99) || !(e > s)) continue;
      const k = day + "|" + venueKey(a, id, winFrom, to);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push([s, e]);
    }
    const sessions = [];
    for (const [k, list] of groups) {
      const [day, venue] = k.split("|");
      const merged = [];
      for (const [s, e] of list.sort((x, y) => x[0] - y[0])) {
        const p = merged[merged.length - 1];
        if (p && s <= p[1]) p[1] = Math.max(p[1], e); else merged.push([s, e]);
      }
      for (const [s, e] of merged) sessions.push({ day, day_label: DAY_LABEL[day], start: hhmm(s), end: hhmm(e), label: timeLabel(s, e), venue });
    }
    sessions.sort((x, y) => DAYS.indexOf(x.day) - DAYS.indexOf(y.day) || x.start.localeCompare(y.start));
    if (sessions.length) phases.push({ id, label: PHASE_LABEL[id] || id, from, to, sessions });
  }
  const cur = phases.find((p) => p.from <= today && today <= p.to);
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

  const [ptRes, plRes, paRes, asgRes, evRes, staffRes] = await Promise.all([
    sb.from("practice_teams").select("team_name, level, age_div, head_coach, assistant_coach, third_coach, practices_per_week"),
    sb.from("players").select("id, team_assignment, first_name, last_name, jersey_number, roster_pos, primary_position, positions")
      .in("offer_status", PUBLIC_OFFER).eq("season", season).eq("site_hidden", false).not("team_assignment", "is", null).neq("team_assignment", ""),
    sb.from("practice_assignments").select("team_name, phase, day, slot, court, venue, venue_start, venue_end"),
    sb.from("tournament_assignments").select("tournament_id, team_id, division, status"),
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
  const players = must(plRes, "players").filter((p) => teamBy.has(clean(p.team_assignment)));
  const ids = players.map((p) => p.id);
  const reports = ids.length ? must(await sb.from("school_team_reports").select("player_id, grade, submitted_at, updated_at").in("player_id", ids), "school_team_reports") : [];
  const latest = new Map();
  for (const r of reports) {
    const at = r.updated_at || r.submitted_at || "";
    const cur = latest.get(r.player_id);
    if (!cur || at > (cur.updated_at || cur.submitted_at || "")) latest.set(r.player_id, r);
  }
  const rosterBy = new Map(teamBase.map((t) => [t.name, []]));
  for (const p of players) {
    const first = clean(p.first_name), last = clean(p.last_name);
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
  const asg = must(asgRes, "tournament_assignments").filter((a) => a.status !== "dropped" && teamBy.has(clean(a.team_id)));
  const tnIds = [...new Set(asg.map((a) => a.tournament_id))];
  const tnRows = tnIds.length ? must(await sb.from("tournaments").select("id, name, start_date, end_date, location, venue, is_qualifier, qualifier_type, stay_over, source_url, cancelled, time_zone").in("id", tnIds), "tournaments") : [];
  const tns = new Map();
  for (const t of tnRows) {
    if (t.cancelled || !t.start_date) continue;
    const start = ymd(t.start_date), end = ymd(t.end_date || t.start_date);
    if (end < today) continue;
    tns.set(t.id, { raw: t, start, end });
  }
  const feedIds = [...tns.values()].filter((x) => addDays(x.start, -3) <= today && today <= addDays(x.end, 1)).map((x) => x.raw.id);
  const feedRows = feedIds.length ? must(await sb.from("tournament_team_feed").select("tournament_id, team_name, snapshot, synced_at").in("tournament_id", feedIds), "tournament_team_feed") : [];

  const event = (x) => {
    const t = x.raw, city = cityOut(t.location);
    return {
      id: String(t.id), kind: "event", name: tnName(t.name), start: x.start, end: x.end, city, venue: venueOutT(t.venue, city),
      qualifier: !!t.is_qualifier, qualifier_type: clean(t.qualifier_type) || null,
      travel: !!t.stay_over || !isAustinArea({ location: t.location }), url: urlOut(t.source_url),
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
      practice: practiceFor(must(paRes, "practice_assignments").filter((a) => clean(a.team_name) === t.name), today),
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

  const states = new Set(allTn.map((t) => stateOf(t.city)).filter(Boolean));
  return {
    ok: true, generated_at: new Date(now).toISOString(), season, today,
    counts: {
      teams: teams.length, athletes: teams.reduce((n, t) => n + t.roster_count, 0), coaches: staff.length,
      tournaments: allTn.length, travel_tournaments: allTn.filter((t) => t.travel).length, qualifiers: allTn.filter((t) => t.qualifier).length, states: states.size,
    },
    venues: { warehouse: venueOut(VENUES.warehouse), flex: venueOut(VENUES.flex) },
    teams, staff, tournaments: allTn, this_weekend,
    links: { hq: APP, hub: `${APP}/hub`, calendar_index: `${APP}/api/calendar` },
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
