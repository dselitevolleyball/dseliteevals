-- Migration: recurring clinic sessions + Playbook source link. A clinic/program
-- (e.g. "Volleyball 101") has many sessions, each needing a coach.
-- Date: 2026-07-19  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260719_dssc_clinic_sessions.sql

ALTER TABLE public.dssc_clinics
  ADD COLUMN IF NOT EXISTS sessions   JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{id,date,start_time,end_time,court,coach_name}]
  ADD COLUMN IF NOT EXISTS category   TEXT,
  ADD COLUMN IF NOT EXISTS source     TEXT,   -- 'playbook' | null (manual)
  ADD COLUMN IF NOT EXISTS source_ref TEXT;   -- Playbook program id (dedupe on re-import)

-- Plain unique index (NULLs are distinct, so manual clinics don't conflict);
-- usable as an ON CONFLICT target for Playbook re-imports.
CREATE UNIQUE INDEX IF NOT EXISTS dssc_clinics_source_ref_uniq ON public.dssc_clinics(source_ref);
