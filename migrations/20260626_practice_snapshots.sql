-- 20260626 — Practice schedule snapshots (save / revert).
--
-- A manual "restore point" for the whole practice schedule. Saving captures
-- every practice_assignments row + every sa_sessions row as JSON. Reverting
-- replaces the live tables with a saved snapshot's contents — an undo for when
-- a round of edits goes wrong.
--
-- Run once in the Supabase SQL editor. Additive, non-destructive.

CREATE TABLE IF NOT EXISTS public.practice_snapshots (
  id           BIGSERIAL PRIMARY KEY,
  label        TEXT NOT NULL DEFAULT 'Snapshot',
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  assignments  JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{team_name, day, slot, phase}]
  sa_sessions  JSONB NOT NULL DEFAULT '[]'::jsonb    -- [{block, session_date, slot, team_name}]
);

ALTER TABLE public.practice_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_snapshots" ON public.practice_snapshots;
DROP POLICY IF EXISTS "auth_modify_snapshots" ON public.practice_snapshots;
CREATE POLICY "auth_select_snapshots" ON public.practice_snapshots
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_modify_snapshots" ON public.practice_snapshots
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
