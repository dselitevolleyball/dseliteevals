-- Why Paniolo is on the calendar, in Drew's words (2026-09-04). Three-step build:
--   Dec 5-6   Paniolo Power Play, Fort Worth   — 14D in 14U, 15D up in 16 Diamond
--   Dec 12-13 Fast Warm Up, Houston            — both teams in the Open division
--   Jan 9-11  West Coast Juniors NQ, Anaheim   — first qualifier of the season
-- Each step is a level up on the one before it.
update public.tournaments set
  notes = 'Step one of the December build toward the first qualifier. Paniolo (Dec 5-6, Fort Worth) prepares the teams for Fast Warm Up (Dec 12-13, Houston, Open division), which in turn prepares them for the West Coast Juniors National Qualifier (Anaheim, Jan 9-11). No 15U bracket here — 15 Diamond plays up into 16 Diamond. Entry $400/team regular pricing. Fort Worth is a 3.5-4 hour drive; club hotel block being arranged. Note this is the first of two back-to-back travel weekends.',
  updated_at = now()
where id = 146;

update public.tournament_assignments set
  notes = 'Plays 14U. Build toward Fast Warm Up (Open) then the West Coast NQ.'
where tournament_id = 146 and team_id = '14 Diamond';

update public.tournament_assignments set
  notes = 'Plays up into the 16 Diamond bracket. Build toward Fast Warm Up (Open) then the West Coast NQ. Breanna Coward not travelling (13 Ruby is in San Antonio Dec 5) — sub assistant needed.'
where tournament_id = 146 and team_id = '15 Diamond';

select team_id, division, status, notes from public.tournament_assignments where tournament_id = 146 order by team_id;
