-- Switch for the 10am auto-cancel of DSSC classes with no sign-ups
-- (api/dssc-coach-texts.js). false = report empty classes, cancel nothing.
ALTER TABLE public.dssc_sync ADD COLUMN IF NOT EXISTS auto_cancel boolean NOT NULL DEFAULT true;
