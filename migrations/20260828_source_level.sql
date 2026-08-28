-- 20260828 — a schedule source can be for one team level
--
-- A fetched school-wide schedule has no level: it covers every team there. But
-- a schedule copied out by hand is often one team's — Westlake publishes Flex
-- and Freshman as separate time columns, and our girls are on those two. Without
-- somewhere to put that, the level was lost and the board couldn't tell a Flex
-- fixture from a Freshman one.
--
-- Run: node scripts/run-sql.mjs migrations/20260828_source_level.sql
-- Additive and idempotent.

ALTER TABLE public.school_schedule_sources
  ADD COLUMN IF NOT EXISTS level text;

COMMENT ON COLUMN public.school_schedule_sources.level IS
  'Team level this source covers, or null for a whole-school schedule.';
