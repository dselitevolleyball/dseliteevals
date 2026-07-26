-- 20260726 — Optional registration open TIME.
-- AES publishes a date only (every event's registrationPeriod.startDate is
-- midnight), so this holds a host-announced time like "9:00 AM" when we know
-- one. Free text: hosts word these inconsistently and some are "TBD".
-- Run: node scripts/run-sql.mjs migrations/20260726_registration_opens_time.sql
-- Additive, idempotent.

ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS registration_opens_time text;
