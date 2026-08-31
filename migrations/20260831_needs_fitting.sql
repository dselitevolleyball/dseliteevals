-- 20260831 — "I couldn't make the fitting, measure me at the next one."
--
-- Every size on the gear form is required, which is right for a family who was
-- measured — and a dead end for one who wasn't. Their only options today are to
-- guess at eleven sizes or abandon the form, and a guessed jersey size is worse
-- than a blank because it gets ordered.
--
-- Ticking this releases the size requirements and puts the player on a list to
-- be measured in person. Contact details are still required: those are the
-- fields we need in order to tell her when to come.
--
-- Run: node scripts/run-sql.mjs migrations/20260831_needs_fitting.sql
-- Additive and idempotent.

ALTER TABLE public.player_gear_orders
  ADD COLUMN IF NOT EXISTS needs_fitting boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS player_gear_orders_needs_fitting_idx
  ON public.player_gear_orders (needs_fitting) WHERE needs_fitting;

COMMENT ON COLUMN public.player_gear_orders.needs_fitting IS
  'Family asked to be measured in person at the next fitting instead of entering sizes.';
