-- Migration: free music for reels from Openverse (CC0 / CC BY). A track keeps
-- where it came from, its licence and - for CC BY - the credit line the
-- publisher adds to the caption of any reel that uses it.
-- Date: 2026-10-28. Idempotent. Run after 20261025_marketing_video.sql.
-- Run: node scripts/run-sql.mjs migrations/20261028_marketing_free_music.sql
ALTER TABLE public.mkt_music ADD COLUMN IF NOT EXISTS external_id text;   -- Openverse id
ALTER TABLE public.mkt_music ADD COLUMN IF NOT EXISTS source      text;   -- openverse:jamendo | upload ...
ALTER TABLE public.mkt_music ADD COLUMN IF NOT EXISTS source_url  text;   -- the track's page
ALTER TABLE public.mkt_music ADD COLUMN IF NOT EXISTS license     text;   -- "CC BY 3.0", "CC0 (public domain)"
ALTER TABLE public.mkt_music ADD COLUMN IF NOT EXISTS attribution text;   -- credit line for captions (CC BY)
CREATE UNIQUE INDEX IF NOT EXISTS mkt_music_external_idx ON public.mkt_music (external_id) WHERE external_id IS NOT NULL;
