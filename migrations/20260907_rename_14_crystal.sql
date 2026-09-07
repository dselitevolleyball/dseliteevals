-- Rename the SPAM Slam event team to "14 Crystal".
--
-- Both names are primary keys with children hanging off them, so this is
-- insert-repoint-delete rather than an in-place update:
--   teams.id            <- tournament_assignments.team_id
--   practice_teams.team_name <- team_events.team_name
--
-- Division moves to U14 to match the name. The roster is five 13 Diamond, one
-- 13 Ruby and three 14 Ruby, so it plays up as a 14s team rather than being a
-- 13s team with a 14 in its name.

-- teams: new row, repoint the tournament, drop the old.
insert into public.teams
  (id, division, level, practice_sun, practice_mon, practice_wed, practice_thur,
   has_summer, head_coach, assistant_coach, active, sort_order, notes)
select '14 Crystal', 'U14', level, practice_sun, practice_mon, practice_wed, practice_thur,
       has_summer, head_coach, assistant_coach, active, 14,
       'TOURNAMENT ONLY - SPAM Slam Hawaii, Mar 13-14 2027. Retire after the event.'
from public.teams where id = '13 Diamond Hawaii'
on conflict (id) do nothing;

update public.tournament_assignments set team_id = '14 Crystal'
where team_id = '13 Diamond Hawaii';

delete from public.teams where id = '13 Diamond Hawaii';

-- practice_teams: same shape. team_events has the foreign key, though this team
-- has no events yet.
insert into public.practice_teams
  (team_name, level, age_div, head_coach, assistant_coach, practices_per_week, notes)
select '14 Crystal', level, 'U14', head_coach, assistant_coach, 0,
  'TOURNAMENT ONLY - SPAM Slam Hawaii, Mar 13-14 2027. Not a practicing team and has no practice slots. Roster is drawn from 13 Diamond, 13 Ruby and 14 Ruby and plays up as a 14s team; players keep their real team_assignment. Membership is hawaii_interest.hawaii_team = ''14 Crystal''. Retire this row after the tournament.'
from public.practice_teams where team_name = '13 Diamond Hawaii'
on conflict (team_name) do nothing;

update public.team_events set team_name = '14 Crystal' where team_name = '13 Diamond Hawaii';
delete from public.practice_teams where team_name = '13 Diamond Hawaii';

-- Membership.
update public.hawaii_interest set hawaii_team = '14 Crystal', updated_at = now()
where hawaii_team = '13 Diamond Hawaii';

select 'teams' src, id as name, division, head_coach, assistant_coach from public.teams where id = '14 Crystal'
union all
select 'practice_teams', team_name, age_div, head_coach, assistant_coach from public.practice_teams where team_name = '14 Crystal';
