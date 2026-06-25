-- 20260624 — Approach Touch physical-testing field on players.
--
-- Adds one column:
--   approach_touch  NUMERIC  — approach (running) touch height, inches.
--
-- Joins the existing physical-testing fields (stand_reach, jump_touch,
-- sprint_10y). Vertical stays computed in the app as jump_touch - stand_reach.
--
-- Run once in the Supabase SQL editor. Additive, non-destructive, idempotent.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS approach_touch NUMERIC;
