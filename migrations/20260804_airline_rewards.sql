-- Migration: frequent-flyer numbers, so a coach's miles and status follow them
-- onto tickets the club books. Date: 2026-08-04  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260804_airline_rewards.sql
--
-- Per PERSON, not per trip — the number doesn't change between tournaments.
-- All optional: plenty of coaches won't have one, and a blank must never hold
-- up a booking the way a missing legal name does.

ALTER TABLE public.coach_roster ADD COLUMN IF NOT EXISTS ff_southwest text;
ALTER TABLE public.coach_roster ADD COLUMN IF NOT EXISTS ff_american  text;
ALTER TABLE public.coach_roster ADD COLUMN IF NOT EXISTS ff_delta     text;
ALTER TABLE public.coach_roster ADD COLUMN IF NOT EXISTS ff_united    text;

COMMENT ON COLUMN public.coach_roster.ff_southwest IS 'Southwest Rapid Rewards number.';
COMMENT ON COLUMN public.coach_roster.ff_american  IS 'American Airlines AAdvantage number.';
COMMENT ON COLUMN public.coach_roster.ff_delta     IS 'Delta SkyMiles number.';
COMMENT ON COLUMN public.coach_roster.ff_united    IS 'United MileagePlus number.';
