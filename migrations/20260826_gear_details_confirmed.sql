-- 20260826 — rename worksheet_confirmed → details_confirmed
--
-- The order form was written around the paper worksheet families were handed at
-- try-ons. There is no worksheet: the name, number and team come pre-filled from
-- our roster, and what the parent is confirming is that OUR details are right.
-- The column name was the last place the old story survived.
--
-- Zero rows in the table when this ran, so nothing to migrate.
--
-- Run: node scripts/run-sql.mjs migrations/20260826_gear_details_confirmed.sql
-- Idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='player_gear_orders'
               AND column_name='worksheet_confirmed')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='player_gear_orders'
               AND column_name='details_confirmed') THEN
    ALTER TABLE public.player_gear_orders RENAME COLUMN worksheet_confirmed TO details_confirmed;
  END IF;
END $$;

COMMENT ON COLUMN public.player_gear_orders.details_confirmed IS
  'Parent ticked that the last name, jersey number and team on the form are correct.';
