-- 20260627 — Second parent/guardian email on players.
--
-- Adds one column:
--   parent_email2  TEXT  — optional second parent/guardian email
--
-- Joins the existing contact fields (parent_name, parent_email, parent_phone).
-- When present, this address is included alongside parent_email in the bulk
-- email recipient pool and the various "parent email" counts/exports.
--
-- Run once in the Supabase SQL editor. Additive, non-destructive, idempotent.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS parent_email2 TEXT;
