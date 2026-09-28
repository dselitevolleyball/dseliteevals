-- Lone Star Classic NQ Weekend 3: the Oklahoma City event (#485, 15 Emerald +
-- 15 Sapphire) moved to Dallas, so it is now the same tournament as the Dallas
-- entry (#486, 15 Ruby). Keep #485 (it carries the coach travel and flights),
-- move #486's team, room and expense onto it, then remove #486.
begin;

update public.tournament_assignments set tournament_id = 485 where tournament_id = 486;
-- #485 already has rooms 1 and 2; the Aloft room from #486 becomes room 3.
update public.coach_travel_rooms set tournament_id = 485, room_no = 3 where id = 88 and tournament_id = 486;
update public.expenses set tournament_id = 485 where tournament_id = 486;
update public.coach_travel set tournament_id = 485 where tournament_id = 486;
update public.player_photos set tournament_id = 485 where tournament_id = 486;
update public.tournament_housing_bookings set tournament_id = 485 where tournament_id = 486;
update public.travel_gap_notices set tournament_id = 485 where tournament_id = 486;

update public.tournaments set
  age_low = 13, age_high = 16,
  wish_list = array['15 Sapphire','15 Emerald','15 Ruby'],
  entries = array['16 Club','15 Premier','15 Select','15 Club','15 American','14 Club','13 Club'],
  notes = 'Originally the Oklahoma City Weekend 3; moved to Dallas. Merged with the separate Dallas entry (15 Ruby, #486) on 2026-09-28.',
  updated_at = now()
where id = 485;

delete from public.tournaments where id = 486;

commit;

select t.id, t.name, t.location, t.wish_list, t.entries,
  (select json_agg(team_id order by team_id) from public.tournament_assignments where tournament_id = 485) as teams,
  (select count(*) from public.coach_travel_rooms where tournament_id = 485) as rooms,
  (select count(*) from public.expenses where tournament_id = 485) as expenses,
  (select count(*) from public.tournaments where id = 486) as dup_left
from public.tournaments t where t.id = 485;
