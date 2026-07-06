-- 20260706 — Add "combine teams" as a coach-absence coverage option.
--
-- practice_coverage already models a coach out + a sub (sub_name) or a floating
-- coach (a sub_name that's in coach_floats). This adds the third option Drew
-- wants: cover the absence by combining this team's practice with another team.
-- combine_with_team = the team they merge into for that date/slot.
--
-- Run: node scripts/run-sql.mjs migrations/20260706_coverage_combine.sql
-- Additive, non-destructive, idempotent.

ALTER TABLE public.practice_coverage
  ADD COLUMN IF NOT EXISTS combine_with_team TEXT;
