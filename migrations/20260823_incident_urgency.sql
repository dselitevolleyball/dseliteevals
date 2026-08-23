-- 20260823 — Is this an emergency, or a log?
--
-- Every report currently arrives at the same volume, which means the directors
-- either treat all of them as urgent or none of them. A coach standing on a
-- court with a hurt kid and a coach writing up a playing-time conversation are
-- doing very different things and need different responses.
--
-- 'log' is the default on purpose: the common case should be the one you get by
-- doing nothing, and an emergency should take a deliberate click.
--
-- Run: node scripts/run-sql.mjs migrations/20260823_incident_urgency.sql
-- Additive and idempotent.

ALTER TABLE public.player_incidents
  ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'log';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'player_incidents_urgency_chk') THEN
    ALTER TABLE public.player_incidents ADD CONSTRAINT player_incidents_urgency_chk
      CHECK (urgency IN ('emergency','log'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS player_incidents_urgent_idx
  ON public.player_incidents (urgency, status) WHERE urgency = 'emergency';

COMMENT ON COLUMN public.player_incidents.urgency IS
  'emergency = needs a director now; log = on the record, handle in the normal course.';
