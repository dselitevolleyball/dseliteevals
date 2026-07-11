-- Migration: coaching playbook — the DSSC / DS Elite training manifesto that
-- coaches read, affirm, and re-affirm when it changes.
-- Date: 2026-07-11
--
-- playbook_meta   — one row: the doc title + current version + changelog.
-- playbook_entries— the manifesto content (category -> title -> body + cues).
-- playbook_acks   — each coach's sign-off, per version (bump version = re-sign).
--
-- Run: node scripts/run-sql.mjs migrations/20260711_playbook.sql
-- Additive, non-destructive, idempotent.

CREATE TABLE IF NOT EXISTS public.playbook_meta (
  id            INT PRIMARY KEY DEFAULT 1,
  title         TEXT NOT NULL DEFAULT 'DS Elite Coaching Playbook',
  subtitle      TEXT DEFAULT 'How we teach, talk, and reinforce the game.',
  version       INT NOT NULL DEFAULT 1,
  changelog     TEXT,
  published_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by  TEXT,
  CONSTRAINT playbook_meta_single_row CHECK (id = 1)
);
INSERT INTO public.playbook_meta (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.playbook_entries (
  id          BIGSERIAL PRIMARY KEY,
  category    TEXT NOT NULL DEFAULT 'General',
  title       TEXT NOT NULL,
  body        TEXT,
  cues        TEXT,                        -- exact words / cues we use
  sort_order  INT NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS playbook_entries_order_idx ON public.playbook_entries(sort_order);

CREATE TABLE IF NOT EXISTS public.playbook_acks (
  id          BIGSERIAL PRIMARY KEY,
  coach_name  TEXT NOT NULL,
  coach_email TEXT,
  version     INT NOT NULL,
  acked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (coach_name, version)
);
CREATE INDEX IF NOT EXISTS playbook_acks_version_idx ON public.playbook_acks(version);

DO $$ BEGIN
  EXECUTE 'ALTER TABLE public.playbook_meta ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.playbook_entries ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.playbook_acks ENABLE ROW LEVEL SECURITY';
END $$;

DROP POLICY IF EXISTS "auth_all_playbook_meta" ON public.playbook_meta;
DROP POLICY IF EXISTS "auth_all_playbook_entries" ON public.playbook_entries;
DROP POLICY IF EXISTS "auth_all_playbook_acks" ON public.playbook_acks;
CREATE POLICY "auth_all_playbook_meta" ON public.playbook_meta FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth_all_playbook_entries" ON public.playbook_entries FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth_all_playbook_acks" ON public.playbook_acks FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='playbook_entries') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.playbook_entries;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='playbook_meta') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.playbook_meta;
  END IF;
END $$;
