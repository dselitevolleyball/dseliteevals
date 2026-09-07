-- Drew's calls on Paniolo (2026-09-04):
--   15 Diamond plays the 16 Diamond bracket
--   Breanna Coward is not travelling — she has 13 Ruby in San Antonio the same day.
--     15 Diamond needs a sub assistant for Dec 5-6.
--   A hotel block is being arranged (so it is no longer families-book-their-own).
update public.tournament_assignments set
  division = 'Diamond',
  notes    = 'Plays up into the 16 Diamond bracket. Breanna Coward not travelling (13 Ruby is in San Antonio Dec 5) — sub assistant needed.'
where tournament_id = 146 and team_id = '15 Diamond';

update public.tournaments set
  notes = 'Early-season competition five weeks ahead of the West Coast Juniors National Qualifier (Anaheim, Jan 9-11). No 15U bracket — 15 Diamond plays up into 16 Diamond. Entry $400/team at regular pricing. Fort Worth is roughly a 3.5-4 hour drive. Hotel block being arranged by the club.',
  updated_at = now()
where id = 146;

select ta.team_id, ta.division, ta.status, ta.sub_coach, ta.notes
from public.tournament_assignments ta where ta.tournament_id = 146 order by ta.team_id;
