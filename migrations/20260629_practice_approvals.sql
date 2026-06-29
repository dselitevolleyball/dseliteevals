-- 20260629 — Per-team practice-schedule approval by the coach.
--
-- practice_approvals: one row per team. The coach clicks "Approve" on their
-- Home practice card to confirm the schedule is correct with no conflicts.
-- Directors see who has / hasn't approved on the All Teams page.
--
-- Run once in the Supabase SQL editor. Additive, non-destructive, idempotent.

CREATE TABLE IF NOT EXISTS public.practice_approvals (
  team_name        TEXT         PRIMARY KEY,
  approved         BOOLEAN      NOT NULL DEFAULT FALSE,
  approved_by_name TEXT,
  approved_at      TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
ALTER TABLE public.practice_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_approvals_all_approved ON public.practice_approvals;
CREATE POLICY practice_approvals_all_approved ON public.practice_approvals
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='practice_approvals') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.practice_approvals;
  END IF;
END $$;
