-- 20260802 — Club can cover an own-room in full.
--
-- Default stays: a coach who wants a private room pays 50% via payroll. Two
-- ways to override:
--
--   coach_roster.own_room_club_paid  — a standing rule for that person. Drew,
--     Hunter and Kristen have their private rooms covered in full, always.
--     Held against the coach rather than hardcoded in the app so the list can
--     change without a deploy.
--
--   coach_travel.own_room_club_pays  — per-trip override. NULL (default) means
--     "use the standing rule"; true/false wins for that one tournament.
--
-- Run: node scripts/run-sql.mjs migrations/20260802_own_room_club_paid.sql
-- Additive and idempotent.

ALTER TABLE public.coach_roster ADD COLUMN IF NOT EXISTS own_room_club_paid boolean NOT NULL DEFAULT false;
ALTER TABLE public.coach_travel ADD COLUMN IF NOT EXISTS own_room_club_pays boolean;

UPDATE public.coach_roster
   SET own_room_club_paid = true
 WHERE lower(btrim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')))
       IN ('drew rose', 'hunter haley', 'kristen alexandrov');

COMMENT ON COLUMN public.coach_roster.own_room_club_paid IS
  'Club covers this coach''s private room in full — no payroll deduction.';
COMMENT ON COLUMN public.coach_travel.own_room_club_pays IS
  'Per-trip override of the standing rule. NULL = use coach_roster.own_room_club_paid.';
