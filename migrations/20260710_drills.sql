-- Migration: drills — the shared drill library (moved in-app from the
-- standalone practice planner's localStorage).
-- Date: 2026-07-10
--
-- Seeded from the built-in library + Drew's 14 Diamond season drill bank.
-- The Practice hub's Drills tab browses these and drops them into a plan.
--
-- Run: node scripts/run-sql.mjs migrations/20260710_drills.sql
-- Additive, non-destructive, idempotent.

CREATE TABLE IF NOT EXISTS public.drills (
  id           BIGSERIAL PRIMARY KEY,
  slug         TEXT UNIQUE,                 -- stable import key (e.g. "dse12")
  name         TEXT NOT NULL,
  skill        TEXT,                        -- Serving, Passing, Setting, …
  phase        TEXT,                        -- warmup | skill | competitive | cooldown
  minutes      INTEGER,
  min_players  INTEGER,
  max_players  INTEGER,
  level        TEXT,
  description  TEXT,
  notes        TEXT,
  source       TEXT,                        -- where it came from
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS drills_skill_idx ON public.drills(skill);
CREATE INDEX IF NOT EXISTS drills_phase_idx ON public.drills(phase);

ALTER TABLE public.drills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_drills" ON public.drills;
DROP POLICY IF EXISTS "auth_modify_drills" ON public.drills;
CREATE POLICY "auth_select_drills" ON public.drills
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_modify_drills" ON public.drills
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
