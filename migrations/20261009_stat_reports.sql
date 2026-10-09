-- Performance testing report emails (Coach Brandon, Oct 2026).
--   stat_report_settings  one 'main' row: Brandon's template (intro, Reach pitch, link, sign-off)
--   stat_report_drafts    per player: which metrics to show, what she worked on, a personal note
--   stat_report_sends     log of every report sent
-- Run: node scripts/run-sql.mjs migrations/20261009_stat_reports.sql

CREATE TABLE IF NOT EXISTS public.stat_report_settings (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.stat_report_drafts (
  player_id   BIGINT PRIMARY KEY,
  metrics     TEXT[],                 -- null/empty = every metric on file
  worked_on   TEXT,
  note        TEXT,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.stat_report_sends (
  id          BIGSERIAL PRIMARY KEY,
  player_id   BIGINT NOT NULL,
  recipients  TEXT[] NOT NULL DEFAULT '{}',
  subject     TEXT,
  body        TEXT,
  test        BOOLEAN NOT NULL DEFAULT FALSE,
  sent_by     TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS stat_report_sends_player_idx ON public.stat_report_sends (player_id, sent_at DESC);

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['stat_report_settings','stat_report_drafts','stat_report_sends'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "auth_all_%s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "auth_all_%s" ON public.%I FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)', t, t);
    EXECUTE format('GRANT ALL ON public.%I TO authenticated, service_role', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE public.stat_report_sends_id_seq TO authenticated, service_role;
INSERT INTO public.stat_report_settings (id, data) VALUES ('main', '{}'::jsonb) ON CONFLICT (id) DO NOTHING;
