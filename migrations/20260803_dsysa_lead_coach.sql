-- 20260803 — Lead coach per DSYSA clinic.
--
-- The lead is one of the coaches actually attending, so it's a flag on the
-- sign-up rather than a name on the clinic. If they drop out their row goes and
-- the lead goes with it, instead of the clinic keeping a lead who isn't coming.
--
-- Partial unique index enforces one lead per date — the UI clears the old lead
-- before setting a new one, and this stops two ever sticking if that ordering
-- is ever got wrong.
--
-- Run: node scripts/run-sql.mjs migrations/20260803_dsysa_lead_coach.sql
-- Additive and idempotent.

ALTER TABLE public.dsysa_signups ADD COLUMN IF NOT EXISTS is_lead boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS dsysa_one_lead_per_clinic
  ON public.dsysa_signups (clinic_id) WHERE is_lead;

COMMENT ON COLUMN public.dsysa_signups.is_lead IS
  'This coach runs the session. One per clinic, enforced by dsysa_one_lead_per_clinic.';
