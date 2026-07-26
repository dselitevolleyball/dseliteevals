-- 20260726 — Housing / stay-to-play tracking on tournaments.
--   stay_to_play      : host REQUIRES booking through their housing partner
--   housing_opens     : the day housing/hotel booking opens (book early or lose
--                       the block — matters for every travel tournament)
--   housing_opens_time: optional host-announced time (free text, like
--                       registration_opens_time)
--   housing_url       : the housing portal link
-- The housing row shows on any tournament that is stay_to_play OR stay_over
-- (stay_over is already auto-set for anything outside Austin/Buda/Round Rock).
-- Run: node scripts/run-sql.mjs migrations/20260726_tournament_housing.sql
-- Additive, idempotent.

ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS stay_to_play       boolean NOT NULL DEFAULT false;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS housing_opens      date;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS housing_opens_time text;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS housing_url        text;
