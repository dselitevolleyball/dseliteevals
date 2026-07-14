-- Migration: shift intents — a coach declaring "working" or "not working" for a
-- specific scheduled shift, ahead of time. "not working" also files a call-out
-- (coach_requests) so coverage kicks in; a covered shift no longer shows the
-- option. Date: 2026-07-14
-- Run: node scripts/run-sql.mjs migrations/20260714_shift_intents.sql
-- Additive, idempotent.

CREATE TABLE IF NOT EXISTS public.shift_intents (
  id           BIGSERIAL PRIMARY KEY,
  coach_name   TEXT NOT NULL,
  coach_email  TEXT,
  shift_date   DATE NOT NULL,
  team_name    TEXT,                 -- null = floating
  slot         TEXT,
  intent       TEXT NOT NULL DEFAULT 'working', -- working | out
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (coach_name, shift_date, team_name, slot)
);
CREATE INDEX IF NOT EXISTS shift_intents_date_idx ON public.shift_intents(shift_date);

ALTER TABLE public.shift_intents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_shift_intents" ON public.shift_intents;
CREATE POLICY "auth_all_shift_intents" ON public.shift_intents FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='shift_intents') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.shift_intents;
  END IF;
END $$;
