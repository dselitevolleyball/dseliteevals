-- Work Duty: who works which job when the team has to work a match at a
-- tournament (Drew, Oct 9 2026). Per team, fair across the whole season.
--   work_duty_settings  per team: work matches per tournament day, sets per match, computer scorer on/off
--   work_duty_matches   one row per work match: date, tournament, assignments (jsonb), done or not
-- assignments = { book: playerId, libero: playerId, sets: [{ lj1, lj2, flip, comp }], out: [playerId] }
-- Run: node scripts/run-sql.mjs migrations/20261009_work_duty.sql

CREATE TABLE IF NOT EXISTS public.work_duty_settings (
  team_name        TEXT PRIMARY KEY,
  matches_per_day  INTEGER NOT NULL DEFAULT 1,
  sets             INTEGER NOT NULL DEFAULT 3,
  computer         BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by       TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.work_duty_matches (
  id             BIGSERIAL PRIMARY KEY,
  team_name      TEXT NOT NULL,
  tournament_id  BIGINT,
  match_date     DATE NOT NULL,
  seq            INTEGER NOT NULL DEFAULT 1,      -- 1st / 2nd work match that day
  assignments    JSONB NOT NULL DEFAULT '{}'::jsonb,
  done           BOOLEAN NOT NULL DEFAULT FALSE,
  done_at        TIMESTAMPTZ,
  done_by        TEXT,
  updated_by     TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS work_duty_matches_team_idx ON public.work_duty_matches (team_name, match_date, seq);

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['work_duty_settings','work_duty_matches'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "auth_all_%s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "auth_all_%s" ON public.%I FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)', t, t);
    EXECUTE format('GRANT ALL ON public.%I TO authenticated, service_role', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE public.work_duty_matches_id_seq TO authenticated, service_role;
