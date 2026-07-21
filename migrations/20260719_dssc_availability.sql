-- Migration: DSSC coach availability / interest — coaches flag they're
-- available to help with clinics (and when); directors see who's interested
-- when staffing. Date: 2026-07-19  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260719_dssc_availability.sql

CREATE TABLE IF NOT EXISTS public.dssc_availability (
  coach_name   TEXT PRIMARY KEY,
  coach_email  TEXT,
  available    BOOLEAN NOT NULL DEFAULT true,
  note         TEXT,                 -- days/times/what they can help with
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.dssc_availability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_dssc_availability" ON public.dssc_availability;
CREATE POLICY "auth_all_dssc_availability" ON public.dssc_availability FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='dssc_availability') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dssc_availability;
  END IF;
END $$;
