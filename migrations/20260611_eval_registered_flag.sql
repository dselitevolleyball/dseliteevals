-- Migration: evaluation-signup flag
-- Date: 2026-06-11
--
-- Mirror of tryout_registered. Set TRUE by the CSV importer when the
-- uploaded file's Event Title contains "eval" or "evaluation". Lets
-- the Teams + Tracker views split players into three buckets:
--   - tryout-only        (tryout_registered=true,  eval_registered=false)
--   - eval-only          (eval_registered=true,    tryout_registered=false, supplemental=0)
--   - eval-as-tryout     (eval_registered=true,    supplemental=1)
-- Default FALSE so existing rows don't claim a state they didn't opt into.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS eval_registered BOOLEAN NOT NULL DEFAULT FALSE;
