-- 20260825 — let staff correct a school-team answer
--
-- Families type their own school name into the public form, so the board ends
-- up with "DSHS", "Dripping Springs", and "Dripping Springs High School" as
-- three separate schools — and some rows arrive with the school blank. Drew
-- usually knows the right answer, so the app now lets an admin fix the name in
-- place (and fill one in for a family that never replied) instead of the value
-- being frozen until a parent re-opens their link.
--
-- edited_by/edited_at record that a human on our side touched the row, so a
-- corrected answer is never mistaken for what the parent literally typed. They
-- stay null on rows only the family has written.
--
-- The form endpoint still upserts the same row, so a family re-submitting later
-- overwrites our correction — which is right: they know their own season best.
--
-- Run: node scripts/run-sql.mjs migrations/20260825_school_report_staff_edits.sql
-- Additive and idempotent.

ALTER TABLE public.school_team_reports
  ADD COLUMN IF NOT EXISTS edited_by text,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

COMMENT ON COLUMN public.school_team_reports.edited_by IS
  'Staff member who last corrected this row in the app. Null when only the family has written it.';
