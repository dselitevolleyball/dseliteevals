-- Sunday courts are set week by week (Drew, Oct 26 2026: "for Sundays I need
-- to set courts on a weekly basis"). One row = a team's court on one date. The
-- Daily view's court picker writes here on Sundays; the court chart and the day
-- schedule read it ahead of the move's court and the usual weekly court.
-- Run: node scripts/run-sql.mjs migrations/20261103_practice_date_courts.sql
CREATE TABLE IF NOT EXISTS public.practice_date_courts (
  practice_date date        NOT NULL,
  team_name     text        NOT NULL,
  court         int         NOT NULL CHECK (court BETWEEN 1 AND 6),
  set_by        text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (practice_date, team_name)
);
ALTER TABLE public.practice_date_courts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_date_courts_all_approved ON public.practice_date_courts;
CREATE POLICY practice_date_courts_all_approved ON public.practice_date_courts
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));
GRANT ALL ON public.practice_date_courts TO authenticated, service_role;
SELECT 'ok' AS done;
