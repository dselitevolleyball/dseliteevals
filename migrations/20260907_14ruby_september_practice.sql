-- 14 Ruby moves to Sunday 7-9pm for September only. They are the one team
-- without a court until the new facility opens in early October; the later
-- slot is the gap they fit into until then.
--
-- Their fall1 rows were Sun 5-6pm and Sun 6-7pm. Sunday fall1 is recorded in
-- one-hour rows everywhere else (7-8pm and 8-9pm are separate slots), so this
-- follows that shape rather than introducing a single "7-9pm" Sunday row.
--
-- Dated to September explicitly so the arrangement expires on its own. Their
-- fall2 rows are untouched and still read Sun 5-6pm / 6-7pm, which is where
-- they land once the new facility is open.

update public.practice_assignments set
  slot        = '7-8pm',
  venue_start = date '2026-09-01',
  venue_end   = date '2026-09-30',
  notes       = 'September only — no court available until the new facility opens in early October.'
where id = 1007;

update public.practice_assignments set
  slot        = '8-9pm',
  venue_start = date '2026-09-01',
  venue_end   = date '2026-09-30',
  notes       = 'September only — no court available until the new facility opens in early October.'
where id = 1047;

select id, team_name, phase, day, slot, venue_start, venue_end, notes
from public.practice_assignments where team_name = '14 Ruby' and phase in ('fall1','fall2')
order by phase, slot;
