-- DSSC Program Workbook (Drew, Oct 13 2026): Hunter turns the generic blocks
-- on the 2027 Planning Calendar ("Volleyball Clinic", Mon 5-6pm, Court 1,
-- Jan 4 - May 3) into real programs - title, session length, sessions, price.
-- One row per titled program. It covers the plan bookings that match its
-- court, weekday, start, length and generic program between date_from and
-- date_to; it is kept apart from dssc_plan_bookings so re-importing the
-- workbook (scripts/import-dssc-plan.mjs) never wipes Hunter's titles.
--   start_slot / slots: half hours, same as dssc_plan_bookings
--   status: idea | planned | ready | published
-- Run: node scripts/run-sql.mjs migrations/20261013_dssc_plan_programs.sql
CREATE TABLE IF NOT EXISTS public.dssc_plan_programs (
  id              BIGSERIAL PRIMARY KEY,
  plan            TEXT NOT NULL DEFAULT '2027',
  program         TEXT NOT NULL,            -- the generic block it fills
  court           TEXT NOT NULL CHECK (court IN ('C1','C2','C3','C4','C5','C6','FLEX')),
  weekday         INT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_slot      INT NOT NULL CHECK (start_slot BETWEEN 0 AND 47),
  slots           INT NOT NULL CHECK (slots BETWEEN 1 AND 48),
  date_from       DATE NOT NULL,
  date_to         DATE NOT NULL,
  title           TEXT,
  session_minutes INT,
  sessions        INT,
  price           NUMERIC(10,2),
  price_per       TEXT,                     -- program | session | month
  age_group       TEXT,
  level           TEXT,
  capacity        INT,
  coach           TEXT,
  status          TEXT NOT NULL DEFAULT 'idea',
  notes           TEXT,
  updated_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dssc_plan_programs_plan_idx ON public.dssc_plan_programs (plan, court, weekday, start_slot);
ALTER TABLE public.dssc_plan_programs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_dssc_plan_programs" ON public.dssc_plan_programs;
CREATE POLICY "auth_all_dssc_plan_programs" ON public.dssc_plan_programs FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
GRANT ALL ON public.dssc_plan_programs TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.dssc_plan_programs_id_seq TO authenticated, service_role;
SELECT 'ok' AS done;
