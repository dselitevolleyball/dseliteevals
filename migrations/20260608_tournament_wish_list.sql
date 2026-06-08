-- Migration: add per-team wish_list to tournaments
-- Date: 2026-06-08
--
-- wish_list is a TEXT[] of team IDs that have flagged this tournament as a
-- "want to go" candidate. Coaches mark them in the tournament edit modal;
-- the tournament card shows a ★ chip for each wished team. Defaults to
-- empty so existing rows are unaffected.

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS wish_list TEXT[] NOT NULL DEFAULT '{}';
