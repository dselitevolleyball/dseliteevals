-- Drew's corrections (2026-09-04):
--   15 Diamond plays the 16U division at Paniolo, not a "16 Diamond" bracket.
--   Both teams are in Club divisions there.
--   Fast Warm Up is a two-day tournament with travel the day before, not a three-day format.
update public.tournament_assignments set
  division = 'Club',
  notes    = 'Plays up into 16U. Build toward Fast Warm Up (Open) then the West Coast NQ. Breanna Coward not travelling (13 Ruby is in San Antonio Dec 5) — sub assistant needed.'
where tournament_id = 146 and team_id = '15 Diamond';

update public.tournaments set
  notes = 'Step one of the December build toward the first qualifier. Paniolo (Dec 5-6, Fort Worth) prepares the teams for Fast Warm Up (Dec 12-13, Houston, Open division), which in turn prepares them for the West Coast Juniors National Qualifier (Anaheim, Jan 9-11). No 15U bracket here — 15 Diamond plays up into 16U. Both teams in Club divisions. Entry $400/team regular pricing. Fort Worth is a 3.5-4 hour drive; club hotel block being arranged. First of two back-to-back travel weekends.',
  updated_at = now()
where id = 146;

-- Fast Warm Up: two days of play, travel the day before (Fri Dec 11).
update public.tournaments set
  format     = 'Two Day Format',
  notes      = coalesce(nullif(btrim(notes),'') || ' ', '') || 'Two days of play, Dec 12-13, with travel to Houston the day before (Fri Dec 11).',
  updated_at = now()
where id = 223;

select 'paniolo' as ev, team_id, division, status from public.tournament_assignments where tournament_id=146
union all select 'fastwarmup', team_id, division, status from public.tournament_assignments where tournament_id=223
order by ev, team_id;
