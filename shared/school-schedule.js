// Turning what parents pasted into a schedule.
//
// The `schedule` box on the school-team form says "rough is fine", and families
// took that at its word. What comes back is one of four things:
//
//   A. a tab-separated table copied out of a spreadsheet
//        8/27/26 \t Dripping Springs \t @DSMS \t 5:15 \t 6:30
//   B. a bare list of dates, sometimes with one time for all of them
//        "All games are at 6pm" / 8/27 / 8/29 tournament / 9/3
//   C. a whole high-school schedule pasted as text, where the month is a header
//      and each row starts with a day number
//        AUGUST / 10 Mon Westwood/Rouse Away 5:00/7:00 ...
//   D. a link, and nothing else
//
// A, B and C are parsed here. D can't be — a PDF on the district's asset host is
// not something this can read — so those are reported as needing a human rather
// than quietly counted as covered.
//
// Everything is best-effort by design: a wrong game on the master schedule is
// worse than a missing one, so anything ambiguous is dropped rather than
// guessed. Each game keeps the line it came from, so a coach can always see
// what we read it out of.

// The season runs Aug–Dec. A bare "9/3" is this autumn; a bare "1/9" would be
// the following January.
const SEASON_START_YEAR = 2026;
const yearFor = (month) => (month >= 7 ? SEASON_START_YEAR : SEASON_START_YEAR + 1);

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7,
  aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_HEADER_RE = /^\s*(january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
const URL_RE = /https?:\/\/\S+/gi;

const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const valid = (m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31;
// Anything outside the season isn't a game this season. A practice calendar
// grid produced "2017-08-01" out of two adjacent cells; a copyright footer
// produces worse. Cheap guard, and it costs nothing real.
const SEASON_FROM = `${SEASON_START_YEAR}-07-01`;
const SEASON_TO   = `${SEASON_START_YEAR + 1}-06-30`;
const inSeason = (isoDate) => isoDate >= SEASON_FROM && isoDate <= SEASON_TO;

// School names arrive spelled every possible way — "Wimberly High School",
// "Westlake high school", "Gorzycki", "@DSMS". Compare on this.
//
// The tier word STAYS. Dripping Springs has a middle school and a high school
// with 28 and 9 of our girls in them; folding both to "dripping springs" put
// seventh graders on the board against Westlake varsity. Anything that loses
// the tier is worse than useless here — it invents matchups.
const STOPWORDS = new Set(["the", "school", "junior", "jr", "academy", "catholic", "prep", "episcopal", "st", "saint", "isd"]);
const TIER_WORDS = { middle: "middle", ms: "middle", high: "high", hs: "high", intermediate: "middle" };
export function schoolKey(name) {
  const words = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(w => TIER_WORDS[w] || w)
    .filter(w => !STOPWORDS.has(w));
  // One tier word, at the end, however the name was written.
  const tier = words.find(w => w === "middle" || w === "high") || null;
  const rest = words.filter(w => w !== "middle" && w !== "high");
  return [...rest, tier].filter(Boolean).join(" ").trim();
}

// Which tier a team level belongs to. A schedule's own level tells us whether a
// bare opponent like "Dripping Springs" means the middle school or the high
// school, because schools only play their own tier.
export function tierForLevel(level) {
  const s = String(level || "").toLowerCase();
  if (/^\s*[678]/.test(s) || s.includes("grade")) return "middle";
  if (/varsity|jv|freshman|flex|9th/.test(s)) return "high";
  return null;
}

// An opponent written without a tier ("Dripping Springs", "@DSMS") resolves
// within the tier of the schedule it appeared on.
export function opponentKey(name, tier) {
  const k = schoolKey(name);
  if (!k) return null;
  if (k.endsWith(" middle") || k.endsWith(" high") || k === "middle" || k === "high") return k;
  return tier ? k + " " + tier : k;
}

// Abbreviations that show up in the "site" column of a middle-school schedule.
// Only ones we're sure of — a wrong expansion invents a matchup that isn't real.
const ABBREV = {
  dsms: "dripping springs middle",
  dshs: "dripping springs high",
  ssms: "sycamore springs middle",
  bcms: "bee cave middle",
  hbms: "hudson bend middle",
  ltms: "lake travis middle",
  lths: "lake travis high",
  wrms: "west ridge middle",
  hcms: "hill country middle",
};
export function expandAbbrev(text) {
  const k = String(text || "").toLowerCase().replace(/[^a-z]/g, "");
  return ABBREV[k] || null;
}

const TIME_RE = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)?\b/gi;
function timesIn(text) {
  const out = [];
  for (const m of String(text || "").matchAll(TIME_RE)) {
    // A bare number is only a time when it has minutes or an am/pm — otherwise
    // "8th A" and a jersey number both become 8 o'clock.
    if (!m[2] && !m[3]) continue;
    const h = parseInt(m[1], 10);
    const mm = m[2] || "00";
    const ap = (m[3] || "").toLowerCase();
    // Volleyball is an after-school sport: 5:15 means the evening.
    const pm = ap ? ap === "pm" : h < 8;
    out.push(`${h}:${mm}${pm ? "pm" : "am"}`);
  }
  return [...new Set(out)];
}

// "Away", "Home", "@SSMS" → where it's played, from our side.
function siteOf(text) {
  const s = String(text || "");
  if (/\baway\b/i.test(s)) return { home: false, venue: null };
  if (/\bhome\b/i.test(s)) return { home: true, venue: null };
  const at = /@\s*([A-Za-z][\w'.-]{0,30})/.exec(s);
  if (at) return { home: null, venue: at[1].trim() };
  // "(at Anderson)", the way one district writes the same thing.
  const paren = /\(\s*at\s+([^)]{1,40})\)/i.exec(s);
  if (paren) return { home: null, venue: paren[1].trim() };
  return { home: null, venue: null };
}

// Lines that are a schedule's furniture, not a game.
const NOISE_RE = /^(date|day|opponent|site|time|location|week|\s*$)/i;
const NOT_A_GAME_RE = /\b(parent meeting|team pictures?|picture day|bye week|no school|practice|banquet|meet the|pep rally|updated|head coach|assistant coach|athletic coordinator|try\s?outs?|cuts|team selections|1st day of school|first day of school)\b/i;

function cleanOpponent(text) {
  let s = String(text || "")
    // Times first. A column of "5:00/7:00" looks like a date to the date
    // stripper, which otherwise leaves ": :00" sitting in the opponent name.
    .replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)?(?:\s*\/\s*\d{1,2}:\d{2}\s*(?:am|pm)?)*/gi, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ")
    .replace(/\(\s*at\s+[^)]*\)/gi, " ")
    .replace(/@\s*[\w'.-]+/g, " ")
    .replace(/\b(home|away|tba|tbd)\b/gi, " ")
    .replace(TIME_RE, " ")
    .replace(/\b(mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)[a-z]*\b/gi, " ")
    .replace(/[-–—]{2,}/g, " ")
    .replace(/["'\t]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[.,;:\-–—\s]+|[.,;:\-–—\s]+$/g, "");
  const vs = /\bvs\.?\s+(.+)$/i.exec(s);
  if (vs) s = vs[1].trim();
  // A row that's only punctuation or a stray number carries no opponent.
  if (!/[a-z]{3}/i.test(s)) return null;
  return s.slice(0, 120);
}

/**
 * Parse a pasted schedule into games.
 * @param {string} text            what the family pasted
 * @param {object} opts
 * @param {string} opts.level      the team level from their form answer
 * @returns {{games: Array, links: string[], parsed: boolean}}
 */
export function parseSchedule(text, { level = null } = {}) {
  const src = String(text || "");
  const links = [...new Set((src.match(URL_RE) || []).map(u => u.replace(/[),.]+$/, "")))];
  const body = src.replace(URL_RE, " ");

  const games = [];
  const seen = new Set();
  const push = (g) => {
    // "Updated 5/8/26" in a footer is a date, but it isn't anything to attend.
    if (!g.is_game && !g.note) return;
    if (!inSeason(g.game_date)) return;
    const k = g.game_date + "|" + (g.opponent || "") + "|" + (g.note || "");
    if (seen.has(k)) return;
    seen.add(k);
    games.push(g);
  };

  // A single time stated for the whole list ("All games are at 6pm").
  const blanketTimes = /\ball games?\b[^\n]*/i.test(body)
    ? timesIn((/\ball games?\b[^\n]*/i.exec(body) || [""])[0])
    : [];

  let monthCtx = null;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/ /g, " ").trimEnd();
    if (!line.trim() || NOISE_RE.test(line)) {
      const mh = MONTH_HEADER_RE.exec(line);
      if (mh) monthCtx = MONTHS[mh[1].slice(0, 3).toLowerCase()];
      continue;
    }
    const mh = MONTH_HEADER_RE.exec(line);
    if (mh && line.trim().length < 24) { monthCtx = MONTHS[mh[1].slice(0, 3).toLowerCase()]; continue; }

    const cells = line.includes("\t") ? line.split("\t").map(c => c.trim()) : null;

    // ── explicit M/D dates, anywhere in the line ──────────────────────────
    const explicit = [...line.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)]
      .filter(m => valid(parseInt(m[1], 10), parseInt(m[2], 10)));
    if (explicit.length) {
      // Several dates on one line is a list ("Games on 9/8, 9/10, 9/17"), and
      // nothing in it belongs to any single date — so no opponent is claimed.
      const isList = explicit.length > 1 && !cells;
      let pushed = 0;
      for (const m of explicit) {
        const mo = parseInt(m[1], 10), d = parseInt(m[2], 10);
        let y = m[3] ? parseInt(m[3], 10) : yearFor(mo);
        if (y < 100) y += 2000;
        const isGame = !NOT_A_GAME_RE.test(line);
        // A tab-separated row is a spreadsheet: date, opponent, site, times.
        const oppText = cells ? (cells[1] || "") : line.slice(m.index + m[0].length);
        const siteText = cells ? [cells[1], cells[2]].join(" ") : oppText;
        const timeText = cells ? cells.slice(2).join(" ") : oppText;
        const site = siteOf(siteText);
        const t = timesIn(timeText);
        const label = isList ? null : cleanOpponent(oppText);
        push({
          game_date: iso(y, mo, d),
          opponent: isGame ? label : null,
          note: isGame ? null : label,
          is_game: isGame,
          home: site.home,
          venue: site.venue,
          times: t.length ? t : blanketTimes,
          level,
          raw: line.trim().slice(0, 300),
        });
        pushed++;
      }
      if (pushed) continue;
    }

    // ── day-of-month rows under a MONTH header ────────────────────────────
    // "10 Mon Westwood/Rouse Away 5:00/7:00 …" and ranges like "13-15 Thu-Sat".
    if (monthCtx) {
      const dm = /^\s*(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s+(.*)$/.exec(line);
      if (dm) {
        const d = parseInt(dm[1], 10);
        if (valid(monthCtx, d)) {
          const rest = dm[3];
          const isGame = !NOT_A_GAME_RE.test(line);
          const site = siteOf(rest);
          push({
            game_date: iso(yearFor(monthCtx), monthCtx, d),
            opponent: isGame ? cleanOpponent(rest) : null,
            note: isGame ? null : cleanOpponent(rest),
            is_game: isGame,
            home: site.home,
            venue: site.venue,
            times: timesIn(rest),
            level,
            multi_day_end: dm[2] && valid(monthCtx, parseInt(dm[2], 10))
              ? iso(yearFor(monthCtx), monthCtx, parseInt(dm[2], 10)) : null,
            raw: line.trim().slice(0, 300),
          });
        }
      }
    }
  }

  games.sort((a, b) => a.game_date.localeCompare(b.game_date));
  return { games, links, parsed: games.length > 0 };
}
