-- 20260726 — Per-date practice slot moves (Sunday 4-court planning).
-- Move a team to a different time block on a specific date WITHOUT changing the
-- recurring schedule. No row for (date, team) = the team keeps its normal slot.
-- Used by the Sunday court planner to squeeze a light Sunday into 4 courts.
-- Run: node scripts/run-sql.mjs migrations/20260726_practice_slot_moves.sql
-- Additive, idempotent.

CREATE TABLE IF NOT EXISTS public.practice_slot_moves (
  practice_date date NOT NULL,
  team_name     text NOT NULL,
  slot          text NOT NULL,
  phase         text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  PRIMARY KEY (practice_date, team_name)
);

ALTER TABLE public.practice_slot_moves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_slot_moves_all_approved ON public.practice_slot_moves;
CREATE POLICY practice_slot_moves_all_approved ON public.practice_slot_moves
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));
