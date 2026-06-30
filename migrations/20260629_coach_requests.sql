-- 20260629 — Coach time-off / availability requests.
--
-- Two kinds:
--   'weekend'  — black out a weekend for tournament scheduling
--   'practice' — request off a specific practice (needs coverage from another coach)
--
-- Run once in the Supabase SQL editor. Additive, non-destructive, idempotent.

CREATE TABLE IF NOT EXISTS public.coach_requests (
  id           BIGSERIAL    PRIMARY KEY,
  coach_name   TEXT,
  coach_email  TEXT,
  type         TEXT         NOT NULL,                 -- 'weekend' | 'practice'
  request_date DATE,
  team_name    TEXT,                                  -- for practice requests
  details      TEXT         NOT NULL DEFAULT '',
  status       TEXT         NOT NULL DEFAULT 'pending', -- pending | approved | denied
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  resolved_by  TEXT,
  resolved_at  TIMESTAMPTZ
);
ALTER TABLE public.coach_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coach_requests_all_approved ON public.coach_requests;
CREATE POLICY coach_requests_all_approved ON public.coach_requests
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));
CREATE INDEX IF NOT EXISTS coach_requests_created_idx ON public.coach_requests (created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='coach_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.coach_requests;
  END IF;
END $$;
