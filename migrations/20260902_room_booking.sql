-- 20260902 — room bookings, and what a stay-to-play weekend actually needs.
--
-- TWO THINGS
--
-- 1. coach_travel.room_booked — the room half of what flight_purchased already
--    does for flights. Per person, because that is how Kristen works through a
--    list: she books one traveller's room, ticks it, moves on. A room number
--    alone did not say whether anyone had actually reserved it.
--
-- 2. coach_roster.sex — needed to pair coaches into rooms, and recorded nowhere
--    until now. Deliberately left NULL rather than guessed at: the room planner
--    reports "cannot pair yet" for anyone unset, which is honest, where a guess
--    from a first name is both wrong sometimes and offensive when it is.
--
-- THE ROOM RULES, for reference, live in shared/room-plan.js:
--   players  — one room per player's family, so a room per attending player
--   coaches  — two same-sex coaches to a room, EXCEPT a coach with her own
--              child playing that weekend, who keeps a room to herself
--
-- Run: node scripts/run-sql.mjs migrations/20260902_room_booking.sql
-- Additive and idempotent.

ALTER TABLE public.coach_travel
  ADD COLUMN IF NOT EXISTS room_booked    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS room_booked_at timestamptz,
  ADD COLUMN IF NOT EXISTS room_booked_by text;

COMMENT ON COLUMN public.coach_travel.room_booked IS
  'The room for this traveller is actually reserved — the counterpart of flight_purchased.';

ALTER TABLE public.coach_roster
  ADD COLUMN IF NOT EXISTS sex text;

ALTER TABLE public.coach_roster
  DROP CONSTRAINT IF EXISTS coach_roster_sex_check;
ALTER TABLE public.coach_roster
  ADD CONSTRAINT coach_roster_sex_check CHECK (sex IS NULL OR sex IN ('F', 'M'));

COMMENT ON COLUMN public.coach_roster.sex IS
  'For same-sex room pairing on travel. NULL means not recorded — the room planner says so rather than assuming.';
