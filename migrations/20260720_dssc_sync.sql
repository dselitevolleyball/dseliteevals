-- Migration: remember the last Playbook → clinics sync (for a "last synced"
-- indicator in the DSSC view). Single-row table (id=1). Date: 2026-07-20.
-- Run: node scripts/run-sql.mjs migrations/20260720_dssc_sync.sql

CREATE TABLE IF NOT EXISTS public.dssc_sync (
  id             SMALLINT PRIMARY KEY DEFAULT 1,
  last_synced_at TIMESTAMPTZ,
  synced_by      TEXT,
  summary        JSONB,
  CONSTRAINT dssc_sync_singleton CHECK (id = 1)
);

ALTER TABLE public.dssc_sync ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_dssc_sync" ON public.dssc_sync;
CREATE POLICY "auth_read_dssc_sync" ON public.dssc_sync FOR SELECT USING (auth.uid() IS NOT NULL);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='dssc_sync') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dssc_sync;
  END IF;
END $$;
