-- 20260830 — a real home for the second parent on the roster.
--
-- The roster has held one parent since the beginning: parent_name,
-- parent_phone, parent_email, plus parent_email2/3 as spare addresses. That
-- shape can record a second parent's EMAIL but not who they are or how to ring
-- them, which is the half you need at a try-on table or a tournament.
--
-- The master team workbooks carry both parents in full for 150 of 186 girls, so
-- the data exists; it just had nowhere to land.
--
-- Email deliberately does NOT get a parent2_email column. Every parent blast in
-- the app reads PARENT_EMAIL_FIELDS = parent_email, parent_email2,
-- parent_email3 (src/App.jsx), so a fourth column would be an address nobody
-- writes to. The second parent's email goes in parent_email2, where it is
-- already reached.
--
-- Run: node scripts/run-sql.mjs migrations/20260830_parent2_on_roster.sql
-- Additive and idempotent.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS parent2_name  text,
  ADD COLUMN IF NOT EXISTS parent2_phone text;

COMMENT ON COLUMN public.players.parent2_name IS
  'Second parent/guardian. Their email lives in parent_email2 so the existing parent-email blasts reach them.';
COMMENT ON COLUMN public.players.parent2_phone IS
  'Second parent/guardian phone.';
