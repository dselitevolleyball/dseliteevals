-- 20260725 — Optional third coach slot on practice_teams.
-- Some teams carry an extra coach beyond head + assistant (e.g. 13 Diamond's
-- Jayden Wright, who also head-coaches 14 Ruby and travels with 13 Diamond on
-- weekends 14 Ruby isn't competing). Display-only: shown on the team card and
-- the coach card; NOT wired into conflict detection or coach-load math.
-- Run: node scripts/run-sql.mjs migrations/20260725_third_coach.sql
-- Additive, non-destructive, idempotent.

ALTER TABLE public.practice_teams ADD COLUMN IF NOT EXISTS third_coach TEXT;

UPDATE public.practice_teams
SET third_coach='Jayden Wright', updated_at=now()
WHERE team_name='13 Diamond';
