-- Migration: raw primary/secondary position columns
-- Date: 2026-06-09
--
-- The Upper Hand registration export carries "Primary Position" and
-- "Secondary Position" answers. We were mapping these into positions[]
-- but losing the raw text. The player card shows each tryout-intake
-- question verbatim, so we need to keep the raw answers too.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS primary_position   TEXT,
  ADD COLUMN IF NOT EXISTS secondary_position TEXT;
