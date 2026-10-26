// DS Elite's side of Court Availability, per date: practices (from the same
// day-schedule builder the Day Schedule uses), scrimmages (teams sharing one
// court) and the in-house tournament (team_events on "Court N"). Shared by the
// admin screen (browser, signed-in client) and the members' public page
// (server, service-role client) so the two never disagree.
import { daySchedule, span } from "./day-schedule.js";

export async function loadDseCourtInputs(sb, dates) {
  const first = dates[0], last = dates[dates.length - 1];
  const [days, scrR, evR] = await Promise.all([
    Promise.all(dates.map(d => daySchedule(sb, d))),
    sb.from("practice_scrimmages").select("practice_date, slot, teams, court").gte("practice_date", first).lte("practice_date", last),
    sb.from("team_events").select("team_name, event_date, start_time, duration_min, location, title").gte("event_date", first).lte("event_date", last).or("title.ilike.Tournament%,title.ilike.Practice%"),
  ]);
  // A failed read must not look like an empty (all-free) day.
  if (scrR.error || evR.error) throw new Error("DS Elite schedule didn't load: " + (scrR.error || evR.error).message);
  const out = {};
  dates.forEach((d, i) => {
    const day = days[i];
    const teams = (day?.teams || []).map(t => ({ team: t.team, blocks: t.blocks, court: Number(t.court) || null, courtAt: t.courtAt || [], venue: t.venue || null }));
    // Scrimmages only on practice days, and only for teams practicing that day.
    const onToday = new Set(teams.map(t => t.team));
    const scrims = (day?.cancelled ? [] : (scrR.data || []).filter(s => s.practice_date === d && (s.teams || []).some(t => onToday.has(t))))
      .map(s => { const [a, b] = span(s.slot); return { start: a, end: b, teams: s.teams || [], court: Number(String(s.court || "").replace(/\D/g, "")) || null }; })
      .filter(s => s.start < 99);
    // In-house tournament: one booking per court per match time.
    const seen = new Set(), tourn = [];
    // One-off practices (team_events titled "Practice", Drew Oct 21 2026: 14 Diamond's
    // extra Thursdays) take the courts their location names: "Courts 5 & 6", "Court 3".
    for (const e of (evR.data || []).filter(x => x.event_date === d && /^Practice/i.test(x.title || ""))) {
      const m = /^(\d{1,2}):(\d{2})/.exec(e.start_time || ""); if (!m) continue;
      // Court numbers are one or two digits; the street address after them
      // ("Court 2 - 15113 Fitzhugh Rd") is not a range.
      const cm = /courts?\s*((?:\d{1,2}\b\s*(?:,|&|and|-|–|to)?\s*)+)/i.exec(e.location || ""); const nums = cm ? cm[1].match(/\b\d{1,2}\b/g) || [] : [];
      const lo = nums.length === 2 && /\d\s*(?:-|–|to)\s*\d/.test(cm[1]) ? Math.min(...nums.map(Number)) : null, hi = lo != null ? Math.max(...nums.map(Number)) : null;
      const courts = (lo != null ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) : nums.map(Number)).filter(n => n >= 1 && n <= 6).map(n => "V" + n);
      if (!courts.length) continue;
      const st = +m[1] + +m[2] / 60;
      tourn.push({ courts, start: st, end: st + (Number(e.duration_min) || 120) / 60, kind: "dse", label: (e.team_name || "DS Elite") + " practice", detail: "Extra practice" });
    }
    for (const e of (evR.data || []).filter(x => x.event_date === d && /^Tournament/i.test(x.title || ""))) {
      const n = Number(String(e.location || "").replace(/\D/g, "")); const m = /^(\d{1,2}):(\d{2})/.exec(e.start_time || "");
      if (!(n >= 1 && n <= 6) || !m) continue;
      const s = +m[1] + +m[2] / 60, k = n + "|" + s; if (seen.has(k)) continue; seen.add(k);
      tourn.push({ courts: ["V" + n], start: s, end: s + (Number(e.duration_min) || 60) / 60, kind: "tourn", label: "In-House Tournament", detail: String(e.title || "").replace(/^Tournament\s*[—-]\s*/, "") });
    }
    out[d] = { teams, scrims, tourn, cancelled: day?.cancelled || null, phase: day?.phaseLabel || "" };
  });
  return out;
}
