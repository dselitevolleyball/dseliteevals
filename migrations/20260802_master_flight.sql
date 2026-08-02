-- 20260802 — A master flight per tournament, with per-coach deviations.
--
-- Most of the staff book the same itinerary; a few go in early or stay late.
-- Recording the shared flight once and flagging only the exceptions beats
-- retyping the same airline and times for eight coaches, and makes the
-- exceptions visible instead of buried in identical-looking rows.
--
-- A coach with flight_deviation = false inherits the master. Setting it true
-- makes their own airline/dates/times/cost apply. Their columns are kept
-- either way, so toggling back and forth doesn't lose what was typed.
--
-- Run: node scripts/run-sql.mjs migrations/20260802_master_flight.sql
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.travel_master_flights (
  tournament_id BIGINT      PRIMARY KEY REFERENCES public.tournaments(id) ON DELETE CASCADE,
  airline       TEXT,
  depart_date   DATE,
  depart_time   TEXT,
  return_date   DATE,
  return_time   TEXT,
  cost          NUMERIC,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.coach_travel ADD COLUMN IF NOT EXISTS flight_deviation boolean NOT NULL DEFAULT false;

-- Anyone who already has their own flight details recorded is, by definition,
-- not on a master that didn't exist yet.
UPDATE public.coach_travel
   SET flight_deviation = true
 WHERE flight_deviation = false
   AND (coalesce(btrim(airline), '') <> '' OR depart_date IS NOT NULL OR return_date IS NOT NULL);

ALTER TABLE public.travel_master_flights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS travel_master_admin ON public.travel_master_flights;
CREATE POLICY travel_master_admin ON public.travel_master_flights FOR ALL
  USING (public.is_admin_coach()) WITH CHECK (public.is_admin_coach());
-- A coach may read the master for a tournament they're travelling to.
DROP POLICY IF EXISTS travel_master_read_own ON public.travel_master_flights;
CREATE POLICY travel_master_read_own ON public.travel_master_flights FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.coach_travel t
    WHERE t.tournament_id = travel_master_flights.tournament_id
      AND t.private_owner IS NULL AND public.is_me_coach(t.coach_name)
  ));

COMMENT ON COLUMN public.coach_travel.flight_deviation IS
  'Coach is NOT on the master flight — their own airline/dates/times/cost apply.';
