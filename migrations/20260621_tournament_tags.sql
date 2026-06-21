-- 20260621 — Custom tags on tournaments.
--
-- Adds two columns:
--   tags         TEXT[]  — user-created tags on a tournament (e.g. "Priority",
--                          "Local", "Recruiting"). Free-form.
--   hidden_tags  TEXT[]  — auto-computed tags (Easter, 3-Day Weekend, holiday
--                          names) the user has removed from a specific
--                          tournament, so the badge no longer shows there.
--
-- Auto tags themselves are still computed in the app from dates/blackouts;
-- hidden_tags only suppresses them per-tournament.
--
-- Run once in the Supabase SQL editor. Additive, non-destructive, idempotent.

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS tags        TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS hidden_tags TEXT[] NOT NULL DEFAULT '{}';
