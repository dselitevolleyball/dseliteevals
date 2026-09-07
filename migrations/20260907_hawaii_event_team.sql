-- "13 Diamond Hawaii": a tournament-only roster for SPAM Slam (id 167, Honolulu,
-- Mar 13-14 2027).
--
-- The team that flies is not 13 Diamond. Five of 13 Diamond committed and five
-- declined, and four players come from 13 Ruby and 14 Ruby to fill it out.
-- Assigning "13 Diamond" to the tournament therefore addresses the wrong nine
-- people: it mails five families who are not going and misses four who are.
--
-- So it becomes its own team, in both registries the app keeps — `teams` (which
-- tournament_assignments has a foreign key into) and `practice_teams` (which
-- travel and coach lookups resolve staff through). Every practice day is false
-- and practices_per_week is 0, which is all "no practice" means here; it also
-- has no rows in practice_assignments, so nothing schedules it.
--
-- Sam Robinson leads it — he already heads 13 Diamond — with Jayden Wright
-- assisting, who heads 14 Ruby where three of the borrowed players come from.
-- Neither has a conflict: 15 Emerald and 14 Ruby are both idle that weekend.
--
-- Membership lives in hawaii_interest.hawaii_team, which already existed for
-- exactly this and already pointed the four borrowed players at "13 Diamond".
-- Nobody's team_assignment changes — these girls are on their own teams for
-- everything else, and hear from their own coaches for everything else.

insert into public.teams
  (id, division, level, practice_sun, practice_mon, practice_wed, practice_thur,
   has_summer, head_coach, assistant_coach, active, sort_order, notes)
values
  ('13 Diamond Hawaii', 'U13', 'National', false, false, false, false,
   false, 'Sam Robinson', 'Jayden Wright', true, 13,
   'TOURNAMENT ONLY - SPAM Slam Hawaii, Mar 13-14 2027. Retire after the event.')
on conflict (id) do update set
  head_coach = excluded.head_coach, assistant_coach = excluded.assistant_coach,
  notes = excluded.notes, active = excluded.active;

insert into public.practice_teams
  (team_name, level, age_div, head_coach, assistant_coach, practices_per_week, notes)
values
  ('13 Diamond Hawaii', 'National', 'U13', 'Sam Robinson', 'Jayden Wright', 0,
   'TOURNAMENT ONLY - SPAM Slam Hawaii, Mar 13-14 2027. Not a practicing team and has no practice slots. Roster is drawn from 13 Diamond, 13 Ruby and 14 Ruby; players keep their real team_assignment. Membership is hawaii_interest.hawaii_team = ''13 Diamond Hawaii''. Retire this row after the tournament.')
on conflict (team_name) do update set
  head_coach = excluded.head_coach, assistant_coach = excluded.assistant_coach,
  practices_per_week = excluded.practices_per_week, notes = excluded.notes;

-- The nine going: the five from 13 Diamond who committed, plus the four
-- borrowed who were already pointed at "13 Diamond".
update public.hawaii_interest h set
  hawaii_team = '13 Diamond Hawaii',
  updated_at  = now(),
  updated_by  = 'migration 20260907'
from public.players p
where p.id = h.player_id
  and h.status = 'committed'
  and (h.hawaii_team = '13 Diamond'
       or (coalesce(btrim(h.hawaii_team),'') = '' and p.team_assignment = '13 Diamond'));

-- Point the tournament at the new team. The asst_override that carried Jayden
-- is dropped: he is the assistant on this team now, so the override would say
-- the same thing twice and the two could drift apart.
update public.tournament_assignments set
  team_id       = '13 Diamond Hawaii',
  asst_override = null,
  notes         = 'Tournament-only roster: the 13 Diamond players who committed, plus four from 13 Ruby and 14 Ruby.'
where tournament_id = 167 and team_id = '13 Diamond';

select p.first_name || ' ' || p.last_name as player, p.team_assignment as home_team
from public.hawaii_interest h join public.players p on p.id = h.player_id
where h.hawaii_team = '13 Diamond Hawaii'
order by p.team_assignment, p.last_name;
