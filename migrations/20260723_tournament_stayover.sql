-- Migration: mark a tournament as a "stay-over" (needs a hotel). Hotel nights =
-- the tournament's day count (2-day → 2 nights, 3-day → 3 nights). Shown per
-- tournament in the team card. Date: 2026-07-23. Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260723_tournament_stayover.sql

ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS stay_over BOOLEAN NOT NULL DEFAULT false;
