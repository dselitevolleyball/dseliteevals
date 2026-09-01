-- 20260901 — remember which shifts a coach has already been told about.
--
-- The weekly confirmation must be able to run twice without emailing anybody
-- twice. DSSC already had somewhere to record it — dssc_checkins.sent_at, added
-- and never used — so this only adds the matching column on the DS Elite side.
--
-- Stamped per SHIFT rather than per coach per week, because a shift added late
-- (a sub logged on Wednesday for the Sunday before) should still be reported
-- the next time the job runs, without re-reporting the ones already sent.
--
-- Run: node scripts/run-sql.mjs migrations/20260901_timecard_notified.sql
-- Additive and idempotent.

ALTER TABLE public.coach_checkins
  ADD COLUMN IF NOT EXISTS notified_at timestamptz;

COMMENT ON COLUMN public.coach_checkins.notified_at IS
  'When the coach was emailed their weekly timecard confirmation for this shift. NULL = not yet told.';

CREATE INDEX IF NOT EXISTS coach_checkins_notified_idx
  ON public.coach_checkins (check_date) WHERE notified_at IS NULL;
