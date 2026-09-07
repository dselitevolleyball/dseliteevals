-- Sam Mabry -> Olivia Mabry (13 Ruby). Missed by the auto-seed because the coach
-- roster has her as "Sam" while Olivia's record says "Samantha Mabry".
-- Confirmed by Drew 2026-09-07, along with David Stanley -> Elizabeth (already seeded).
insert into public.coach_children (coach_roster_id, player_id, notes)
values (16, 90, 'Added by hand 2026-09-07 — roster says "Sam", player record says "Samantha".')
on conflict (coach_roster_id, player_id) do nothing;

select btrim(cr.first_name||' '||cr.last_name) as coach,
       btrim(p.first_name||' '||p.last_name) as child, p.team_assignment as child_team
from public.coach_children cc
join public.coach_roster cr on cr.id = cc.coach_roster_id
join public.players p on p.id = cc.player_id
order by coach, child;
