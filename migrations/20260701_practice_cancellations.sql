-- 20260701 — Cancel practice on specific dates (holidays) from the Daily
-- calendar. One row per cancelled date.
--
-- Run ONCE in the Supabase SQL editor. Additive, non-destructive, idempotent.

CREATE TABLE IF NOT EXISTS public.practice_cancellations (
  practice_date DATE         PRIMARY KEY,
  reason        TEXT,
  cancelled_by  TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
ALTER TABLE public.practice_cancellations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_cancellations_all_approved ON public.practice_cancellations;
CREATE POLICY practice_cancellations_all_approved ON public.practice_cancellations
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='practice_cancellations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.practice_cancellations;
  END IF;
END $$;
