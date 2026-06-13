-- Migration: practice schedule (teams + assignments)
-- Date: 2026-06-12
--
-- Two tables drive the new Practice tab:
--   practice_teams       — one row per club team with level/coach info
--   practice_assignments — one row per (team, day, slot) the team practices
--
-- Constraints lived in the UI rather than the schema so coaches can flex
-- a rule when they need to (e.g. moving a U12 into a 7pm slot for one
-- week to cover a tournament). The UI shows warnings, doesn't block.

CREATE TABLE IF NOT EXISTS public.practice_teams (
  team_name           TEXT PRIMARY KEY,
  level               TEXT,
  head_coach          TEXT,
  assistant_coach     TEXT,
  age_div             TEXT,
  practices_per_week  INT NOT NULL DEFAULT 2,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.practice_assignments (
  id          BIGSERIAL PRIMARY KEY,
  team_name   TEXT NOT NULL,
  day         TEXT NOT NULL,
  slot        TEXT NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_name, day, slot)
);

CREATE INDEX IF NOT EXISTS practice_assignments_team_idx
  ON public.practice_assignments(team_name);
CREATE INDEX IF NOT EXISTS practice_assignments_slot_idx
  ON public.practice_assignments(day, slot);

-- RLS — same pattern as other tables (authenticated users full access)
ALTER TABLE public.practice_teams       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_pteams"      ON public.practice_teams;
DROP POLICY IF EXISTS "auth_modify_pteams"      ON public.practice_teams;
DROP POLICY IF EXISTS "auth_select_pa"          ON public.practice_assignments;
DROP POLICY IF EXISTS "auth_modify_pa"          ON public.practice_assignments;

CREATE POLICY "auth_select_pteams" ON public.practice_teams
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_modify_pteams" ON public.practice_teams
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth_select_pa" ON public.practice_assignments
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_modify_pa" ON public.practice_assignments
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Realtime
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='practice_teams') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.practice_teams;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='practice_assignments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.practice_assignments;
  END IF;
END $$;

-- Seed teams from the workbook the user provided. Coach blanks left NULL.
INSERT INTO public.practice_teams (team_name, level, head_coach, assistant_coach, age_div, practices_per_week) VALUES
('17 Diamond',  'National',      'Kelli Hardge',  'Jessica Cantu', 'U17', 3),
('16 Ruby',     'Regional',      'Tara',           NULL,           'U16', 2),
('16 Diamond',  'National',      'Ambria',         NULL,           'U16', 3),
('15 Sapphire', 'Regional',      'Mikayla',       'Shellie',       'U15', 2),
('15 Ruby',     'National',      'Chang',         'Matt Mercier',  'U15', 3),
('15 Diamond',  'National',      'Hunter',        'Bree',          'U15', 3),
('15 Emerald',  'Regional',       NULL,            NULL,           'U15', 2),
('14 Sapphire', 'Regional',      'Ambria',        'Mia',           'U14', 2),
('14 Ruby',     'National',      'Jayden',        'Rene',          'U14', 3),
('14 Emerald',  'Regional',      'Mikayla',       'Ella',          'U14', 2),
('14 Diamond',  'National',      'Drew',          'Kristen',       'U14', 3),
('14 Topaz',    'Regional',       NULL,            NULL,           'U14', 2),
('13 Ruby',     'Regional',      'Bree',          'Sam M.',        'U13', 2),
('13 Sapphire', 'Regional',      'David Stanley',  NULL,           'U13', 2),
('13 Diamond',  'National',      'Sam R.',        'Jayden',        'U13', 3),
('13 Rise',     'Developmental',  NULL,            NULL,           'U13', 2),
('12 Ruby',     'Regional',      'Jason',          NULL,           'U12', 2),
('12 Rise 2',   'Developmental',  NULL,           'Shellie',       'U12', 2),
('12 Rise 1',   'Developmental', 'Rob',           'Mia',           'U12', 2),
('12 Diamond',  'National',      'Tara',           NULL,           'U12', 3),
('11 Rise',     'Developmental', 'Lindsey',       'Rob',           'U11', 2),
('11 Diamond',  'Regional',      'Brandon',       'Ella',          'U11', 2)
ON CONFLICT (team_name) DO UPDATE SET
  level              = EXCLUDED.level,
  head_coach         = EXCLUDED.head_coach,
  assistant_coach    = EXCLUDED.assistant_coach,
  age_div            = EXCLUDED.age_div,
  practices_per_week = EXCLUDED.practices_per_week,
  updated_at         = NOW();

-- Seed current schedule from the user's grid. Days are Sun/Mon/Wed/Thu,
-- slots are the time-range strings shown in the UI.
INSERT INTO public.practice_assignments (team_name, day, slot) VALUES
  ('16 Ruby',     'Sun', '6-8pm'),
  ('16 Ruby',     'Wed', '7-9pm'),
  ('16 Diamond',  'Sun', '6-8pm'),
  ('16 Diamond',  'Mon', '7-9pm'),
  ('16 Diamond',  'Thu', '7-9pm'),
  ('15 Sapphire', 'Sun', '6-8pm'),
  ('15 Sapphire', 'Wed', '7-9pm'),
  ('15 Ruby',     'Sun', '6-8pm'),
  ('15 Ruby',     'Mon', '7-9pm'),
  ('15 Ruby',     'Thu', '7-9pm'),
  ('15 Diamond',  'Sun', '6-8pm'),
  ('15 Diamond',  'Mon', '7-9pm'),
  ('15 Diamond',  'Thu', '7-9pm'),
  ('15 Emerald',  'Sun', '6-8pm'),
  ('15 Emerald',  'Wed', '7-9pm'),
  ('14 Sapphire', 'Sun', '4-6pm'),
  ('14 Sapphire', 'Wed', '7-9pm'),
  ('14 Ruby',     'Sun', '4-6pm'),
  ('14 Ruby',     'Thu', '5-7pm'),
  ('14 Ruby',     'Thu', '7-9pm'),
  ('14 Emerald',  'Sun', '4-6pm'),
  ('14 Emerald',  'Thu', '7-9pm'),
  ('14 Diamond',  'Sun', '4-6pm'),
  ('14 Diamond',  'Mon', '5-7pm'),
  ('14 Diamond',  'Thu', '7-9pm'),
  ('13 Ruby',     'Sun', '4-6pm'),
  ('13 Ruby',     'Mon', '5-7pm'),
  ('13 Rise',     'Sun', '4-6pm'),
  ('13 Rise',     'Mon', '5-7pm'),
  ('13 Diamond',  'Sun', '2-4pm'),
  ('13 Diamond',  'Mon', '5-7pm'),
  ('13 Diamond',  'Thu', '5-7pm'),
  ('13 Sapphire', 'Sun', '2-4pm'),
  ('13 Sapphire', 'Thu', '5-7pm'),
  ('12 Ruby',     'Sun', '2-4pm'),
  ('12 Ruby',     'Mon', '5-7pm'),
  ('12 Rise 1',   'Sun', '12-2pm'),
  ('12 Rise 1',   'Wed', '5-7pm'),
  ('12 Diamond',  'Sun', '2-4pm'),
  ('12 Diamond',  'Thu', '5-7pm'),
  ('12 Rise 2',   'Sun', '12-2pm'),
  ('12 Rise 2',   'Wed', '5-7pm'),
  ('11 Rise',     'Sun', '12-2pm'),
  ('11 Rise',     'Wed', '5-7pm'),
  ('11 Diamond',  'Sun', '12-2pm'),
  ('11 Diamond',  'Wed', '5-7pm')
ON CONFLICT (team_name, day, slot) DO NOTHING;
