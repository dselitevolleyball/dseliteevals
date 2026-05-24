-- Migration: track offer workflow (made / accepted / declined / not invited)
-- Date: 2026-05-24
-- Run this once in the Supabase SQL editor (https://supabase.com/dashboard).
-- Additive only — safe to run against the production players table.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS offer_status      TEXT        NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS offer_made_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offer_decision_at TIMESTAMPTZ;

-- offer_status values used by the app:
--   ''            no action yet (default)
--   'made'        offer extended to the family, awaiting decision
--   'accepted'    family accepted (player stays on assigned team)
--   'declined'    family declined (team_assignment is cleared by the app)
--   'not_invited' coach explicitly excluded the player from offers
