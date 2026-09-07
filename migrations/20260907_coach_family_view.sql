-- Weekends where a coach is at a tournament for her team AND her own kid's team
-- is there too. One trip, two hats — the room and car math is different from a
-- coach travelling alone, and travel planning needs to see it.
create or replace view public.coach_family_tournaments as
select
  t.id                as tournament_id,
  t.name              as tournament,
  t.start_date, t.end_date, t.location,
  btrim(cr.first_name||' '||cr.last_name) as coach,
  ct.team_id          as coach_team,
  btrim(p.first_name||' '||p.last_name)   as child,
  p.team_assignment   as child_team,
  (ct.team_id = p.team_assignment)        as same_team,
  cc.travels_as_family,
  (not (t.location ilike '%, TX%' or t.location ilike '%texas%')) as out_of_state
from public.coach_children cc
join public.coach_roster cr on cr.id = cc.coach_roster_id
join public.players p       on p.id  = cc.player_id
join public.practice_teams pt
  on lower(btrim(pt.head_coach))      = lower(btrim(cr.first_name||' '||cr.last_name))
  or lower(btrim(pt.assistant_coach)) = lower(btrim(cr.first_name||' '||cr.last_name))
join public.tournament_assignments ct on ct.team_id = pt.team_name
join public.tournaments t             on t.id = ct.tournament_id
join public.tournament_assignments kt on kt.tournament_id = t.id and kt.team_id = p.team_assignment
where coalesce(t.cancelled, false) = false;

comment on view public.coach_family_tournaments is
  'Tournaments where a coach staffs one team and her own child is there on another (or the same) team. same_team = one team, one trip. Otherwise the coach is on site in both roles.';

select tournament, start_date, location, coach, coach_team, child, child_team, same_team, out_of_state
from public.coach_family_tournaments
order by start_date, coach;
