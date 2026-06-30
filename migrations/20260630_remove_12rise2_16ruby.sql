-- 20260630 — Remove "12 Rise 2" and "16 Ruby" from the platform entirely.
-- These teams were phased out. The static team lists are removed in code
-- (TM map in src/App.jsx); this clears every DB row that references them.
--
-- Run ONCE in the Supabase SQL editor. Destructive but tightly scoped to the
-- two named teams. Deleting from public.teams cascades to
-- tournament_assignments (ON DELETE CASCADE).

-- Practice planner
DELETE FROM public.practice_assignments WHERE team_name IN ('12 Rise 2','16 Ruby');
DELETE FROM public.sa_sessions          WHERE team_name IN ('12 Rise 2','16 Ruby');
DELETE FROM public.practice_approvals   WHERE team_name IN ('12 Rise 2','16 Ruby');
DELETE FROM public.practice_teams       WHERE team_name IN ('12 Rise 2','16 Ruby');

-- Team operations board (status / tasks / questions / updates)
DELETE FROM public.team_tasks     WHERE team_name IN ('12 Rise 2','16 Ruby');
DELETE FROM public.team_questions WHERE team_name IN ('12 Rise 2','16 Ruby');
DELETE FROM public.team_status    WHERE team_name IN ('12 Rise 2','16 Ruby');
UPDATE public.updates SET team_name = NULL WHERE team_name IN ('12 Rise 2','16 Ruby');

-- Tournament planner team list (cascades to tournament_assignments)
DELETE FROM public.teams WHERE id IN ('12 Rise 2','16 Ruby');

-- Unassign any players who were still on these teams
UPDATE public.players SET team_assignment = '' WHERE team_assignment IN ('12 Rise 2','16 Ruby');
