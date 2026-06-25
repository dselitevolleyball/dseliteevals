-- 20260624 — Physical-testing station assignments on tryouts.
--
-- Adds four coach-assignment array columns to the tryouts table, matching the
-- existing role columns (lead_coaches / court_coaches / evaluating_coaches).
-- These power new roles on the Tryout Coach Assignments screen:
--   checkin_coaches      — Check In
--   stand_reach_coaches  — Stand & Reach
--   jump_touch_coaches   — Approach & Jump Touch
--   shuttle_coaches      — Shuttle Run
--
-- Run once in the Supabase SQL editor. Additive, non-destructive, idempotent.

ALTER TABLE public.tryouts
  ADD COLUMN IF NOT EXISTS checkin_coaches     TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS stand_reach_coaches TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS jump_touch_coaches  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS shuttle_coaches     TEXT[] NOT NULL DEFAULT '{}';
