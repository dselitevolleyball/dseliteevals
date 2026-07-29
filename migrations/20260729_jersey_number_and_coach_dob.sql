-- 20260729 — Two additive columns.
--
-- players.jersey_number : the player's season jersey number. Distinct from
--   tryout_number (the PINNY number worn at tryouts) and from
--   jersey_tryout_complete (a boolean for "attended the jersey fitting").
--   The lineup planner at src/App.jsx was borrowing tryout_number as a stand-in
--   jersey number; this gives it a real column.
--
-- coach_roster.dob : coach date of birth. TEXT to match players.dob, which is
--   TEXT for the same reason — entry is free-form and partial values are common.
--
-- Run: node scripts/run-sql.mjs migrations/20260729_jersey_number_and_coach_dob.sql
-- Additive and idempotent.

ALTER TABLE public.players      ADD COLUMN IF NOT EXISTS jersey_number integer;
ALTER TABLE public.coach_roster ADD COLUMN IF NOT EXISTS dob           text;

COMMENT ON COLUMN public.players.jersey_number IS 'Season jersey number. Not tryout_number (pinny #).';
COMMENT ON COLUMN public.coach_roster.dob      IS 'Coach date of birth, free-form text like players.dob.';
