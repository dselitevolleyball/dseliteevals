-- 20260726 — Tournament registration tracking.
--   registration_opens    : the date registration OPENS (we already track the
--                           deadline in registration_deadline)
--   registration_platform : where to register — 'AES' or 'SportWrench'
--                           (NULL = inferred from the tournament's source)
-- Run: node scripts/run-sql.mjs migrations/20260726_tournament_registration.sql
-- Additive, idempotent.

ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS registration_opens    date;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS registration_platform text;
