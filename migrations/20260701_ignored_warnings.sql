-- 20260701 — Ignore/dismiss practice-schedule conflicts & warnings, shared
-- across everyone. Each warning has a signature that encodes the coaching
-- assignment behind it; ignoring stores that signature here and the warning
-- stays hidden for all coaches until the assignment changes (which changes the
-- signature, so it no longer matches and the warning reappears).
--
-- Run ONCE in the Supabase SQL editor. Additive, non-destructive, idempotent.

CREATE TABLE IF NOT EXISTS public.ignored_warnings (
  sig         TEXT         PRIMARY KEY,
  phase       TEXT,
  text        TEXT,
  ignored_by  TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
ALTER TABLE public.ignored_warnings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ignored_warnings_all_approved ON public.ignored_warnings;
CREATE POLICY ignored_warnings_all_approved ON public.ignored_warnings
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='ignored_warnings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ignored_warnings;
  END IF;
END $$;
