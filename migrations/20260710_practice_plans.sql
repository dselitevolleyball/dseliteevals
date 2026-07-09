-- Migration: practice_plans — per-practice plans tied to scheduled dates.
-- Date: 2026-07-10
--
-- One row per (team, date, slot) practice. The schedule already knows when a
-- team practices (practice_assignments × phase, minus practice_cancellations);
-- this stores the coach's plan for that specific practice: ordered time blocks
-- (JSONB), the Season Plan concepts it focuses on (focus_keys → DSE_CURRICULUM
-- item keys), notes, and a draft/done status.
--
-- Run: node scripts/run-sql.mjs migrations/20260710_practice_plans.sql
-- Additive, non-destructive, idempotent.

CREATE TABLE IF NOT EXISTS public.practice_plans (
  id            BIGSERIAL PRIMARY KEY,
  team_name     TEXT NOT NULL,
  practice_date DATE NOT NULL,
  slot          TEXT NOT NULL DEFAULT '',
  blocks        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{id,name,minutes,desc}]
  focus_keys    JSONB NOT NULL DEFAULT '[]'::jsonb,  -- curriculum item keys
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',       -- draft | done
  updated_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_name, practice_date, slot)
);

CREATE INDEX IF NOT EXISTS practice_plans_team_idx ON public.practice_plans(team_name, practice_date DESC);

ALTER TABLE public.practice_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_practice_plans" ON public.practice_plans;
DROP POLICY IF EXISTS "auth_modify_practice_plans" ON public.practice_plans;
CREATE POLICY "auth_select_practice_plans" ON public.practice_plans
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_modify_practice_plans" ON public.practice_plans
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
