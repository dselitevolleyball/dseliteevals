-- Migration: trend ideas — the idea scout's weekly TikTok / Reels trend scan
-- suggests posts that adapt a current trend, with the look to make it in
-- (a POV caption over a photo, or a handwritten note).
-- Date: 2026-10-27. Idempotent.
-- Run: node scripts/run-sql.mjs migrations/20261027_marketing_trends.sql
ALTER TABLE public.mkt_ideas ADD COLUMN IF NOT EXISTS template text;   -- pov | note | null (photo)
ALTER TABLE public.mkt_ideas ADD COLUMN IF NOT EXISTS trend    text;   -- the trend's name, for kind 'trend'
