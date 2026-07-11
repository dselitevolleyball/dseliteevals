-- Migration: practice plan lifecycle statuses — planned / in_progress / executed.
-- Date: 2026-07-11
-- Remaps the old draft/done values and changes the default.
-- Run: node scripts/run-sql.mjs migrations/20260711_plan_status.sql

UPDATE public.practice_plans SET status = 'planned'  WHERE status IN ('draft') OR status IS NULL;
UPDATE public.practice_plans SET status = 'executed' WHERE status = 'done';

ALTER TABLE public.practice_plans ALTER COLUMN status SET DEFAULT 'planned';
