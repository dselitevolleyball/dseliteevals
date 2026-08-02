-- 20260802 — Explicit "flight purchased" flag.
--
-- Booking state was inferred from ticket_number being non-empty, which
-- conflates two things: a flight can be bought before the confirmation code is
-- to hand, and a code can be typed into a row that was never paid for. The
-- flag says plainly whether money has left.
--
-- Backfilled true wherever a ticket number already exists, so nothing that was
-- counted as booked silently becomes unbooked.
--
-- Run: node scripts/run-sql.mjs migrations/20260802_flight_purchased.sql
-- Additive and idempotent.

ALTER TABLE public.coach_travel ADD COLUMN IF NOT EXISTS flight_purchased boolean NOT NULL DEFAULT false;

UPDATE public.coach_travel
   SET flight_purchased = true
 WHERE flight_purchased = false
   AND coalesce(btrim(ticket_number), '') <> '';

COMMENT ON COLUMN public.coach_travel.flight_purchased IS 'Flight has been bought. Independent of ticket_number, which may arrive later.';
