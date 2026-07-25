-- Migration: per-tournament coaching staff. Each team's tournament assignment
-- can override the head and/or assistant coach (e.g. swap in a sub when the
-- regular coach is double-booked). NULL = use the team's roster coach.
-- Conflict detection uses the effective (override-or-default) staff, so swapping
-- in a sub clears the conflict. Date: 2026-07-24. Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260724_assignment_coach_overrides.sql

ALTER TABLE public.tournament_assignments ADD COLUMN IF NOT EXISTS head_override TEXT;
ALTER TABLE public.tournament_assignments ADD COLUMN IF NOT EXISTS asst_override TEXT;
