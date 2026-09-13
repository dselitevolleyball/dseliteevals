-- Sub assignments left behind by the Fall 2 schedule edits (13 Sep), plus one
-- existing double-booking.
--
--   #225  Oct 18  13 Emerald  Kelli Hardge out, sub Karissa Lee
--         5-6pm is now 13 Emerald's speed & agility hour; practice is 6-7pm.
--         Karissa is free 6-7pm. Moved, sub kept.
--   #3    Nov 15  15 Sapphire  Mikayla Smith-Wright out, sub Breanna Coward
--         8-9pm is now S&A; practice is 7-8pm. Breanna is free 7-8pm (her
--         15 Diamond practice ends at 7). Moved, sub kept.
--   #229  Nov 15  13 Emerald  Kelli Hardge out, sub Rene Sandoval
--         Practice is now 6-7pm, when Rene coaches 14 Ruby. Moved to 6-7pm and
--         the sub cleared, so the slot is OPEN for Drew to fill.
--   #55   Oct 4   14 Topaz 4-5pm  Karissa Lee out, sub Jayden Wright
--         Jayden is 13 Diamond's third coach at 4-5pm that day, at the Flex.
--         Sub cleared, so the slot is OPEN for Drew to fill.
--
-- An open slot is sub_name NULL and combine_with_team NULL — the test the
-- coverage board and api/open-shifts use.

update public.practice_coverage set slot = '6-7pm'
 where id = 225 and practice_date = '2026-10-18' and team_name = '13 Emerald' and slot = '5-6pm';

update public.practice_coverage set slot = '7-8pm'
 where id = 3 and practice_date = '2026-11-15' and team_name = '15 Sapphire' and slot = '8-9pm';

update public.practice_coverage
   set slot = '6-7pm', sub_name = null,
       note = 'Sub needed: Rene Sandoval was booked but coaches 14 Ruby at 6-7pm after the Fall 2 changes.'
 where id = 229 and practice_date = '2026-11-15' and team_name = '13 Emerald' and slot = '5-6pm';

update public.practice_coverage
   set sub_name = null,
       note = 'Sub needed: Jayden Wright was booked but is 13 Diamond''s third coach at 4-5pm (at the Flex).'
 where id = 55 and practice_date = '2026-10-04' and team_name = '14 Topaz' and slot = '4-5pm';

select id, practice_date, team_name, slot, coach_out, coalesce(sub_name, '— OPEN —') sub, combine_with_team
  from public.practice_coverage where id in (225, 3, 229, 55) order by practice_date, team_name;
