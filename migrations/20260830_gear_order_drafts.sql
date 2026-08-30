-- 20260830 — autosave for the gear order form.
--
-- Families fill this in on a phone, in a gym, standing at a table with a child
-- half-changed. They get interrupted. Until now the form only existed in the
-- browser until Send was pressed, so an interruption cost them everything and
-- cost us the order.
--
-- Every keystroke now saves. That needs a way to tell a half-filled row from a
-- finished one, because the board counts a row in this table as an order — and
-- a draft counted as an order is worse than no autosave at all: it drops her
-- off the chase list while her sizes are still blank.
--
-- is_draft defaults to FALSE so the orders already submitted stay orders.
--
-- Run: node scripts/run-sql.mjs migrations/20260830_gear_order_drafts.sql
-- Additive and idempotent.

ALTER TABLE public.player_gear_orders
  ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.player_gear_orders.is_draft IS
  'TRUE while the family is still filling the form in. Set FALSE by the Send button. The board counts only is_draft=false as an order.';
