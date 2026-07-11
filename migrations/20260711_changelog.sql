-- Migration: app changelog — a running log of what changed (features, fixes,
-- improvements). Compiled daily into a digest that Drew approves before it
-- pushes to coaches.
-- Date: 2026-07-11
--
-- changelog_entries    each shipped change (kind + title + optional detail).
--                      broadcast_id is set once it's gone out in a digest.
-- changelog_broadcasts one staged digest per day: pending -> sent | skipped.
--                      entry_ids holds the entries it covers.
--
-- Run: node scripts/run-sql.mjs migrations/20260711_changelog.sql
-- Additive, idempotent.

CREATE TABLE IF NOT EXISTS public.changelog_entries (
  id           BIGSERIAL PRIMARY KEY,
  kind         TEXT NOT NULL DEFAULT 'feature',   -- feature | fix | improvement | other
  title        TEXT NOT NULL,
  detail       TEXT,
  created_by   TEXT,
  broadcast_id BIGINT,                            -- set when included in a sent digest
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS changelog_entries_unsent_idx ON public.changelog_entries(broadcast_id);

CREATE TABLE IF NOT EXISTS public.changelog_broadcasts (
  id               BIGSERIAL PRIMARY KEY,
  title            TEXT NOT NULL DEFAULT 'What''s new in DS Elite HQ',
  body             TEXT NOT NULL,                 -- compiled digest text
  entry_ids        JSONB NOT NULL DEFAULT '[]'::jsonb,
  status           TEXT NOT NULL DEFAULT 'pending', -- pending | sent | skipped
  created_for_date DATE NOT NULL,
  approved_by      TEXT,
  sent_at          TIMESTAMPTZ,
  sent_count       INT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (created_for_date)
);
CREATE INDEX IF NOT EXISTS changelog_broadcasts_status_idx ON public.changelog_broadcasts(status);

ALTER TABLE public.changelog_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.changelog_broadcasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_changelog_entries" ON public.changelog_entries;
DROP POLICY IF EXISTS "auth_all_changelog_broadcasts" ON public.changelog_broadcasts;
CREATE POLICY "auth_all_changelog_entries" ON public.changelog_entries FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth_all_changelog_broadcasts" ON public.changelog_broadcasts FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='changelog_broadcasts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.changelog_broadcasts;
  END IF;
END $$;
