-- 20260826 — add 14 Rise 1
--
-- A team has to exist in two places to be real: `teams` (roster, team cards,
-- everything the club side reads) and `practice_teams` (practice planning and
-- coverage). A row in only one of them shows up as a team that can't be
-- scheduled, or a schedule for a team nobody can be assigned to.
--
-- Named to match its siblings — 11 Rise 1, 12 Rise 1, 13 Rise 1 — and set up
-- like them: developmental, Monday practice, no coaches yet.
--
-- sort_order inserts it after the other U14s, which means everything from
-- 13 Diamond down shifts by one. The whole guard is the "not already there"
-- check on the insert, so re-running this can't shift twice.
--
-- Run: node scripts/run-sql.mjs migrations/20260826_team_14_rise_1.sql
-- Idempotent.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = '14 Rise 1') THEN

    UPDATE public.teams SET sort_order = sort_order + 1 WHERE sort_order >= 12;

    INSERT INTO public.teams
      (id, division, level, head_coach, assistant_coach,
       practice_sun, practice_mon, practice_wed, practice_thur,
       has_summer, active, sort_order)
    VALUES
      ('14 Rise 1', 'U14', 'Developmental', NULL, NULL,
       false, true, false, false,
       true, true, 12);
  END IF;
END $$;

INSERT INTO public.practice_teams (team_name, level, age_div, practices_per_week, locked)
VALUES ('14 Rise 1', 'Developmental', 'U14', 2, false)
ON CONFLICT (team_name) DO NOTHING;
