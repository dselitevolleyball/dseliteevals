-- Migration: what we have to have from a coach before booking travel.
-- Date: 2026-08-04  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260804_travel_confirmations.sql
--
-- Two separate things, deliberately kept apart:
--   * legal_name is per PERSON — the name on the government ID, which has to
--     match the ticket. It is NOT display_name: "Bre Coward" books a flight
--     that "Breanna Coward" cannot board.
--   * travel_mode is per TRIP — the same coach can fly to Honolulu and drive to
--     Oklahoma City, so the answer cannot live on the roster row.

ALTER TABLE public.coach_roster ADD COLUMN IF NOT EXISTS legal_name              text;
ALTER TABLE public.coach_roster ADD COLUMN IF NOT EXISTS legal_name_confirmed_at timestamptz;
COMMENT ON COLUMN public.coach_roster.legal_name IS
  'Full name exactly as it appears on the government ID used to fly. Must match the ticket.';
COMMENT ON COLUMN public.coach_roster.legal_name_confirmed_at IS
  'When the coach themselves confirmed it. NULL means nobody has verified it — do not book.';

-- travel_mode:
--   fly_club  — club books the ticket (the default expectation)
--   drive     — driving instead; reimbursed per mile at the IRS standard rate
--   fly_own   — booking their own flight; reimbursed up to what the club paid
--               for everyone else's ticket on that trip
ALTER TABLE public.coach_travel ADD COLUMN IF NOT EXISTS travel_mode         text;
ALTER TABLE public.coach_travel ADD COLUMN IF NOT EXISTS booking_ok          boolean;
ALTER TABLE public.coach_travel ADD COLUMN IF NOT EXISTS travel_confirmed_at timestamptz;
ALTER TABLE public.coach_travel ADD COLUMN IF NOT EXISTS travel_note         text;
COMMENT ON COLUMN public.coach_travel.booking_ok IS
  'Coach agreed the club may book this ticket in their name. NULL = not asked/answered yet.';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coach_travel_travel_mode_chk') THEN
    ALTER TABLE public.coach_travel ADD CONSTRAINT coach_travel_travel_mode_chk
      CHECK (travel_mode IS NULL OR travel_mode IN ('fly_club','drive','fly_own'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS coach_travel_confirmed_idx ON public.coach_travel(travel_confirmed_at);
