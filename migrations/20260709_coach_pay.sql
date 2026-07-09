-- Migration: coach pay — hourly rate + paid status on check-ins.
-- Date: 2026-07-09
--
-- coach_rates holds one editable $/hr per coach, keyed by the coach_name that
-- coach_checkins records (their display name). The Time Cards ledger multiplies
-- confirmed hours by this rate; marking a check-in paid flips paid/paid_at.
--
-- Run: node scripts/run-sql.mjs migrations/20260709_coach_pay.sql
-- Additive, non-destructive, idempotent.

CREATE TABLE IF NOT EXISTS public.coach_rates (
  coach_name   TEXT PRIMARY KEY,
  hourly_rate  NUMERIC(6,2),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.coach_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_coach_rates" ON public.coach_rates;
DROP POLICY IF EXISTS "auth_modify_coach_rates" ON public.coach_rates;
CREATE POLICY "auth_select_coach_rates" ON public.coach_rates
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_modify_coach_rates" ON public.coach_rates
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

ALTER TABLE public.coach_checkins
  ADD COLUMN IF NOT EXISTS paid      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_note TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='coach_rates') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.coach_rates;
  END IF;
END $$;
