-- 20260822 — Put players on the realtime publication.
--
-- App.jsx has subscribed to postgres_changes on public.players since the
-- realtime sync went in, but the table was never added to supabase_realtime.
-- 52 other tables are on the publication; players is not, so that channel has
-- never delivered a single event. Every other table's live updates worked,
-- which is exactly why this went unnoticed: the roster looked like the one
-- screen that "just needed a refresh".
--
-- Consequence: moving a player between teams, adding a new athlete, or the
-- autoroster trigger flipping roster_status all stayed invisible until a
-- manual reload. Jemma Gong was assigned to 12 Ruby and nobody's screen moved.
--
-- REPLICA IDENTITY FULL so UPDATE events carry the old row as well as the new.
-- Supabase needs the old values to apply RLS to change events, and the client's
-- DELETE handler reads payload.old.id. The table is a few hundred rows, so the
-- extra WAL is immaterial.
--
-- Run: node scripts/run-sql.mjs migrations/20260822_players_realtime.sql
-- Additive and idempotent.

ALTER TABLE public.players REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename  = 'players'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.players;
  END IF;
END $$;
