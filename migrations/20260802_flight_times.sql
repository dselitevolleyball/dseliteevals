-- 20260802 — Departure times for flights.
--
-- Travel started with dates only, which is enough to know WHICH day a coach
-- flies but not whether they land before their first match or leave at 5am.
-- Times are TEXT 'HH:MM' (24h), matching team_events.start_time rather than a
-- time type, so a partially-known itinerary can still be recorded.
--
-- Both legs get one: the return flight has a departure time too.
--
-- Run: node scripts/run-sql.mjs migrations/20260802_flight_times.sql
-- Additive and idempotent.

ALTER TABLE public.coach_travel ADD COLUMN IF NOT EXISTS depart_time text;
ALTER TABLE public.coach_travel ADD COLUMN IF NOT EXISTS return_time text;

COMMENT ON COLUMN public.coach_travel.depart_time IS 'Outbound departure, HH:MM 24h.';
COMMENT ON COLUMN public.coach_travel.return_time IS 'Return departure, HH:MM 24h.';
