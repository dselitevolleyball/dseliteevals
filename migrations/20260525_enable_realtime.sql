-- Migration: enable Supabase Realtime for live-updating tables
-- Date: 2026-05-25
--
-- The app subscribes to postgres_changes on these tables and patches local
-- state on every INSERT/UPDATE/DELETE, so coaches see each other's edits
-- without refreshing. Idempotent — already-published tables are skipped.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='players') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.players;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='coaches') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.coaches;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='unassigned_rankings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.unassigned_rankings;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='change_log') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.change_log;
  END IF;
END $$;
