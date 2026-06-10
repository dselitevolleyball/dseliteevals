-- Migration: tryout-signup flag
-- Date: 2026-06-09
--
-- The CSV importer treats a file whose event title contains "tryout"
-- as the tryout-registration roster. Every player in that file gets
-- tryout_registered=true. The Teams + Tracker views grow a highlight
-- toggle that picks out players still set to false — i.e. on the eval
-- list but not yet on the tryout roster.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS tryout_registered BOOLEAN NOT NULL DEFAULT FALSE;
