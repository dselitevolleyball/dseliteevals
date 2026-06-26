-- 20260626 — Coach efficiency pass (Regular Season).
--
-- Removes idle gaps and weekday splits for as many coaches as the (fully
-- saturated) board allows, WITHOUT creating any new gap/split/clash. Every
-- move is a swap or fills the only slack on the board (2 open Sun 12-2 spots).
-- Verified against the live grid; replaces 20260626_coach_efficiency_jaalin.sql.
--
-- FIXES:
--   Jaalin Rosser  — Sun gap (4h) + Mon/Wed split  -> Sun 4-8, Wed 5-9
--   Ella Hinkle    — Sun gap (2h) + Wed/Thu split  -> Sun 2-6, Thu 5-9
--   Mikayla S-W    — Wed/Thu split                 -> Thu 5-9
--
-- MOVES (each WHERE is team-scoped so swaps never collide; order-independent):
--   Sunday  12 Ruby   12-2 <-> 14 Ruby   4-6   (14 Ruby's coaches keep 12-4 contiguous)
--   Sunday  11 Diamond 12-2 <-> 13 Sapphire 2-4 (13 Sapphire's coaches are single-team)
--   Weeknt  12 Ruby    Mon 5-7 -> Wed 5-7   (pairs with 15 Emerald Wed 7-9)
--   Weeknt  11 Diamond Wed 5-7 -> Thu 5-7   (pairs with 14 Emerald Thu 7-9)
--   Weeknt  15 Sapphire Wed 7-9 -> Thu 5-7  (pairs with 14 Emerald Thu 7-9)
--   Weeknt  13 Sapphire Thu 5-7 -> Mon 5-7  (displaced; single-team coaches)
--   Weeknt  17 Diamond  Thu 5-7 -> Wed 7-9  (displaced; Kelli stays 2 days, no worse)
--
-- All U11/U12 teams stay in the 5-7pm weeknight slot. Capacities all respected.
-- NOT fixed here (no clean swap exists on a full board):
--   Sam Robinson (2h Sun gap) and Tara Fisher (2h Sun gap) -> mark FLOATING.
--   Shellie Williams (Tue/Wed split) -> needs a 2nd Tuesday 7-9 court.
--   Rob Roberts (Wed/Thu split) -> structural: two U11/U12 teams both need the
--     5-7 slot, so they can't share a coach's day; unavoidable.
--
-- Non-destructive: relocates existing rows only. Run once in Supabase.

BEGIN;

-- ── Sunday swap 1: 12 Ruby <-> 14 Ruby ──────────────────────────────────────
UPDATE public.practice_assignments SET slot='4-5pm'  WHERE phase='season' AND team_name='12 Ruby' AND day='Sun' AND slot='12-1pm';
UPDATE public.practice_assignments SET slot='5-6pm'  WHERE phase='season' AND team_name='12 Ruby' AND day='Sun' AND slot='1-2pm';
UPDATE public.practice_assignments SET slot='12-1pm' WHERE phase='season' AND team_name='14 Ruby' AND day='Sun' AND slot='4-5pm';
UPDATE public.practice_assignments SET slot='1-2pm'  WHERE phase='season' AND team_name='14 Ruby' AND day='Sun' AND slot='5-6pm';

-- ── Sunday swap 2: 11 Diamond <-> 13 Sapphire ───────────────────────────────
UPDATE public.practice_assignments SET slot='2-3pm'  WHERE phase='season' AND team_name='11 Diamond'  AND day='Sun' AND slot='12-1pm';
UPDATE public.practice_assignments SET slot='3-4pm'  WHERE phase='season' AND team_name='11 Diamond'  AND day='Sun' AND slot='1-2pm';
UPDATE public.practice_assignments SET slot='12-1pm' WHERE phase='season' AND team_name='13 Sapphire' AND day='Sun' AND slot='2-3pm';
UPDATE public.practice_assignments SET slot='1-2pm'  WHERE phase='season' AND team_name='13 Sapphire' AND day='Sun' AND slot='3-4pm';

-- ── Weeknight moves (5-7pm slot label is the same; day changes) ──────────────
UPDATE public.practice_assignments SET day='Wed' WHERE phase='season' AND team_name='12 Ruby'     AND day='Mon' AND slot='5-7pm';
UPDATE public.practice_assignments SET day='Thu' WHERE phase='season' AND team_name='11 Diamond'  AND day='Wed' AND slot='5-7pm';
UPDATE public.practice_assignments SET day='Mon' WHERE phase='season' AND team_name='13 Sapphire' AND day='Thu' AND slot='5-7pm';

-- ── Weeknight moves with day + slot change ──────────────────────────────────
UPDATE public.practice_assignments SET day='Thu', slot='5-7pm' WHERE phase='season' AND team_name='15 Sapphire' AND day='Wed' AND slot='7-9pm';
UPDATE public.practice_assignments SET day='Wed', slot='7-9pm' WHERE phase='season' AND team_name='17 Diamond'  AND day='Thu' AND slot='5-7pm';

COMMIT;
