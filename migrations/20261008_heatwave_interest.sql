-- Heatwave Volleyball (heatwaveatx.com) interest list. The public site's
-- /api/interest function inserts with the service role; HQ (signed-in users)
-- reads and updates it on the Heatwave screen's Interest tab.
-- Run: node scripts/run-sql.mjs migrations/20261008_heatwave_interest.sql

CREATE TABLE IF NOT EXISTS public.heatwave_interest (
  id           BIGSERIAL PRIMARY KEY,
  role         TEXT NOT NULL,          -- parent | player | director
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  phone        TEXT,
  player_name  TEXT,
  grad_year    TEXT,
  club         TEXT,                   -- club and team
  level        TEXT,                   -- national | bubble | regional | other
  sessions     TEXT[] NOT NULL DEFAULT '{}',   -- setting | hitting | defense | all_skills
  city         TEXT,
  heard_from   TEXT,
  message      TEXT,
  ok_text      BOOLEAN NOT NULL DEFAULT FALSE,
  status       TEXT NOT NULL DEFAULT 'new',     -- new | contacted | applied | not a fit
  notes        TEXT,
  source       TEXT,                   -- utm / referrer
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS heatwave_interest_created_idx ON public.heatwave_interest (created_at DESC);

ALTER TABLE public.heatwave_interest ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_heatwave_interest" ON public.heatwave_interest;
CREATE POLICY "auth_all_heatwave_interest" ON public.heatwave_interest FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
GRANT ALL ON public.heatwave_interest TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.heatwave_interest_id_seq TO authenticated, service_role;
