-- Reach Performance stats (Drew, Oct 23 2026): Coach Brandon adds athletes who
-- aren't DS Elite players (boys, other sports, other clubs) and records their
-- testing by date in HQ; every result feeds the public Reach board
-- (www.drippingsportsclub.com/reach). Sprint top speed (mph) joins the tests
-- for everyone, DS Elite included, and staff can add more tests later.
--
--   players.sprint_mph                 a DS Elite tryout/baseline sprint speed (mph)
--   player_stat_tests.sprint_mph       a retest's sprint speed (mph)
--   player_stat_tests.extra            { <stat_metrics.key>: number } - tests added in HQ
--   reach_athletes                     Reach athletes who aren't DS Elite players
--   reach_athlete_tests                their results, one row per athlete per test date
--   stat_metrics                       tests added in HQ (label, unit, which way is better)
--
-- Units: inches for heights and the broad jump, seconds for the 10-yard,
-- mph for sprint speed. Read and written by api/reach-stats.js (service role);
-- RLS lets the DSSC directors at them directly too.
-- Additive and idempotent:  node scripts/run-sql.mjs migrations/20261028_reach_stats.sql

ALTER TABLE public.players           ADD COLUMN IF NOT EXISTS sprint_mph numeric;
ALTER TABLE public.player_stat_tests ADD COLUMN IF NOT EXISTS sprint_mph numeric;
ALTER TABLE public.player_stat_tests ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.reach_athletes (
  id            bigserial   PRIMARY KEY,
  first_name    text        NOT NULL,
  last_name     text        NOT NULL DEFAULT '',
  gender        text        CHECK (gender IN ('F', 'M')),
  dob           date,
  grad_year     int,
  sport         text,                                   -- their main sport
  team          text,                                   -- school or club team
  parent_name   text,
  parent_email  text,
  parent_phone  text,
  notes         text,
  public        boolean     NOT NULL DEFAULT true,      -- on the public board (first name + last initial)
  active        boolean     NOT NULL DEFAULT true,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reach_athletes_name_idx ON public.reach_athletes (lower(last_name), lower(first_name));

CREATE TABLE IF NOT EXISTS public.reach_athlete_tests (
  id              bigserial   PRIMARY KEY,
  athlete_id      bigint      NOT NULL REFERENCES public.reach_athletes(id) ON DELETE CASCADE,
  test_date       date        NOT NULL,
  stand_reach     numeric,
  approach_touch  numeric,
  standing_touch  numeric,
  vertical        numeric,
  broad_jump      numeric,
  dash_10y        numeric,
  sprint_mph      numeric,
  extra           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  notes           text,
  recorded_by     text,
  source          text        NOT NULL DEFAULT 'hq',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, test_date)
);
CREATE INDEX IF NOT EXISTS reach_athlete_tests_athlete_idx ON public.reach_athlete_tests (athlete_id, test_date);

CREATE TABLE IF NOT EXISTS public.stat_metrics (
  key            text        PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label          text        NOT NULL,
  unit           text        NOT NULL DEFAULT '',     -- in, sec, mph, lb, reps, ...
  higher_better  boolean     NOT NULL DEFAULT true,
  on_board       boolean     NOT NULL DEFAULT true,   -- ranked on the public board
  active         boolean     NOT NULL DEFAULT true,
  sort           int         NOT NULL DEFAULT 100,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reach_athletes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reach_athlete_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stat_metrics        ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['reach_athletes', 'reach_athlete_tests'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_director_all', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_dssc_director()) WITH CHECK (public.is_dssc_director())', t || '_director_all', t);
  END LOOP;
END $$;
-- Every screen that shows testing needs the list of tests; only directors change it.
DROP POLICY IF EXISTS stat_metrics_read ON public.stat_metrics;
CREATE POLICY stat_metrics_read ON public.stat_metrics FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS stat_metrics_director_write ON public.stat_metrics;
CREATE POLICY stat_metrics_director_write ON public.stat_metrics FOR ALL TO authenticated USING (public.is_dssc_director()) WITH CHECK (public.is_dssc_director());
