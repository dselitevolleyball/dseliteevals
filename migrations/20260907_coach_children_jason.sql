-- Jason Baerwald -> Brooklynn Baerwald (12 Ruby). The auto-seed missed this one:
-- Brooklynn's record lists only her mother, Lindsay, as parent_name, so there was
-- no name to match Jason on. Confirmed by Drew 2026-09-07.
insert into public.coach_children (coach_roster_id, player_id, notes)
values (7, 10, 'Added by hand 2026-09-07 — Jason is not on the player record; parent_name is Lindsay Baerwald.')
on conflict (coach_roster_id, player_id) do nothing;

select btrim(cr.first_name||' '||cr.last_name) as coach,
       btrim(p.first_name||' '||p.last_name) as child,
       p.team_assignment as child_team,
       (select string_agg(pt.team_name, ', ' order by pt.team_name) from public.practice_teams pt
        where lower(btrim(pt.head_coach)) = lower(btrim(cr.first_name||' '||cr.last_name))
           or lower(btrim(pt.assistant_coach)) = lower(btrim(cr.first_name||' '||cr.last_name))) as coaches
from public.coach_children cc
join public.coach_roster cr on cr.id = cc.coach_roster_id
join public.players p on p.id = cc.player_id
order by coach, child;
