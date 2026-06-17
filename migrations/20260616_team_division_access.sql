-- 20260616 — Per-coach age-group (division) access.
--
-- Adds coaches.team_divs (TEXT[]). When non-empty, that coach only sees those
-- age divisions (e.g. {'U14','U15'}) across Evaluate, Teams, and Rankings.
-- Empty = all age groups (the default, so existing coaches are unaffected).
-- The owner (Drew) always sees every group regardless.
--
-- Managed from the Coaches screen (the "Age Groups" column). Run once in the
-- Supabase SQL editor. Additive, non-destructive, idempotent.

ALTER TABLE public.coaches
  ADD COLUMN IF NOT EXISTS team_divs TEXT[] NOT NULL DEFAULT '{}';
