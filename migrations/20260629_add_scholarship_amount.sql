-- 20260629 — Scholarship offer tracking on players.
--
-- Adds one column:
--   scholarship_amount  TEXT  — the scholarship offer for this player, stored
--                               as free text so it can hold a dollar figure
--                               ("$2,000" / "2000") or a percentage ("50%").
--                               Empty/null = no scholarship offer.
--
-- Surfaced in the admin-only "Scholarships" page under the Operations menu.
--
-- Run once in the Supabase SQL editor. Additive, non-destructive, idempotent.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS scholarship_amount TEXT;
