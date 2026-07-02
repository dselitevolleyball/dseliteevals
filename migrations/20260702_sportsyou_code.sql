-- 20260702 — Optional: per-team SportsYou join code override.
--
-- The app ships with the codes built in (SPORTSYOU_CODES in src/App.jsx), so
-- nothing breaks without this. Run it only if you want to change a code from
-- the database (practice_teams.sportsyou_code overrides the built-in map).
--
-- Run once in the Supabase SQL editor. Additive, non-destructive, idempotent.

ALTER TABLE public.practice_teams
  ADD COLUMN IF NOT EXISTS sportsyou_code TEXT;
