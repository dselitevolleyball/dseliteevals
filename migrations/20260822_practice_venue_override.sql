-- 20260822 — Per-assignment venue override, with dates.
--
-- Practice location is derived, not stored: api/calendar.js sends Flex only for
-- phase = 'summer' AND court = 5, and the Warehouse for everything else. That
-- encodes one arrangement (summer = 4 Warehouse courts + 1 Flex) and cannot
-- express "this team is at Flex for these weeks".
--
-- Court number is the wrong lever for it. Summer runs 5 courts and fall runs 6,
-- so court 5 in a fall phase is an ordinary Warehouse court — reusing it as a
-- Flex flag would collide with real court numbering and with slot capacity.
--
-- Dates matter because phases do not line up with calendar months. Summer runs
-- 2026-07-12 through 2026-09-06 and fall1 runs through 2026-10-11, so a
-- phase-level flag would drag July and October along with August/September.
--
-- venue      : 'flex' | 'warehouse', NULL = keep the derived default.
-- venue_start: first date the override applies, NULL = no lower bound.
-- venue_end  : last date it applies, NULL = no upper bound.
--
-- Applies to the dated phases (summer / fall1 / fall2), which the feed emits one
-- event per date. The weekly RRULE phases carry a single LOCATION for the whole
-- recurrence and cannot vary it by date.
--
-- Run: node scripts/run-sql.mjs migrations/20260822_practice_venue_override.sql
-- Additive and idempotent.

ALTER TABLE public.practice_assignments
  ADD COLUMN IF NOT EXISTS venue       text,
  ADD COLUMN IF NOT EXISTS venue_start date,
  ADD COLUMN IF NOT EXISTS venue_end   date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practice_assignments_venue_chk') THEN
    ALTER TABLE public.practice_assignments
      ADD CONSTRAINT practice_assignments_venue_chk
      CHECK (venue IS NULL OR venue IN ('flex','warehouse'));
  END IF;
END $$;

COMMENT ON COLUMN public.practice_assignments.venue IS
  'Overrides the derived practice location for this assignment. NULL keeps the court-5-in-summer default.';
