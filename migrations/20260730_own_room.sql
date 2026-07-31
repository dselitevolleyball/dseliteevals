-- 20260730 — "Requires own room" per coach.
--
-- A coach who wants a room to themselves is charged 50% of that room's cost,
-- deducted from their paycheck; the club covers the rest. That makes the two
-- manual cost columns (hotel_cost / hotel_club_pays) redundant — the split is
-- now derived from this flag and the room's total_cost, so it can't drift out
-- of sync with what was actually booked.
--
-- The old columns are left in place rather than dropped: they hold no data yet,
-- and dropping columns is the one migration that can't be undone by re-running.
--
-- Run: node scripts/run-sql.mjs migrations/20260730_own_room.sql
-- Additive and idempotent.

ALTER TABLE public.coach_travel ADD COLUMN IF NOT EXISTS own_room boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.coach_travel.own_room IS
  'Coach requires a private room; charged 50% of the room total via payroll. Club covers the remainder.';
