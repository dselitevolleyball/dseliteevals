-- 20260830 — parent and player contacts on the gear order form.
--
-- The roster holds one parent per player: parent_name, parent_phone,
-- parent_email are filled in for all 214 girls, but only 48 have a second
-- email and 26 have a phone for the player herself. At a try-on table that
-- gap is the whole problem — the parent standing in front of you is often the
-- one we don't have, and the girl who wandered off to the far court is
-- reachable only through a phone we never asked for.
--
-- Families are already filling in a form for us, so the contacts get asked
-- there rather than in a separate email that would earn its own 45
-- non-answers.
--
-- Stored on the ORDER, not written back over the roster, for the same reason
-- the confirmed name/number/team are: a form anyone holding the link can open
-- must not be able to silently rewrite how we reach a family. The Gear Orders
-- board shows what came in against what we hold, and the roster is corrected
-- deliberately from there.
--
-- single_parent is a real answer, not a blank. "There is only one guardian" and
-- "they skipped the section" look identical in an empty column, and only one of
-- them is worth chasing.
--
-- Run: node scripts/run-sql.mjs migrations/20260830_gear_order_contacts.sql
-- Additive and idempotent.

ALTER TABLE public.player_gear_orders
  ADD COLUMN IF NOT EXISTS parent1_name   text,
  ADD COLUMN IF NOT EXISTS parent1_phone  text,
  ADD COLUMN IF NOT EXISTS parent1_email  text,
  ADD COLUMN IF NOT EXISTS parent2_name   text,
  ADD COLUMN IF NOT EXISTS parent2_phone  text,
  ADD COLUMN IF NOT EXISTS parent2_email  text,
  ADD COLUMN IF NOT EXISTS single_parent  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS player_phone   text;

COMMENT ON COLUMN public.player_gear_orders.single_parent IS
  'Family said there is only one parent/guardian — distinguishes "no second contact exists" from "section skipped".';
COMMENT ON COLUMN public.player_gear_orders.player_phone IS
  'The player''s own mobile, as confirmed by the family. Blank means she has none, or they left it blank.';
