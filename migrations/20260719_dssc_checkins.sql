-- Migration: DSSC clinic clock-ins. SEPARATE from coach_checkins (DS Elite) —
-- DSSC and DS Elite are different companies with separate payroll.
-- Date: 2026-07-19  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260719_dssc_checkins.sql

CREATE TABLE IF NOT EXISTS public.dssc_checkins (
  id            BIGSERIAL PRIMARY KEY,
  coach_name    TEXT NOT NULL,
  coach_email   TEXT,
  clinic_id     BIGINT,
  session_id    TEXT,                -- session id within the clinic
  session_date  DATE,
  clinic_name   TEXT,
  hours         NUMERIC NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'present',
  source        TEXT,                -- app | app-late | admin
  paid          BOOLEAN NOT NULL DEFAULT false,
  paid_at       TIMESTAMPTZ,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (coach_name, session_id)
);
CREATE INDEX IF NOT EXISTS dssc_checkins_date_idx ON public.dssc_checkins(session_date);

ALTER TABLE public.dssc_checkins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_dssc_checkins" ON public.dssc_checkins;
CREATE POLICY "auth_all_dssc_checkins" ON public.dssc_checkins FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='dssc_checkins') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dssc_checkins;
  END IF;
END $$;
