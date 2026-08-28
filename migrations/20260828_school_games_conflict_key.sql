-- 20260828 — make school_games upsertable by column name
--
-- The dedupe index used coalesce(opponent,'') so NULL opponents wouldn't count
-- as distinct. That works for the wholesale rebuild, but PostgREST can only
-- resolve an ON CONFLICT target it can name in columns, so the form endpoints
-- couldn't upsert against it — and a family's schedule wouldn't reach the
-- master schedule until the nightly rebuild.
--
-- NULLS NOT DISTINCT (PG15+, this is 17.6) gives the same "a null opponent is
-- still the same game" behaviour with a plain column list.
--
-- Run: node scripts/run-sql.mjs migrations/20260828_school_games_conflict_key.sql
-- Idempotent.

DROP INDEX IF EXISTS public.school_games_dedupe_idx;

CREATE UNIQUE INDEX IF NOT EXISTS school_games_key_idx
  ON public.school_games (school_key, game_date, opponent, level) NULLS NOT DISTINCT;
