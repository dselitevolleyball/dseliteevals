-- Migration: role-based coach pay — optional head-coach rate.
-- Date: 2026-07-09
--
-- Some coaches earn more on the team they head-coach than where they assist
-- (per Drew's rates sheet). hourly_rate stays the default (assist/sub/float);
-- head_rate, when set, applies to shifts for a team whose head_coach is them.
--
-- Run: node scripts/run-sql.mjs migrations/20260709_coach_head_rate.sql
-- Additive, non-destructive, idempotent.

ALTER TABLE public.coach_rates
  ADD COLUMN IF NOT EXISTS head_rate NUMERIC(6,2);
