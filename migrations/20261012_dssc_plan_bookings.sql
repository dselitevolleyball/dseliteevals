-- DSSC Planning Calendar (Drew, Oct 12 2026): his 2027 planning workbook
-- ("Warehouse I, and II.xlsx", sheet "2027 Detailed Yearly Schedule") on a
-- court-by-court calendar, so Hunter can see what's planned, what's open and
-- plan into the gaps. One row per court per booking.
--   court       C1-C4 Warehouse I · C5-C6 Warehouse II · FLEX
--   start_slot  half hours since midnight (14 = 7:00am); slots = length in half hours
--   source      'workbook' (scripts/import-dssc-plan.mjs replaces these) | 'app' (added on the calendar, kept on re-import)
-- Run: node scripts/run-sql.mjs migrations/20261012_dssc_plan_bookings.sql
CREATE TABLE IF NOT EXISTS public.dssc_plan_bookings (
  id          BIGSERIAL PRIMARY KEY,
  plan        TEXT NOT NULL DEFAULT '2027',
  date        DATE NOT NULL,
  court       TEXT NOT NULL CHECK (court IN ('C1','C2','C3','C4','C5','C6','FLEX')),
  start_slot  INT NOT NULL CHECK (start_slot BETWEEN 0 AND 47),
  slots       INT NOT NULL CHECK (slots BETWEEN 1 AND 48),
  program     TEXT NOT NULL,
  label       TEXT,
  note        TEXT,
  source      TEXT NOT NULL DEFAULT 'app',
  series      TEXT,                     -- bookings added together (weekly repeat, several courts)
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dssc_plan_bookings_date_idx ON public.dssc_plan_bookings (plan, date);
ALTER TABLE public.dssc_plan_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_dssc_plan_bookings" ON public.dssc_plan_bookings;
CREATE POLICY "auth_all_dssc_plan_bookings" ON public.dssc_plan_bookings FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
GRANT ALL ON public.dssc_plan_bookings TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.dssc_plan_bookings_id_seq TO authenticated, service_role;
SELECT 'ok' AS done;
