-- 20260629 — Editable checklist item descriptions + a club Updates feed.
--
-- task_meta: one row per checklist item_key holding an admin-editable
--   description/notes shown on every team's card for that item (global, not
--   per-team). Overrides the hardcoded default detail text in the app.
--
-- updates: club-wide announcements admins post; shown to coaches on the Home
--   page when they log in.
--
-- Run once in the Supabase SQL editor. Additive, non-destructive, idempotent.

CREATE TABLE IF NOT EXISTS public.task_meta (
  item_key    TEXT         PRIMARY KEY,
  description TEXT         NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
ALTER TABLE public.task_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_meta_all_approved ON public.task_meta;
CREATE POLICY task_meta_all_approved ON public.task_meta
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

CREATE TABLE IF NOT EXISTS public.updates (
  id              BIGSERIAL    PRIMARY KEY,
  body            TEXT         NOT NULL,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
ALTER TABLE public.updates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS updates_all_approved ON public.updates;
CREATE POLICY updates_all_approved ON public.updates
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='task_meta') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.task_meta;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='updates') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.updates;
  END IF;
END $$;
