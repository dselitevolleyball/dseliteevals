-- 20260822 — "Doesn't need a room" on a coach's trip.
--
-- tripNeedsBooking() counts a trip as outstanding when room_id is null, so a
-- local coach who drives in each morning and sleeps at home sits on the Needs
-- booking list forever with nothing anyone can do about it. Assigning a room
-- just to silence it would put a bed (and a cost) against someone who never
-- uses it.
--
-- This is the room-side twin of travel_mode = 'drive', which already tells the
-- flight columns there is no ticket to buy.
--
-- Distinct from own_room: own_room means "a room, but not shared". This means
-- no room at all.
--
-- Run: node scripts/run-sql.mjs migrations/20260822_travel_no_room_needed.sql
-- Additive and idempotent.

ALTER TABLE public.coach_travel
  ADD COLUMN IF NOT EXISTS no_room_needed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.coach_travel.no_room_needed IS
  'Coach is commuting to this event and needs no overnight room. Excludes the trip from the outstanding-booking count. Not the same as own_room.';
