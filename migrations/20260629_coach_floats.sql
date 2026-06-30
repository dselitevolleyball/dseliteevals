-- 20260629 — Per-time-block coach "floater" availability.
--
-- One row per (coach, day, slot, phase) the coach is marked as a floater —
-- available to cover that specific time block. Set by clicking an empty cell
-- in the practice planner's By-Coach grid. Separate from the global
-- floating_coaches flag (which the Sunday gap-coverage warnings use).
--
-- Run once in the Supabase SQL editor. Additive, non-destructive, idempotent.

CREATE TABLE IF NOT EXISTS public.coach_floats (
  id          BIGSERIAL    PRIMARY KEY,
  coach_name  TEXT         NOT NULL,
  day         TEXT         NOT NULL,
  slot        TEXT         NOT NULL,
  phase       TEXT         NOT NULL DEFAULT 'season',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (coach_name, day, slot, phase)
);
ALTER TABLE public.coach_floats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coach_floats_all_approved ON public.coach_floats;
CREATE POLICY coach_floats_all_approved ON public.coach_floats
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='coach_floats') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.coach_floats;
  END IF;
END $$;
