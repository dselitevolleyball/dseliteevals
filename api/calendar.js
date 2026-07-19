// Vercel serverless function: live per-team practice calendar as an iCal feed.
//
//   GET /api/calendar?team=14%20Diamond   → text/calendar (.ics) for that team
//   GET /api/calendar                     → HTML index of every team's feed URL
//
// Built for sportsYou's "Import External Calendar (URL)" — paste a team's feed
// URL once and the team calendar stays in sync with the practice planner:
// summer/fall Sundays (dated), Fall S&A sessions, weekly regular-season and
// post-season practices (with holiday cancellations excluded), and each
// team's DS Elite Orientation Night.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (read-only queries).

const TZ = "America/Chicago";
const SUMMER_SUNDAYS = ["2026-07-12","2026-07-19","2026-07-26","2026-08-02","2026-08-09","2026-08-16","2026-08-23","2026-08-30","2026-09-06"];
const FALL1_SUNDAYS  = ["2026-09-13","2026-09-20","2026-09-27","2026-10-04","2026-10-11"];
const FALL2_SUNDAYS  = ["2026-10-18","2026-10-25","2026-11-01","2026-11-08","2026-11-15"];
const SEASON_START = "2026-11-29", SEASON_END = "2027-05-06";   // Regionals end May 6
const POST_START   = "2027-05-07", POST_END   = "2027-06-15";   // Nationals through mid-June
const ORIENTATION = { 11:"2026-09-25", 12:"2026-09-25", 13:"2026-09-18", 14:"2026-09-11", 15:"2026-09-12", 16:"2026-09-19", 17:"2026-09-19" };
const DOW = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };

