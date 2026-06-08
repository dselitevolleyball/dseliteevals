-- Migration: per-player onboarding tracker columns
-- Date: 2026-06-08
--
-- Adds four booleans the new "Tracker" tab toggles for each accepted
-- player so the staff can see at a glance who still needs to finish
-- their SportsEngine / SportsYou / Lone Star sign-up and jersey tryout.
-- All default to FALSE; the Tracker view filters to accepted players
-- (offer_status='accepted') and lets coaches flip the boxes per-row.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS sportsengine_registered  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sportsyou_registered     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS lonestar_member          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS jersey_tryout_complete   BOOLEAN NOT NULL DEFAULT FALSE;
