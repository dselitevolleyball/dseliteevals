-- Migration: texting for Dripping Springs Sports Club, on its own number.
-- Date: 2026-09-26  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260926_dssc_sms.sql
--
-- DSSC gets its own Twilio number and 10DLC campaign, separate from DS Elite.
-- Rather than a second copy of the SMS tables, every thread, broadcast and
-- opt-in carries a `brand` ('dse' | 'dssc'): the same parent can have one
-- thread with the club number and another with the DSSC number, replies
-- file under whichever number they answered, and each screen shows only its
-- own brand. DSSC threads also remember the child and the program the
-- family signed up for, which is how the DSSC inbox groups them.

ALTER TABLE public.sms_threads
  ADD COLUMN IF NOT EXISTS brand        TEXT NOT NULL DEFAULT 'dse',
  ADD COLUMN IF NOT EXISTS dssc_program TEXT,       -- clinic/pod name (grouping)
  ADD COLUMN IF NOT EXISTS dssc_player  TEXT;       -- the child's name
ALTER TABLE public.sms_threads DROP CONSTRAINT IF EXISTS sms_threads_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS sms_threads_phone_brand_uniq ON public.sms_threads(phone, brand);
CREATE INDEX IF NOT EXISTS sms_threads_brand_idx ON public.sms_threads(brand, last_message_at DESC);

ALTER TABLE public.sms_broadcasts ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT 'dse';
ALTER TABLE public.sms_broadcasts ADD COLUMN IF NOT EXISTS media_urls JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.sms_messages ADD COLUMN IF NOT EXISTS media_urls JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Opt-ins are per brand: agreeing to DS Elite texts is not agreeing to DSSC's.
ALTER TABLE public.sms_consents ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT 'dse';
ALTER TABLE public.sms_consents ADD COLUMN IF NOT EXISTS player_name TEXT;   -- DSSC: the child, as typed on the form
ALTER TABLE public.sms_consents DROP CONSTRAINT IF EXISTS sms_consents_pkey;
ALTER TABLE public.sms_consents ADD PRIMARY KEY (phone, brand);
