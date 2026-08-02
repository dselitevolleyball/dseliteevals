-- 20260802 — Hotel rooms are priced PER NIGHT, not per stay.
--
-- The column was named total_cost and summed as though each room's figure were
-- the whole stay. Every value actually entered is a nightly rate ($150-$300),
-- so the club hotel numbers were short by a factor of the night count —
-- $9,975 shown against a true $22,600.
--
-- Renaming rather than adding a column: there is no separate "total" worth
-- keeping, and leaving a misleading name in place invites the same bug back.
-- Room total is now derived as nightly_rate x (check_out - check_in).
--
-- Run: node scripts/run-sql.mjs migrations/20260802_room_nightly_rate.sql
-- Idempotent: the rename is guarded on the old column still existing.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='coach_travel_rooms' AND column_name='total_cost')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='coach_travel_rooms' AND column_name='nightly_rate') THEN
    ALTER TABLE public.coach_travel_rooms RENAME COLUMN total_cost TO nightly_rate;
  END IF;
END $$;

COMMENT ON COLUMN public.coach_travel_rooms.nightly_rate IS
  'Rate PER NIGHT for this room. Stay total = nightly_rate * (check_out - check_in).';
