-- Staff decisions on "Check these numbers" flags (Drew, Oct 12 2026: "for
-- numbers that seem off I need a way to accept or ignore").
--   accept = the number is right: it stops being a flag and goes in her email
--   ignore = stop showing it: the number stays out of her email
-- flag_id is shared/stat-report.js flagId(): metric, result, rule and the
-- number itself, so fixing or retyping the number makes a new flag.
-- Run: node scripts/run-sql.mjs migrations/20261012_stat_flag_reviews.sql
CREATE TABLE IF NOT EXISTS public.stat_flag_reviews (
  player_id   BIGINT NOT NULL,
  flag_id     TEXT NOT NULL,
  decision    TEXT NOT NULL CHECK (decision IN ('accept', 'ignore')),
  decided_by  TEXT,
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id, flag_id)
);
ALTER TABLE public.stat_flag_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_stat_flag_reviews" ON public.stat_flag_reviews;
CREATE POLICY "auth_all_stat_flag_reviews" ON public.stat_flag_reviews FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
GRANT ALL ON public.stat_flag_reviews TO authenticated, service_role;
SELECT 'ok' AS done;
