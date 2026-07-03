-- 20260702 — Hide notifications from the Home screen without deleting them.
-- The Home feed's × now sets hidden=true instead of deleting; hidden updates
-- stay in Notification History (admin sent-log + coach archive) and can be
-- restored to Home or permanently deleted from there.
--
-- Run once in the Supabase SQL editor. Additive, non-destructive, idempotent.

ALTER TABLE public.updates
  ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;
