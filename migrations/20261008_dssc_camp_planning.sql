-- DSSC summer "Destination Training" planning workbook (Oct 2026).
--   dssc_camp_plan      one row ('main'): program write-up, economics assumptions, launch checklist (jsonb)
--   dssc_camp_sessions  the 8 sessions on the site — dates, days, price, cap, lead coach
--   dssc_camp_coaches   star-coach prospects — skills, status, availability, rate, travel
-- Same access as the other DSSC tables: any signed-in HQ user (the screen is director-only).
-- Run: node scripts/run-sql.mjs migrations/20261008_dssc_camp_planning.sql

CREATE TABLE IF NOT EXISTS public.dssc_camp_plan (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT
);

CREATE TABLE IF NOT EXISTS public.dssc_camp_coaches (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  title         TEXT,                 -- "Head Coach, Texas State" / "Assistant, Baylor"
  skills        TEXT[] NOT NULL DEFAULT '{}',   -- hitting | defense | setting | all_skills
  status        TEXT NOT NULL DEFAULT 'idea',   -- idea | contacted | interested | confirmed | declined
  email         TEXT,
  phone         TEXT,
  from_city     TEXT,                 -- where they fly from (travel estimate)
  day_rate      INTEGER NOT NULL DEFAULT 1000,
  travel_est    INTEGER,              -- dollars per session, null = use the default estimate
  availability  TEXT,                 -- free-text: "Free Jul 12-24; camp of her own Jul 26"
  connection    TEXT,                 -- who knows them / how we reach them
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.dssc_camp_sessions (
  id             BIGSERIAL PRIMARY KEY,
  sort           INTEGER NOT NULL DEFAULT 0,
  name           TEXT NOT NULL,
  focus          TEXT NOT NULL,        -- all_skills | hitting | defense | setting
  ages           TEXT,                 -- "14-16" / "11-12"
  start_date     DATE,
  days           INTEGER NOT NULL DEFAULT 3,
  price_per_day  INTEGER NOT NULL DEFAULT 700,
  cap            INTEGER NOT NULL DEFAULT 14,
  expected       INTEGER,              -- planning enrollment, null = cap
  lead_coach_id  BIGINT REFERENCES public.dssc_camp_coaches(id) ON DELETE SET NULL,
  assistants     TEXT,                 -- DS Elite / DSSC staff, free text
  status         TEXT NOT NULL DEFAULT 'tentative',  -- tentative | confirmed | open | full | cancelled
  notes          TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['dssc_camp_plan','dssc_camp_coaches','dssc_camp_sessions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "auth_all_%s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "auth_all_%s" ON public.%I FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)', t, t);
    EXECUTE format('GRANT ALL ON public.%I TO authenticated, service_role', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE public.dssc_camp_coaches_id_seq, public.dssc_camp_sessions_id_seq TO authenticated, service_role;

-- The 8 sessions on the site. Dates are a starting point: they sit after USAV 16s/17s
-- Nationals (ends Jul 5) and before Texas high-school volleyball starts in August.
INSERT INTO public.dssc_camp_sessions (sort, name, focus, ages, start_date, days, price_per_day, cap)
SELECT * FROM (VALUES
  (1, 'Hitting Intensive I',        'hitting',    '14-16', DATE '2027-07-12', 3, 700, 14),
  (2, '11/12 All Skills I',         'all_skills', '11-12', DATE '2027-07-15', 2, 600, 14),
  (3, 'Libero & Defense Intensive I','defense',   '14-16', DATE '2027-07-19', 3, 700, 14),
  (4, 'Setting Intensive I',        'setting',    '14-16', DATE '2027-07-22', 3, 700, 14),
  (5, 'Hitting Intensive II',       'hitting',    '14-16', DATE '2027-07-26', 3, 700, 14),
  (6, '11/12 All Skills II',        'all_skills', '11-12', DATE '2027-07-29', 2, 600, 14),
  (7, 'Libero & Defense Intensive II','defense',  '14-16', DATE '2027-06-07', 3, 700, 14),
  (8, 'Setting Intensive II',       'setting',    '14-16', DATE '2027-06-01', 3, 700, 14)
) v(sort, name, focus, ages, start_date, days, price_per_day, cap)
WHERE NOT EXISTS (SELECT 1 FROM public.dssc_camp_sessions);

INSERT INTO public.dssc_camp_plan (id, data) VALUES ('main', '{}'::jsonb) ON CONFLICT (id) DO NOTHING;
