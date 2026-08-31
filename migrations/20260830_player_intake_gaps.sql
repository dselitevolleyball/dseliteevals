-- 20260830 — allergies and medical notes on the player record.
--
-- The master team workbooks carry an "Allergy 1" column and a free-text
-- "Details" beside it ("Seasonal asthma — carries an inhaler", "Ibuprofen — if
-- needed use Tylenol"). The roster had nowhere to put either, so the one piece
-- of information a coach might need in a hurry lived only in a spreadsheet on
-- somebody's laptop.
--
-- Asked on the gear form of players we hold nothing for — which today means
-- new players joining after registration closed, who never filled anything in.
--
-- Run: node scripts/run-sql.mjs migrations/20260830_player_intake_gaps.sql
-- Additive and idempotent.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS allergies     text,
  ADD COLUMN IF NOT EXISTS medical_notes text;

COMMENT ON COLUMN public.players.allergies IS
  'Allergies as the family stated them. Blank means not asked, not "none".';
COMMENT ON COLUMN public.players.medical_notes IS
  'Anything a coach should know in a hurry — inhaler, what to give instead, an old injury.';
