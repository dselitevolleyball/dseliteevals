-- 20260617 — Tryout physical-testing fields on players.
--
-- Adds three columns:
--   stand_reach     NUMERIC  — standing reach, inches (manual entry)
--   jump_touch      NUMERIC  — jump touch height, inches (manual entry)
--   tryout_attended BOOLEAN  — checkbox for tryout attendance
-- Vertical (jump_touch - stand_reach) is computed in the app, not stored.
--
-- Run once in the Supabase SQL editor. Additive, non-destructive, idempotent.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS stand_reach     NUMERIC,
  ADD COLUMN IF NOT EXISTS jump_touch      NUMERIC,
  ADD COLUMN IF NOT EXISTS tryout_attended BOOLEAN NOT NULL DEFAULT FALSE;
