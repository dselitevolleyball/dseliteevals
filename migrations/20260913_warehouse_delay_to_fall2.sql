-- The new Warehouse build is delayed: nothing moves to the Warehouse until
-- Fall 2 (first Sunday 2026-10-18). Two arrangements were dated to end
-- 2026-09-30 on the assumption the facility opened in early October:
--
--   13 Diamond, 15 Emerald  Fall 1 at the Flex, Aug 1 - Sep 30. With the
--                           window ending 9/30, the calendar feed sent their
--                           Oct 4 and Oct 11 practices to the Warehouse.
--                           Extended through Oct 11, the last Fall 1 Sunday.
--   14 Ruby                 Sunday 7-9pm "September only - no court until the
--                           new facility opens in early October". The feed
--                           gates only venue by date, so these rows already
--                           ran through Oct 11; dates and note corrected so
--                           the record says what is actually happening.
--
-- Fall 2 rows are untouched: they carry no override and default to the
-- Warehouse, which is now correct. Summer rows are past and left as they are.

update public.practice_assignments
   set venue_end = date '2026-10-11'
 where id in (995, 1127, 1042, 1094)
   and phase = 'fall1' and venue = 'flex';

update public.practice_assignments
   set venue_end = date '2026-10-11',
       notes     = 'Through Fall 1 (Oct 11) — no court available until the new Warehouse build opens in Fall 2.'
 where id in (1007, 1047)
   and team_name = '14 Ruby' and phase = 'fall1';

select id, team_name, phase, slot, venue, venue_start, venue_end, left(notes, 60) notes
  from public.practice_assignments
 where id in (995, 1127, 1042, 1094, 1007, 1047)
 order by team_name, slot;
