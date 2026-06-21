-- 20260621 — 10-yard sprint testing field on players.
--
-- Adds one column:
--   sprint_10y  NUMERIC  — 10-yard sprint time in seconds (manual entry, lower = faster)
--
-- Joins the existing physical-testing fields (stand_reach, jump_touch,
-- tryout_attended) added in migrations/20260617_tryout_testing.sql.
--
-- Run once in the Supabase SQL editor. Additive, non-destructive, idempotent.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS sprint_10y NUMERIC;
