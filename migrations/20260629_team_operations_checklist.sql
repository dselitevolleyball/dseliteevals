-- 20260629 — Per-team operational checklist + coach→director Q&A.
--
-- team_tasks: one row per (team_name, item_key) holding a status and notes.
--   Covers both the Coach To-Do and Operations To-Do item lists; the item
--   definitions (which list an item belongs to) live in the app.
--   status: 'not_started' (default) | 'in_progress' | 'done'
--
-- team_questions: questions a coach posts against a checklist item, plus the
--   director's answer. Drives the admin notification (unanswered = pending).
--
-- Run once in the Supabase SQL editor. Additive, non-destructive, idempotent.

CREATE TABLE IF NOT EXISTS public.team_tasks (
  team_name   TEXT         NOT NULL,
  item_key    TEXT         NOT NULL,
  status      TEXT         NOT NULL DEFAULT 'not_started',
  notes       TEXT         NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_name, item_key)
);
ALTER TABLE public.team_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_tasks_all_approved ON public.team_tasks;
CREATE POLICY team_tasks_all_approved ON public.team_tasks
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

CREATE TABLE IF NOT EXISTS public.team_questions (
  id               BIGSERIAL    PRIMARY KEY,
  team_name        TEXT         NOT NULL,
  item_key         TEXT         NOT NULL,
  question         TEXT         NOT NULL,
  asked_by_name    TEXT,
  asked_by_email   TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  answer           TEXT,
  answered_by_name TEXT,
  answered_at      TIMESTAMPTZ
);
ALTER TABLE public.team_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_questions_all_approved ON public.team_questions;
CREATE POLICY team_questions_all_approved ON public.team_questions
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));
CREATE INDEX IF NOT EXISTS team_questions_team_idx ON public.team_questions (team_name);

-- Live updates so statuses, answers, and new questions appear without refresh.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='team_tasks') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.team_tasks;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='team_questions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.team_questions;
  END IF;
END $$;
