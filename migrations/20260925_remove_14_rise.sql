-- 20260925 — Remove "14 Rise 1" from the platform. The team never got coaches
-- or players (Drew, 25 Sep 2026). Same shape as 20260630_remove_12rise2_16ruby.
-- The static lists in src/App.jsx (TM, NO_FALL_TEAMS, NO_SUMMER_TEAMS) are
-- edited in the same commit.
--
-- Run: node scripts/run-sql.mjs migrations/20260925_remove_14_rise.sql
-- Destructive but scoped to the one named team. Deleting from public.teams
-- cascades to tournament_assignments.

-- Staffing board: the two open "no coaches at all" needs and any matches on them
DELETE FROM public.staffing_matches WHERE need_id IN (SELECT id FROM public.staffing_needs WHERE team_name = '14 Rise 1');
DELETE FROM public.staffing_needs   WHERE team_name = '14 Rise 1';

-- SportsYou outbox: the one failed logo post ("no SportsYou team match")
DELETE FROM public.sportsyou_outbox WHERE team_name = '14 Rise 1';

-- Practice planner
DELETE FROM public.practice_assignments WHERE team_name = '14 Rise 1';
DELETE FROM public.sa_sessions          WHERE team_name = '14 Rise 1';
DELETE FROM public.practice_approvals   WHERE team_name = '14 Rise 1';
DELETE FROM public.practice_coverage    WHERE team_name = '14 Rise 1';
DELETE FROM public.team_events          WHERE team_name = '14 Rise 1';
DELETE FROM public.practice_teams       WHERE team_name = '14 Rise 1';

-- Team operations board
DELETE FROM public.team_tasks     WHERE team_name = '14 Rise 1';
DELETE FROM public.team_questions WHERE team_name = '14 Rise 1';
DELETE FROM public.team_status    WHERE team_name = '14 Rise 1';
UPDATE public.updates SET team_name = NULL WHERE team_name = '14 Rise 1';

-- Tournament planner team list (cascades to tournament_assignments)
DELETE FROM public.teams WHERE id = '14 Rise 1';

-- Safety net: nobody is on the team today, but never leave a player pointing at it
UPDATE public.players SET team_assignment = '' WHERE team_assignment = '14 Rise 1';

SELECT (SELECT count(*) FROM public.practice_teams WHERE team_name = '14 Rise 1')
     + (SELECT count(*) FROM public.teams WHERE id = '14 Rise 1')
     + (SELECT count(*) FROM public.staffing_needs WHERE team_name = '14 Rise 1') AS remaining_refs;
