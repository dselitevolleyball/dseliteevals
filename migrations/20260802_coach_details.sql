-- 20260802 — Compliance details we need on file for every coach.
--
-- Home address, DOB, USAV member number, AAU member number, phone. DOB and
-- phone already existed; the other three are new.
--
-- Collected from the coaches themselves rather than chased by hand — the same
-- shape as the gear form, which got 28 of 32 answers without Drew typing any
-- of it.
--
-- Run: node scripts/run-sql.mjs migrations/20260802_coach_details.sql
-- Additive and idempotent.

ALTER TABLE public.coach_roster ADD COLUMN IF NOT EXISTS address     text;
ALTER TABLE public.coach_roster ADD COLUMN IF NOT EXISTS usav_number text;
ALTER TABLE public.coach_roster ADD COLUMN IF NOT EXISTS aau_number  text;

COMMENT ON COLUMN public.coach_roster.usav_number IS 'USA Volleyball membership number.';
COMMENT ON COLUMN public.coach_roster.aau_number  IS 'AAU membership number.';
