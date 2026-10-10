-- Scrimmages on the Practice > Daily board (Drew, Oct 10 2026): on a given
-- date and practice block, which teams scrimmage each other and which court
-- they share.
-- Run: node scripts/run-sql.mjs migrations/20261010_practice_scrimmages.sql

CREATE TABLE IF NOT EXISTS public.practice_scrimmages (
  id             BIGSERIAL PRIMARY KEY,
  practice_date  DATE NOT NULL,
  slot           TEXT NOT NULL,          -- the board block, e.g. "5-7pm" or "3-4pm"
  teams          TEXT[] NOT NULL,        -- 2+ team names
  court          TEXT,                   -- shared court, e.g. "2"
  notes          TEXT,
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS practice_scrimmages_date_idx ON public.practice_scrimmages (practice_date);

ALTER TABLE public.practice_scrimmages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_practice_scrimmages" ON public.practice_scrimmages;
CREATE POLICY "auth_all_practice_scrimmages" ON public.practice_scrimmages FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
GRANT ALL ON public.practice_scrimmages TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.practice_scrimmages_id_seq TO authenticated, service_role;
