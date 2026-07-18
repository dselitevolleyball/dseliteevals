-- Migration: per-team practice cancellations. Adds team_name to
-- practice_cancellations ('' = the whole day, as before; a team name = just
-- that team on that date). Date: 2026-07-18
-- Run: node scripts/run-sql.mjs migrations/20260718_cancel_by_team.sql
-- Additive, idempotent.

ALTER TABLE public.practice_cancellations ADD COLUMN IF NOT EXISTS team_name TEXT NOT NULL DEFAULT '';

-- Move off the practice_date-only primary key so multiple rows per date are
-- allowed (one whole-day '' row plus any number of per-team rows).
ALTER TABLE public.practice_cancellations DROP CONSTRAINT IF EXISTS practice_cancellations_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS practice_cancellations_date_team_uniq
  ON public.practice_cancellations (practice_date, team_name);

-- The table is in the supabase_realtime publication (publishes deletes), so
-- without the old PK it needs a replica identity or DELETEs fail. Use the new
-- unique index as the identity.
ALTER TABLE public.practice_cancellations REPLICA IDENTITY USING INDEX practice_cancellations_date_team_uniq;
