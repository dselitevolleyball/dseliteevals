-- Migration: coach_checkins — coach clock-in / attendance.
-- Date: 2026-07-09
--
-- One row per coach per practice slot they confirm they showed up for. Hours are
-- derived from the slot length (5-7pm = 2h) at check-in time. role distinguishes
-- a scheduled coach from a sub or a floater. This is the attendance foundation;
-- payroll (rate x hours) and the weekly report build on top of it.
--
-- Mirrors the sportsyou_posts pattern: auth-only RLS, realtime so a check-in
-- shows up on the admin's daily board live.
--
-- Run: node scripts/run-sql.mjs migrations/20260709_coach_checkins.sql
-- Additive, non-destructive, idempotent.

CREATE TABLE IF NOT EXISTS public.coach_checkins (
  id           BIGSERIAL PRIMARY KEY,
  coach_name   TEXT NOT NULL,                        -- canonical coach name
  coach_email  TEXT,
  check_date   DATE NOT NULL,
  team_name    TEXT,                                 -- team covered (NULL = floating)
  slot         TEXT,                                 -- e.g. "5-7pm"
  phase        TEXT NOT NULL DEFAULT 'season',
  hours        NUMERIC(5,2) NOT NULL DEFAULT 0,      -- derived from slot length
  role         TEXT NOT NULL DEFAULT 'scheduled',    -- scheduled | sub | float
  status       TEXT NOT NULL DEFAULT 'present',      -- present (room for late/absent later)
  source       TEXT NOT NULL DEFAULT 'app',          -- app | email | admin
  note         TEXT,
  created_by   TEXT,                                 -- who logged it (self, or admin name)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One check-in per coach / date / slot / team (a coach with 2 teams same slot
-- can still log each). COALESCE so NULL slot/team don't defeat the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS coach_checkins_uniq
  ON public.coach_checkins (coach_name, check_date, COALESCE(slot,''), COALESCE(team_name,''));
CREATE INDEX IF NOT EXISTS coach_checkins_date_idx ON public.coach_checkins (check_date DESC);
CREATE INDEX IF NOT EXISTS coach_checkins_coach_idx ON public.coach_checkins (coach_name);

ALTER TABLE public.coach_checkins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_coach_checkins" ON public.coach_checkins;
DROP POLICY IF EXISTS "auth_modify_coach_checkins" ON public.coach_checkins;
CREATE POLICY "auth_select_coach_checkins" ON public.coach_checkins
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_modify_coach_checkins" ON public.coach_checkins
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='coach_checkins') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.coach_checkins;
  END IF;
END $$;
