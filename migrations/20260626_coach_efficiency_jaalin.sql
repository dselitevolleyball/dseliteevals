-- 20260626 — Coach efficiency: eliminate Jaalin Rosser's Sunday gap and
-- weekday split, with no new gap/split for any other coach.
--
-- The Regular Season grid is saturated (every slot full but 2 spots in Sun
-- 12-2pm), so each fix is a SWAP of two teams, chosen so the displaced team's
-- coaches don't pick up a gap.
--
-- Swap 1 (Sunday): 12 Ruby <-> 14 Diamond  (both other coaches are single-team)
--   12 Ruby   Sun 12-2  ->  Sun 4-6   (sits right before 15 Emerald's 6-8)
--   14 Diamond Sun 4-6  ->  Sun 12-2
-- Swap 2 (weekday): 12 Ruby <-> 11 Diamond (keeps 15 Emerald on Wed so Sam
--   Robinson's Wed 5-9 stays intact; only touches already-split Ella Hinkle)
--   12 Ruby    Mon 5-7  ->  Wed 5-7   (U12 stays in the 5-7 young slot)
--   11 Diamond Wed 5-7  ->  Mon 5-7   (U11 stays in the 5-7 young slot)
--
-- Net: Jaalin -> Sun 4-8 and Wed 5-9, two contiguous days, no gaps.
-- Non-destructive: relocates existing rows only. Run once in Supabase.

BEGIN;

-- Swap 1 — Sunday blocks (team_name in WHERE prevents the two teams colliding).
UPDATE public.practice_assignments SET slot='4-5pm' WHERE phase='season' AND team_name='12 Ruby'    AND day='Sun' AND slot='12-1pm';
UPDATE public.practice_assignments SET slot='5-6pm' WHERE phase='season' AND team_name='12 Ruby'    AND day='Sun' AND slot='1-2pm';
UPDATE public.practice_assignments SET slot='12-1pm' WHERE phase='season' AND team_name='14 Diamond' AND day='Sun' AND slot='4-5pm';
UPDATE public.practice_assignments SET slot='1-2pm'  WHERE phase='season' AND team_name='14 Diamond' AND day='Sun' AND slot='5-6pm';

-- Swap 2 — weeknight (5-7pm slot label is identical on both days; only day moves).
UPDATE public.practice_assignments SET day='Wed' WHERE phase='season' AND team_name='12 Ruby'    AND day='Mon' AND slot='5-7pm';
UPDATE public.practice_assignments SET day='Mon' WHERE phase='season' AND team_name='11 Diamond' AND day='Wed' AND slot='5-7pm';

COMMIT;
