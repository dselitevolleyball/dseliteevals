-- DSSC hours confirmation to coaches (api/timecard-summary.js?club=dssc) is stamped on its own column;
-- sent_at means "went to the accountant" and must not double as "coach was told".
ALTER TABLE public.dssc_checkins ADD COLUMN IF NOT EXISTS coach_notified_at timestamptz;
