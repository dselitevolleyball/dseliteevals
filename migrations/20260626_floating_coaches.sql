-- 20260626 — Floating coaches.
--
-- A coach with a SHORT idle gap on Sunday (<= 2 hours) can be designated a
-- "floating coach" — they fill the gap helping elsewhere, so the gap is fine.
-- Gaps longer than 2 hours are never floatable and stay a hard warning.
--
-- One row per coach name that is marked floating (global, not per-phase).
-- Run once in the Supabase SQL editor. Additive, non-destructive.

CREATE TABLE IF NOT EXISTS public.floating_coaches (
  name        TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.floating_coaches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_floating" ON public.floating_coaches;
DROP POLICY IF EXISTS "auth_modify_floating" ON public.floating_coaches;
CREATE POLICY "auth_select_floating" ON public.floating_coaches
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_modify_floating" ON public.floating_coaches
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
