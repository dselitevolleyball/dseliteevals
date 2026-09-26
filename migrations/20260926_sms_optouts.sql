-- Migration: DSSC texting is opt-out, not opt-in.
-- Date: 2026-09-26  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260926_sms_optouts.sql
--
-- Everyone in the club's system agreed to texts when they registered, so the
-- club no longer gates sends on a recorded opt-in. What it tracks instead is
-- who has opted OUT: a STOP reply (recorded by the webhook, and Twilio blocks
-- them anyway), a carrier bounce for an unsubscribed number (error 21610), or
-- a director marking a family "do not text".

CREATE TABLE IF NOT EXISTS public.sms_optouts (
  phone      TEXT NOT NULL,          -- E.164
  brand      TEXT NOT NULL DEFAULT 'dssc',
  source     TEXT,                   -- stop-reply | twilio-21610 | manual
  name       TEXT,
  note       TEXT,
  opted_out_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by   TEXT,
  PRIMARY KEY (phone, brand)
);
ALTER TABLE public.sms_optouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_sms_optouts" ON public.sms_optouts;
CREATE POLICY "auth_all_sms_optouts" ON public.sms_optouts FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
