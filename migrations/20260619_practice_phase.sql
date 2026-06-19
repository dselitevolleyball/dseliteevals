-- Migration: add a phase column to practice_assignments so we can store
-- both a "season" and a "preseason" practice grid side by side.
-- Date: 2026-06-19
--
-- The Practice tab gets a toggle that filters/writes against the active
-- phase. The existing rows all become 'season'.

ALTER TABLE public.practice_assignments
  ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'season';

-- Replace the old (team_name, day, slot) UNIQUE with one that includes
-- phase so the same team can have different slots in each phase.
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
  FROM   pg_constraint
  WHERE  conrelid = 'public.practice_assignments'::regclass
    AND  contype  = 'u'
    AND  pg_get_constraintdef(oid) ILIKE '%team_name%day%slot%'
    AND  pg_get_constraintdef(oid) NOT ILIKE '%phase%';
  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.practice_assignments DROP CONSTRAINT ' || quote_ident(cname);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE  conrelid = 'public.practice_assignments'::regclass
      AND  conname  = 'practice_assignments_team_day_slot_phase_key'
  ) THEN
    ALTER TABLE public.practice_assignments
      ADD CONSTRAINT practice_assignments_team_day_slot_phase_key
      UNIQUE (team_name, day, slot, phase);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS practice_assignments_phase_idx
  ON public.practice_assignments(phase);
