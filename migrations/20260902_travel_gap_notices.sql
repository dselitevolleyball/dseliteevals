-- 20260902 — remember which unbooked trips Kristen has already been told about.
--
-- The gap check has been a script somebody had to remember to run. It was run
-- by hand for Kelli Hardge's move to 15 Ruby and, precisely because it depends
-- on remembering, not run for Dillyn Austin — whose three unbooked trips
-- nobody was told about.
--
-- Making it a cron needs a memory. Without one it would either re-send all 74
-- outstanding trips every morning, which gets filtered to junk within a week,
-- or send nothing after the first run and miss everything new. One row per
-- (coach, tournament) reported: a trip already notified stays quiet, a trip
-- that appears because staffing changed is new and gets sent.
--
-- Deleting a row here re-arms that trip, which is the intended way to chase
-- something a second time.
--
-- Run: node scripts/run-sql.mjs migrations/20260902_travel_gap_notices.sql
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.travel_gap_notices (
  id            bigserial   PRIMARY KEY,
  coach_name    text        NOT NULL,
  tournament_id bigint      NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  team_name     text,
  notified_at   timestamptz NOT NULL DEFAULT now()
);

-- One notice per coach per tournament. The name is stored lower-cased in the
-- index so "Kelli Hardge" and "kelli hardge" cannot both be reported.
CREATE UNIQUE INDEX IF NOT EXISTS travel_gap_notices_uniq
  ON public.travel_gap_notices (lower(trim(coach_name)), tournament_id);

ALTER TABLE public.travel_gap_notices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS travel_gap_notices_read_approved ON public.travel_gap_notices;
CREATE POLICY travel_gap_notices_read_approved ON public.travel_gap_notices
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));
