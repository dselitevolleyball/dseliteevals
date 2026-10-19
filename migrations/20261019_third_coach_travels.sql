-- Third coaches who don't travel with the team (Drew, Oct 19 2026). On 12 Diamond
-- Jillian Beck is the assistant at every tournament and Rene Sandoval (third
-- coach) only goes as a second sub to local events he's free for; on 15 Diamond
-- JD Barnes only goes where a tournament names him. With third_coach_travels =
-- false the travel-gap check counts the third coach only where the tournament
-- names them (head/asst override or sub_coach).
-- Run: node scripts/run-sql.mjs migrations/20261019_third_coach_travels.sql
ALTER TABLE public.practice_teams ADD COLUMN IF NOT EXISTS third_coach_travels boolean NOT NULL DEFAULT true;
UPDATE public.practice_teams SET third_coach_travels = false WHERE team_name IN ('12 Diamond', '15 Diamond');

-- Rene: second sub only at local 12 Diamond events with no 14 Ruby clash and no time off
-- (CTPL #1, CTPL #3, Round Rock Rumble). Off the San Antonio and Dallas overnights.
UPDATE public.tournament_assignments
   SET sub_coach = NULL, notes = trim(both ' ' from COALESCE(notes, '') || ' Rene not travelling: second sub at local events only (Oct 19 2026).')
 WHERE id IN (135, 19) AND team_id = '12 Diamond' AND sub_coach = 'Rene Sandoval';
UPDATE public.tournament_assignments SET sub_coach = 'Rene Sandoval'
 WHERE id IN (100, 101, 204) AND team_id = '12 Diamond';
SELECT string_agg(a.id || ' ' || t.start_date || ' ' || t.name || ' sub=' || COALESCE(a.sub_coach, '-'), ' ;; ' ORDER BY t.start_date) v
  FROM public.tournament_assignments a JOIN public.tournaments t ON t.id = a.tournament_id
 WHERE a.team_id = '12 Diamond' AND t.end_date >= '2026-10-19';
