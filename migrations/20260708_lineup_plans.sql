-- Migration: lineup_plans — coach rotation/lineup planner (6-2 & 6-6).
-- Date: 2026-07-08
--
-- One row per saved match plan for a team. A plan holds the roster and 1-3
-- "sets", each with a starting lineup (6 court positions), the two setters
-- (6-2), libero, serve-receive passers, and planned subs. The frontend
-- auto-generates the 6 rotations, serve/receive alignment, playing-time %,
-- and the lineup card from this data — so the whole plan lives in `data`
-- (JSONB) and the app owns the shape.
--
-- Mirrors the sportsyou_posts pattern: auth-only SELECT/modify via RLS.
-- Realtime so a plan edited on a laptop shows up courtside on a phone.
--
-- Run: node scripts/run-sql.mjs migrations/20260708_lineup_plans.sql
-- Additive, non-destructive, idempotent.

CREATE TABLE IF NOT EXISTS public.lineup_plans (
  id            BIGSERIAL PRIMARY KEY,
  team_name     TEXT NOT NULL,             -- practice_teams.team_name this plan belongs to
  title         TEXT NOT NULL DEFAULT 'Untitled plan',
  opponent      TEXT,
  match_date    DATE,
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { roster:[...], sets:[...] }
  updated_by    TEXT,                      -- coach display_name/email of last editor
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lineup_plans_team_idx    ON public.lineup_plans(team_name);
CREATE INDEX IF NOT EXISTS lineup_plans_updated_idx ON public.lineup_plans(updated_at DESC);

-- RLS — any authenticated coach may read/curate plans.
ALTER TABLE public.lineup_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_lineup_plans" ON public.lineup_plans;
DROP POLICY IF EXISTS "auth_modify_lineup_plans" ON public.lineup_plans;

CREATE POLICY "auth_select_lineup_plans" ON public.lineup_plans
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_modify_lineup_plans" ON public.lineup_plans
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Realtime — push plan changes so a laptop edit appears courtside live.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='lineup_plans') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lineup_plans;
  END IF;
END $$;
