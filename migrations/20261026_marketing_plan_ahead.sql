-- Migration: the Marketing Machine keeps the next N weeks drafted (instead of
-- drafting next week only on Sunday evening). Date: 2026-10-26. Idempotent.
-- Run: node scripts/run-sql.mjs migrations/20261026_marketing_plan_ahead.sql
ALTER TABLE public.mkt_settings ADD COLUMN IF NOT EXISTS plan_ahead int NOT NULL DEFAULT 2 CHECK (plan_ahead BETWEEN 0 AND 6);
