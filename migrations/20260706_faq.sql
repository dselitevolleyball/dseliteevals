-- 20260706 — Coach FAQ + archive answered questions.
--
-- faq: a curated list of Q&A coaches can reference (built from answered coach
-- questions or added directly). Readable by any approved coach; only admins can
-- add/edit/remove entries.
-- team_questions.archived: lets admins clear an answered question from the
-- pending panel once it's handled ("Done").
--
-- Run: node scripts/run-sql.mjs migrations/20260706_faq.sql
-- Additive, non-destructive, idempotent.

CREATE TABLE IF NOT EXISTS public.faq (
  id          BIGSERIAL PRIMARY KEY,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  category    TEXT,                         -- e.g. the checklist item_key, or a free topic
  team_name   TEXT,                         -- optional source context
  pinned      BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_by  TEXT,
  source_question_id BIGINT,                -- team_questions.id it came from, if any
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.faq ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS faq_select_approved ON public.faq;
DROP POLICY IF EXISTS faq_modify_admin ON public.faq;
-- Any approved coach can read the FAQ.
CREATE POLICY faq_select_approved ON public.faq
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));
-- Only admins can add / edit / remove entries.
CREATE POLICY faq_modify_admin ON public.faq
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_admin));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='faq') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.faq;
  END IF;
END $$;

-- Archive flag on answered questions.
ALTER TABLE public.team_questions
  ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