const to24 = (h) => (h === 12 ? 12 : h + 12); // slots are all afternoon/evening
const slotTimes = (slot) => {
  const m = /^(\d+)\s*-\s*(\d+)/.exec(slot || "");
  if (!m) return null;
  return [to24(+m[1]), to24(+m[2])];
};
const pad = (n) => String(n).padStart(2, "0");
const dt = (iso, hour) => iso.replace(/-/g, "") + "T" + pad(hour) + "0000";
const icsEsc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const firstOnOrAfter = (iso, dow) => {
  const d = new Date(iso + "T12:00:00Z");
  while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const datesBetween = (startIso, endIso, dow) => {
  const out = [];
  let cur = firstOnOrAfter(startIso, dow);
  while (cur <= endIso) {
    out.push(cur);
    const d = new Date(cur + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + 7);
    cur = d.toISOString().slice(0, 10);
  }
  return out;
};

const VTIMEZONE = [
  "BEGIN:VTIMEZONE", "TZID:" + TZ,
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0600", "TZOFFSETTO:-0500", "TZNAME:CDT", "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0600", "TZNAME:CST", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
  "END:VTIMEZONE",
].join("\r\n");

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).send("Server not configured.");
  const H = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY };
  const q = (path) => fetch(SUPABASE_URL + "/rest/v1/" + path, { headers: H }).then(r => r.json());

  const team = (req.query.team || "").trim();
  if (!team) {
    // Index page: every team with its copyable feed URL.
    const teams = await q("practice_teams?select=team_name&order=team_name");
    const host = "https://" + (req.headers["x-forwarded-host"] || req.headers.host);
    const rows = (Array.isArray(teams) ? teams : []).map(t =>
      `<tr><td style="padding:6px 14px 6px 0;font-weight:700">${t.team_name}</td><td><code>${host}/api/calendar?team=${encodeURIComponent(t.team_name)}</code></td></tr>`).join("");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(`<html><body style="font-family:sans-serif;padding:24px"><h2>DS Elite team calendar feeds</h2>
      <p>In sportsYou: team calendar → <b>Import External Calendar</b> → paste the team's URL below.</p>
      <table>${rows}</table></body></html>`);
  }

  const enc = encodeURIComponent(team);
  const [assigns, saRows, cancels] = await Promise.all([
    q("practice_assignments?team_name=eq." + enc + "&select=day,slot,phase,court"),
    q("sa_sessions?team_name=eq." + enc + "&select=session_date,slot,block"),
    q("practice_cancellations?select=practice_date,team_name"),
  ]);
  if (!Array.isArray(assigns)) return res.status(500).send("Query failed.");
  // A cancellation hits this team's feed if it's whole-day (team_name empty) or
  // targets this team specifically.
  const cancelled = new Set((Array.isArray(cancels) ? cancels : [])
    .filter(c => !c.team_name || c.team_name === team)
    .map(c => c.practice_date));

  const ev = [];
  const push = (uid, summary, startIso, sHour, eHour, opts = {}) => {
    const lines = [
      "BEGIN:VEVENT",
      "UID:" + uid + "@dseliteevals",
      "DTSTAMP:20260702T000000Z",
      `DTSTART;TZID=${TZ}:` + dt(startIso, sHour),
      `DTEND;TZID=${TZ}:` + dt(startIso, eHour),
      "SUMMARY:" + icsEsc(summary),
    ];
    if (opts.location) lines.push("LOCATION:" + icsEsc(opts.location));
    if (opts.rruleUntil) lines.push("RRULE:FREQ=WEEKLY;UNTIL=" + opts.rruleUntil.replace(/-/g, "") + "T235959Z");
    for (const ex of opts.exdates || []) lines.push(`EXDATE;TZID=${TZ}:` + dt(ex, sHour));
    lines.push("END:VEVENT");
    ev.push(lines.join("\r\n"));
  };

  // Venue + court in the LOCATION so it lands on the SportsYou calendar map.
  // Summer: courts 1-4 at the Warehouse, court 5 at the Flex building.
  // Fall 1 / Fall 2 / Regular Season / Post Season: all at the Warehouse.
  const WAREHOUSE = "Dripping Springs Sports Club — Warehouse";
  const FLEX      = "Dripping Springs Sports Club — Flex";
  const WAREHOUSE_ADDR = "15113 Fitzhugh Rd, Suite 1400, Dripping Springs, TX";
  const FLEX_ADDR      = "13673 Fitzhugh Rd, Suite 200, Dripping Springs, TX";
  const courtLabel = (c) => (c != null && c !== "") ? ("Court " + c) : "";
  const locFor = (a) => {
    const flex = (a.phase || "season") === "summer" && Number(a.court) === 5;
    const cl = courtLabel(a.court);
    return (flex ? FLEX : WAREHOUSE) + (cl ? ", " + cl : "") + ", " + (flex ? FLEX_ADDR : WAREHOUSE_ADDR);
  };
  const WAREHOUSE_LOC = WAREHOUSE + ", " + WAREHOUSE_ADDR; // S&A / orientation (no court)
  // Dated Sundays: summer / fall1 / fall2
  const datedPhases = [["summer", SUMMER_SUNDAYS], ["fall1", FALL1_SUNDAYS], ["fall2", FALL2_SUNDAYS]];
  for (const [phase, dates] of datedPhases) {
    for (const a of assigns.filter(x => (x.phase || "season") === phase && x.day === "Sun")) {
      const t = slotTimes(a.slot); if (!t) continue;
      for (const d of dates) {
        if (cancelled.has(d)) continue;
        push(`${team}-${phase}-${d}-${a.slot}`.replace(/\s+/g, "_"), team + " Practice", d, t[0], t[1], { location: locFor(a) });
      }
    }
  }
  // Fall Speed & Agility (already dated rows)
  for (const s of (Array.isArray(saRows) ? saRows : [])) {
    const t = slotTimes(s.slot); if (!t || !s.session_date || cancelled.has(s.session_date)) continue;
    push(`${team}-sa-${s.session_date}-${s.slot}`.replace(/\s+/g, "_"), team + " Speed & Agility", s.session_date, t[0], t[1], { location: WAREHOUSE_LOC });
  }
  // Weekly: regular season + post season
  const weekly = [["season", SEASON_START, SEASON_END], ["postseason", POST_START, POST_END]];
  for (const [phase, start, end] of weekly) {
    for (const a of assigns.filter(x => (x.phase || "season") === phase)) {
      const t = slotTimes(a.slot); const dow = DOW[a.day];
      if (!t || dow == null) continue;
      const first = firstOnOrAfter(start, dow);
      if (first > end) continue;
      const exdates = datesBetween(start, end, dow).filter(d => cancelled.has(d));
      push(`${team}-${phase}-${a.day}-${a.slot}`.replace(/\s+/g, "_"), team + " Practice", first, t[0], t[1], { location: locFor(a), rruleUntil: end, exdates });
    }
  }
  // Orientation Night (all-day)
  const age = parseInt(team.match(/^\d+/)?.[0] || "", 10);
  if (ORIENTATION[age]) {
    const d = ORIENTATION[age];
    ev.push(["BEGIN:VEVENT", "UID:" + (team + "-orientation").replace(/\s+/g, "_") + "@dseliteevals", "DTSTAMP:20260702T000000Z",
      "DTSTART;VALUE=DATE:" + d.replace(/-/g, ""),
      "SUMMARY:" + icsEsc("DS Elite Orientation Night — " + team),
      "DESCRIPTION:" + icsEsc("Jersey tryout, parent orientation, player commitment, and team building. First hour with parents; remaining three hours are team-only."),
      "LOCATION:" + icsEsc(WAREHOUSE_LOC), "END:VEVENT"].join("\r\n"));
  }

  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DS Elite HQ//Practice Calendar//EN",
    "CALSCALE:GREGORIAN", "X-WR-CALNAME:" + icsEsc("DS Elite " + team), "X-WR-TIMEZONE:" + TZ,
    VTIMEZONE, ...ev, "END:VCALENDAR"].join("\r\n");
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", 'inline; filename="' + team.replace(/\s+/g, "-") + '.ics"');
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).send(ics);
}
