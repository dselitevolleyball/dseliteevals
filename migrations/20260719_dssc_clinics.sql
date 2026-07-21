-- Migration: DSSC clinics & camps — lives inside DS Elite (shared login/coaches)
-- but is its own area. Hunter (director of volleyball) schedules clinics,
-- assigns a coach, and sets the plan/goals/level/expectations; the assigned
-- coach runs it and leaves feedback; directors review. Date: 2026-07-19
-- Run: node scripts/run-sql.mjs migrations/20260719_dssc_clinics.sql
-- Additive, idempotent.

CREATE TABLE IF NOT EXISTS public.dssc_clinics (
  id                 BIGSERIAL PRIMARY KEY,
  name               TEXT NOT NULL DEFAULT 'New clinic',
  kind               TEXT NOT NULL DEFAULT 'clinic',   -- clinic | camp
  clinic_date        DATE,
  end_date           DATE,                             -- multi-day camps
  start_time         TEXT,
  end_time           TEXT,
  location           TEXT,
  age_group          TEXT,
  level              TEXT,                             -- beginner | intermediate | advanced / free text
  coach_name         TEXT,                             -- assigned lead coach
  assistants         TEXT,                             -- extra coaches (free text)
  status             TEXT NOT NULL DEFAULT 'planned',  -- planned | assigned | done
  goals              TEXT,
  focus              TEXT,
  expectations       TEXT,
  plan               JSONB NOT NULL DEFAULT '{}'::jsonb, -- { blocks:[{id,name,minutes,desc}], notes }
  coach_feedback     TEXT,
  coach_feedback_by  TEXT,
  coach_feedback_at  TIMESTAMPTZ,
  director_notes     TEXT,
  created_by         TEXT,
  updated_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dssc_clinics_date_idx ON public.dssc_clinics(clinic_date);

ALTER TABLE public.dssc_clinics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_dssc_clinics" ON public.dssc_clinics;
CREATE POLICY "auth_all_dssc_clinics" ON public.dssc_clinics FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='dssc_clinics') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dssc_clinics;
  END IF;
END $$;
