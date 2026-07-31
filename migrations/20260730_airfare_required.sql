-- 20260730 — Does this tournament need flights, or is it a drive?
--
-- A stay-over event isn't automatically a flight: San Antonio, Houston and
-- Dallas are hotel-only drives from Dripping Springs, while Oklahoma City,
-- Las Vegas, Anaheim and New Orleans are flights. The travel planner hides the
-- airfare columns entirely when this is false, so a drive event shows only
-- hotel.
--
-- Backfilled from the location: anything not in Texas starts as needing air.
-- It's a starting point, not a rule — Drew can tick either way per event.
--
-- Run: node scripts/run-sql.mjs migrations/20260730_airfare_required.sql
-- Additive and idempotent.

ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS airfare_required boolean;

-- NB: Postgres ARE has no \b word boundary (that's a backspace) — use an
-- explicit end-or-whitespace instead, or every row matches nothing and the
-- whole backfill silently comes out true.
UPDATE public.tournaments
   SET airfare_required = (coalesce(location, '') !~* ',\s*TX(\s|$)')
 WHERE airfare_required IS NULL
   AND stay_over
   AND NOT cancelled;

COMMENT ON COLUMN public.tournaments.airfare_required IS
  'Stay-over event needs flights (true) or is a drive, hotel only (false). NULL = not yet decided.';
