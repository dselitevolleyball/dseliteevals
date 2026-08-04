-- Migration: DSSC clinic staffing — capacity, shift pickup with approval,
-- who is cleared to LEAD, and an approval gate on the hours that go to the
-- accountant. Date: 2026-08-04  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260804_dssc_staffing.sql
--
-- Session staffing itself lives in the existing dssc_clinics.sessions jsonb, as
-- a `staff` array on each session:
--   { id, date, court, start_time, end_time,
--     coaches_needed: 2,
--     coach_name: "…",                     -- kept: the approved LEAD, mirrored
--     staff: [ { name, email, role:'lead'|'assist',
--                status:'pending'|'approved'|'declined', by, at, picked } ] }
-- No backfill: the app reads `staff` when present and otherwise synthesises it
-- from the existing coach_name, so the 31 sessions already assigned keep
-- working and only gain a staff array the first time one is edited.

-- Who is cleared to run a clinic on their own. Not every coach is ready to
-- lead, which is the whole reason a pickup needs approving.
ALTER TABLE public.dssc_availability ADD COLUMN IF NOT EXISTS can_lead BOOLEAN NOT NULL DEFAULT false;

-- Default headcount for a clinic's sessions. A session may override it.
ALTER TABLE public.dssc_clinics ADD COLUMN IF NOT EXISTS coaches_needed INT NOT NULL DEFAULT 1;

-- Hours are approved before they leave for the accountant. Existing rows are
-- treated as approved: they were entered under the old flow, where clocking in
-- WAS the approval, and defaulting them to false would silently withhold pay
-- for work already done.
ALTER TABLE public.dssc_checkins ADD COLUMN IF NOT EXISTS approved     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.dssc_checkins ADD COLUMN IF NOT EXISTS approved_by  TEXT;
ALTER TABLE public.dssc_checkins ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ;
ALTER TABLE public.dssc_checkins ADD COLUMN IF NOT EXISTS rejected     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.dssc_checkins ADD COLUMN IF NOT EXISTS reject_note  TEXT;
ALTER TABLE public.dssc_checkins ADD COLUMN IF NOT EXISTS sent_at      TIMESTAMPTZ;   -- went to the accountant

UPDATE public.dssc_checkins
   SET approved = true, approved_by = 'pre-approval flow', approved_at = created_at
 WHERE approved = false AND rejected = false AND created_at < NOW();

CREATE INDEX IF NOT EXISTS dssc_checkins_approved_idx ON public.dssc_checkins(approved, session_date);
