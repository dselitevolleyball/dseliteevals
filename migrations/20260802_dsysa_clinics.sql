-- 20260802 — DSYSA clinic help: dates, and which coaches are covering each.
--
-- Monday evenings at Dripping Springs Middle School, 3rd-6th grade, 90 minutes
-- run as a tournament. DS Elite gear on. It's brand exposure and a recruiting
-- channel for the 11s and 12s, which are still filling.
--
-- Needs 4-6 coaches per date. Times are tentative (usually 6-8pm), hence text
-- rather than a time type — a firm-looking 18:00 would imply more certainty
-- than exists.
--
-- Run: node scripts/run-sql.mjs migrations/20260802_dsysa_clinics.sql
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.dsysa_clinics (
  id           BIGSERIAL   PRIMARY KEY,
  clinic_date  DATE        NOT NULL UNIQUE,
  start_time   TEXT        DEFAULT '18:00',
  end_time     TEXT        DEFAULT '20:00',
  time_tbc     BOOLEAN     NOT NULL DEFAULT true,   -- usually 6-8, not confirmed
  location     TEXT        DEFAULT 'Dripping Springs Middle School',
  min_coaches  INTEGER     NOT NULL DEFAULT 4,
  max_coaches  INTEGER     NOT NULL DEFAULT 6,
  cancelled    BOOLEAN     NOT NULL DEFAULT false,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.dsysa_signups (
  id          BIGSERIAL   PRIMARY KEY,
  clinic_id   BIGINT      NOT NULL REFERENCES public.dsysa_clinics(id) ON DELETE CASCADE,
  coach_name  TEXT        NOT NULL,
  signed_by   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, coach_name)
);
CREATE INDEX IF NOT EXISTS dsysa_signups_clinic_idx ON public.dsysa_signups (clinic_id);

INSERT INTO public.dsysa_clinics (clinic_date) VALUES
  ('2026-08-24'), ('2026-08-31'), ('2026-09-07'), ('2026-09-14'),
  ('2026-09-21'), ('2026-09-28'), ('2026-10-05'), ('2026-10-19')
ON CONFLICT (clinic_date) DO NOTHING;

ALTER TABLE public.dsysa_clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dsysa_signups ENABLE ROW LEVEL SECURITY;

-- Any approved coach sees the schedule; only admins change the dates.
DROP POLICY IF EXISTS dsysa_clinics_read ON public.dsysa_clinics;
CREATE POLICY dsysa_clinics_read ON public.dsysa_clinics FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));
DROP POLICY IF EXISTS dsysa_clinics_admin ON public.dsysa_clinics;
CREATE POLICY dsysa_clinics_admin ON public.dsysa_clinics FOR ALL
  USING (public.is_admin_coach()) WITH CHECK (public.is_admin_coach());

-- Everyone sees who's covering. A coach adds or removes only themselves;
-- admins can sign anyone up or take them off.
DROP POLICY IF EXISTS dsysa_signups_read ON public.dsysa_signups;
CREATE POLICY dsysa_signups_read ON public.dsysa_signups FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));
DROP POLICY IF EXISTS dsysa_signups_admin ON public.dsysa_signups;
CREATE POLICY dsysa_signups_admin ON public.dsysa_signups FOR ALL
  USING (public.is_admin_coach()) WITH CHECK (public.is_admin_coach());
DROP POLICY IF EXISTS dsysa_signups_self ON public.dsysa_signups;
CREATE POLICY dsysa_signups_self ON public.dsysa_signups FOR ALL
  USING (public.is_me_coach(coach_name)) WITH CHECK (public.is_me_coach(coach_name));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='dsysa_signups') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dsysa_signups;
  END IF;
END $$;
