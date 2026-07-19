-- Migration: per-team Game Plan / charter — a coach-owned summary of what they
-- care about for a team (standards, what to do better, role reminders, goals,
-- mindset), referenced while practice planning. Date: 2026-07-18
-- Run: node scripts/run-sql.mjs migrations/20260718_team_charters.sql
-- Additive, idempotent.

CREATE TABLE IF NOT EXISTS public.team_charters (
  team_name   TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { sections: [{ id, title, items: [{id,text}] }] }
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.team_charters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_team_charters" ON public.team_charters;
CREATE POLICY "auth_all_team_charters" ON public.team_charters FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='team_charters') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.team_charters;
  END IF;
END $$;
