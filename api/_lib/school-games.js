// Parse one family's pasted schedule into school_games.
//
// Called from the form endpoints right after the answer is saved, so the master
// schedule updates the moment a family sends theirs in. The nightly rebuild
// (scripts/parse-school-schedules.mjs) is still the source of truth — it re-reads
// every answer from scratch — this just avoids waiting for it.
//
// Rows are keyed to the school, and the table's unique index does the deduping:
// the fourth parent at Sycamore Springs adds nothing new, which is correct.

import { parseSchedule, schoolKey, opponentKey, tierForLevel, expandAbbrev } from "../../shared/school-schedule.js";

export async function saveSchoolGames(supabase, report) {
  const text = String(report?.schedule || "").trim();
  const school = String(report?.school || "").trim();
  if (text.length < 5 || !school) return 0;

  const { games } = parseSchedule(text, { level: report.team_level });
  if (!games.length) return 0;

  const key = schoolKey(school);
  const tier = tierForLevel(report.team_level)
    || (key.endsWith(" high") ? "high" : key.endsWith(" middle") ? "middle" : null);

  const rows = games.map(g => ({
    school_key: key,
    school_name: school,
    game_date: g.game_date,
    end_date: g.multi_day_end || null,
    opponent: g.opponent || null,
    opponent_key: g.opponent
      ? opponentKey(g.opponent, tier)
      : (g.venue ? schoolKey(expandAbbrev(g.venue) || "") || null : null),
    note: g.note || null,
    is_game: g.is_game,
    home: g.home,
    venue: g.venue || null,
    times: g.times || [],
    level: g.level || null,
    raw: g.raw || null,
    source_report_id: report.id || null,
  }));

  // Never let a schedule parse fail the form submission the family just made.
  try {
    const { error } = await supabase.from("school_games")
      .upsert(rows, { onConflict: "school_key,game_date,opponent,level", ignoreDuplicates: true });
    if (error) { console.error("school_games upsert:", error.message); return 0; }
    return rows.length;
  } catch (e) {
    console.error("school_games upsert threw:", e?.message);
    return 0;
  }
}
