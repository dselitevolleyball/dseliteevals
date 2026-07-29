-- 20260729 — One-off, per-team calendar events (jersey tryouts, photo day,
-- parent meetings) that flow to SportsYou through /api/calendar.
--
-- Why a table rather than another hardcoded map like ORIENTATION in
-- api/calendar.js: these recur every season with different dates and times,
-- and editing them shouldn't need a deploy. The ICS feed reads live, so a row
-- added here shows up on the team's SportsYou calendar on its next refresh.
--
-- Deliberately ADDITIVE: nothing here suppresses a practice and no practice
-- suppresses these. A team can have a Sunday practice AND a jersey tryout the
-- same afternoon — 2026-08-30 is exactly that case (it's in SUMMER_SUNDAYS).
--
-- start_time is 'HH:MM' 24-hour text, matching how slots are stored elsewhere.
-- duration_min keeps the minute-level precision the practice slot format
-- ("6-8") can't express.
--
-- Run: node scripts/run-sql.mjs migrations/20260729_team_events.sql
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.team_events (
  id           BIGSERIAL   PRIMARY KEY,
  team_name    TEXT        NOT NULL REFERENCES public.practice_teams(team_name) ON DELETE CASCADE,
  title        TEXT        NOT NULL,
  event_date   DATE        NOT NULL,
  start_time   TEXT        NOT NULL,
  duration_min INTEGER     NOT NULL DEFAULT 30,
  location     TEXT,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_name, event_date, start_time, title)
);

CREATE INDEX IF NOT EXISTS team_events_team_date_idx ON public.team_events (team_name, event_date);

ALTER TABLE public.team_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_events_all_approved ON public.team_events;
CREATE POLICY team_events_all_approved ON public.team_events FOR ALL
  USING (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='team_events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.team_events;
  END IF;
END $$;

-- ── Jersey tryouts, Sunday 2026-08-30, 30 minutes per team ──────────────────
INSERT INTO public.team_events (team_name, title, event_date, start_time, duration_min, location, description)
SELECT t.team_name, 'Jersey Tryout', DATE '2026-08-30', t.start_time, 30,
       'Dripping Springs Sports Club — Warehouse, 15113 Fitzhugh Rd, Suite 1400, Dripping Springs, TX',
       'Jersey sizing and fitting. Plan for about 30 minutes.'
FROM (VALUES
  ('12 Ruby','14:30'), ('13 Sapphire','14:30'), ('14 Sapphire','14:30'),
  ('11 Diamond','15:00'), ('12 Diamond','15:00'), ('13 Ruby','15:00'),
  ('14 Topaz','16:15'), ('15 Emerald','16:15'),
  ('13 Emerald','16:45'), ('14 Emerald','16:45'),
  ('14 Diamond','17:00'), ('15 Diamond','17:00'),
  ('13 Diamond','17:30'),
  ('14 Ruby','18:30'), ('15 Sapphire','18:30'), ('16 Diamond','18:30'), ('15 Ruby','18:30')
) AS t(team_name, start_time)
ON CONFLICT (team_name, event_date, start_time, title) DO NOTHING;
