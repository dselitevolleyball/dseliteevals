-- DSSC texting lanes (Drew, Oct 28 2026): each director gets their own
-- section of DSSC Texts, so a family's replies to Adrian about basketball
-- don't land in Hunter's volleyball conversation. See shared/dssc-lanes.js.
--
-- A club thread now belongs to a lane - 'volleyball', 'basketball', 'reach'
-- or 'general' (the front desk) - and there is one thread per phone per lane,
-- so a family texted by Hunter and by Adrian has two conversations, each with
-- its own unread count. DS Elite threads keep lane '' (one per phone, as before).
-- Run: node scripts/run-sql.mjs migrations/20261108_dssc_text_lanes.sql
ALTER TABLE public.sms_threads ADD COLUMN IF NOT EXISTS lane text NOT NULL DEFAULT '';

-- Existing club threads: by the program they're about (a clinic's sport, or
-- Reach / basketball in its name); everything else was Hunter's (1,230 of the
-- 1,400 club texts so far), so Volleyball.
UPDATE public.sms_threads t SET lane = CASE
    WHEN t.dssc_program ~* '\mreach\M' THEN 'reach'
    WHEN EXISTS (SELECT 1 FROM public.dssc_clinics c WHERE c.name = t.dssc_program AND c.sport = 'basketball') THEN 'basketball'
    WHEN t.dssc_program ~* 'basket|hoops' THEN 'basketball'
    ELSE 'volleyball' END
  WHERE t.brand = 'dssc' AND t.lane = '';

DROP INDEX IF EXISTS public.sms_threads_phone_brand_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS sms_threads_phone_brand_lane_uniq ON public.sms_threads (phone, brand, lane);
CREATE INDEX IF NOT EXISTS sms_threads_brand_lane_idx ON public.sms_threads (brand, lane, last_message_at DESC);
