-- 20260925 — SportsEngine membership status from the org's member export.
--
-- The Tracker's SportsEngine box was a hand-ticked flag. The export is the
-- truth: a player in it has a claimed profile with the club. These columns
-- remember what the export said and when, beside the existing flag.
--
-- Run: node scripts/run-sql.mjs migrations/20260925_sportsengine.sql
-- Additive, idempotent.

alter table public.players add column if not exists sportsengine_id        text;
alter table public.players add column if not exists sportsengine_status    text;        -- "claimed" etc.
alter table public.players add column if not exists sportsengine_synced_at timestamptz;

select count(*) filter (where sportsengine_registered) as flagged, count(sportsengine_id) as with_id from public.players;
