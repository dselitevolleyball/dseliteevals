-- 20260826 — a third contact address per player
--
-- Two slots assumed two parents at one household. Charlee Saunders has a dad
-- who paid the registration, a mom on the account, and a third guardian who
-- needs every team email too — with only two slots, adding her meant deleting
-- one of them. Splitting households are common enough that "you may only have
-- two adults" is the wrong rule for a communication list.
--
-- Every place the app gathers addresses reads all three, so nothing has to
-- remember which slot a person landed in.
--
-- Run: node scripts/run-sql.mjs migrations/20260826_parent_email3.sql
-- Additive and idempotent.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS parent_email3 text;

COMMENT ON COLUMN public.players.parent_email3 IS
  'Third parent/guardian address. Receives everything the first two do.';
