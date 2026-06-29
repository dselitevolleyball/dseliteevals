-- 20260629 — Per-team status for the Teams board.
--
-- Tracks where each team stands during team-building. Keyed by team_name
-- (board teams come from the hardcoded TM map, not a table, so team_name is
-- the natural key).
--   status             — 'in_progress' (default) | 'looking' | 'completed'
--   looking_positions  — positions the team still needs while 'looking'
--
-- Run once in the Supabase SQL editor. Additive, non-destructive, idempotent.

CREATE TABLE IF NOT EXISTS public.team_status (
  team_name          TEXT         PRIMARY KEY,
  status             TEXT         NOT NULL DEFAULT 'in_progress',
  looking_positions  TEXT[]       NOT NULL DEFAULT '{}',
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.team_status ENABLE ROW LEVEL SECURITY;

-- Any approved coach can read and write team status (same as players).
DROP POLICY IF EXISTS team_status_all_approved ON public.team_status;
CREATE POLICY team_status_all_approved ON public.team_status
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

-- Live updates so coaches see each other's status changes without refreshing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='team_status') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.team_status;
  END IF;
END $$;
