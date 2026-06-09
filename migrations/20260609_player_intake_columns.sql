-- Migration: extra intake columns from the Upper Hand registration CSV
-- Date: 2026-06-09
--
-- The "DS Elite Tryout - 15s" style export carries a bunch of fields we
-- weren't storing yet: player's own email/phone, address, gender, school
-- team, dominant hand, etc. Adding them as nullable text columns so the
-- bulk-import flow can drop the data straight in and the player card can
-- display + edit it. All optional — no defaults — so existing rows are
-- unaffected.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS player_email   TEXT,
  ADD COLUMN IF NOT EXISTS player_phone   TEXT,
  ADD COLUMN IF NOT EXISTS gender         TEXT,
  ADD COLUMN IF NOT EXISTS address_line1  TEXT,
  ADD COLUMN IF NOT EXISTS address_line2  TEXT,
  ADD COLUMN IF NOT EXISTS state          TEXT,
  ADD COLUMN IF NOT EXISTS zip            TEXT,
  ADD COLUMN IF NOT EXISTS other_sports   TEXT,
  ADD COLUMN IF NOT EXISTS dominant_hand  TEXT,
  ADD COLUMN IF NOT EXISTS school_team    TEXT;
