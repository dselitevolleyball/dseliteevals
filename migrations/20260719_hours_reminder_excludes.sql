-- Migration: coaches to exclude from the "didn't clock in" reminder (e.g.
-- stipend-only staff, someone on leave). Date: 2026-07-19
-- Run: node scripts/run-sql.mjs migrations/20260719_hours_reminder_excludes.sql
-- Additive, idempotent.

CREATE TABLE IF NOT EXISTS public.hours_reminder_excludes (
  coach_name  TEXT PRIMARY KEY,
  note        TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.hours_reminder_excludes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_hours_reminder_excludes" ON public.hours_reminder_excludes;
CREATE POLICY "auth_all_hours_reminder_excludes" ON public.hours_reminder_excludes FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='hours_reminder_excludes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.hours_reminder_excludes;
  END IF;
END $$;
