-- Migration: curriculum_progress — per-team season-plan checkboxes.
-- Date: 2026-07-10
--
-- The DS Elite coaching curriculum (subjects -> three tiers -> concepts) is
-- defined in code (DSE_CURRICULUM in App.jsx) so it can evolve with Drew's
-- philosophy. This table only stores each team's progress per concept:
--   todo    -> not yet taught
--   planned -> queued for an upcoming practice (the practice-planning pivot)
--   done    -> installed / taught
--
-- Run: node scripts/run-sql.mjs migrations/20260710_curriculum_progress.sql
-- Additive, non-destructive, idempotent.

CREATE TABLE IF NOT EXISTS public.curriculum_progress (
  id          BIGSERIAL PRIMARY KEY,
  team_name   TEXT NOT NULL,
  item_key    TEXT NOT NULL,               -- DSE_CURRICULUM item key, e.g. "serve-daily"
  status      TEXT NOT NULL DEFAULT 'todo',-- todo | planned | done
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_name, item_key)
);

CREATE INDEX IF NOT EXISTS curriculum_progress_team_idx ON public.curriculum_progress(team_name);

ALTER TABLE public.curriculum_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_curriculum_progress" ON public.curriculum_progress;
DROP POLICY IF EXISTS "auth_modify_curriculum_progress" ON public.curriculum_progress;
CREATE POLICY "auth_select_curriculum_progress" ON public.curriculum_progress
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_modify_curriculum_progress" ON public.curriculum_progress
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
