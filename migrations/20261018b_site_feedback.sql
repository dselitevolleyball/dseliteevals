-- Website feedback pop-up (Drew, Oct 18 2026: "thank you for visiting our website! We would love your
-- feedback on navigation and areas that could use some help, and also a quick rating system").
-- One row per submission from dselitevolleyball.com via POST /api/site-feedback; read in HQ → Website → Feedback.
-- Run: node scripts/run-sql.mjs migrations/20261018b_site_feedback.sql
CREATE TABLE IF NOT EXISTS public.site_feedback (
  id          BIGSERIAL PRIMARY KEY,
  rating      INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  navigation  TEXT,                 -- "Was anything hard to find?"
  needs_help  TEXT,                 -- "What could use some help?"
  page        TEXT,                 -- path the visitor was on
  ip          TEXT,
  is_test     BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS site_feedback_created_idx ON public.site_feedback (created_at DESC);
ALTER TABLE public.site_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_feedback_admin_read ON public.site_feedback;
CREATE POLICY site_feedback_admin_read ON public.site_feedback FOR SELECT USING (public.is_admin_coach());
DROP POLICY IF EXISTS site_feedback_admin_update ON public.site_feedback;
CREATE POLICY site_feedback_admin_update ON public.site_feedback FOR UPDATE USING (public.is_admin_coach()) WITH CHECK (public.is_admin_coach());
GRANT SELECT, UPDATE ON public.site_feedback TO authenticated;
GRANT ALL ON public.site_feedback TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.site_feedback_id_seq TO service_role;
SELECT 'ok' AS done;
