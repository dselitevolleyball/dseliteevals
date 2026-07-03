-- 20260627 — Scholarship-applied flag on players.
--
-- Adds one boolean column so coaches/staff can mark that a player has applied
-- for a scholarship. Set from the checkbox on the player profile card.
--
-- Run once in the Supabase SQL editor. Additive, non-destructive, idempotent.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS scholarship_applied BOOLEAN NOT NULL DEFAULT false;
