-- 20260701 — Daily coaching board: court numbers per team + per-date coach
-- absence/sub coverage.
--
-- Run ONCE in the Supabase SQL editor. Additive, non-destructive, idempotent.

-- Court number a team occupies for a (day, slot, phase). NULL = unassigned.
ALTER TABLE public.practice_assignments
  ADD COLUMN IF NOT EXISTS court INTEGER;

-- Per-date coach absence + sub. One row per coach marked out for a specific
-- date/team/slot. sub_name NULL = out but no sub yet (needs coverage).
CREATE TABLE IF NOT EXISTS public.practice_coverage (
  id            BIGSERIAL    PRIMARY KEY,
  practice_date DATE         NOT NULL,
  team_name     TEXT         NOT NULL,
  slot          TEXT         NOT NULL,
  phase         TEXT         NOT NULL DEFAULT 'season',
  coach_out     TEXT         NOT NULL,
  sub_name      TEXT,
  note          TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (practice_date, team_name, slot, phase, coach_out)
);
ALTER TABLE public.practice_coverage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_coverage_all_approved ON public.practice_coverage;
CREATE POLICY practice_coverage_all_approved ON public.practice_coverage
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));
CREATE INDEX IF NOT EXISTS practice_coverage_date_idx ON public.practice_coverage (practice_date);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='practice_coverage') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.practice_coverage;
  END IF;
END $$;
