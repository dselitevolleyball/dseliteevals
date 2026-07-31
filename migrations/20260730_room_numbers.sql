-- 20260730 — Number the rooms in a tournament's hotel block.
--
-- Rooms were created one at a time, each re-typing the hotel name. For a
-- stay-to-play block you know the hotel once and the room COUNT — so rooms are
-- now numbered slots (Room 1, Room 2, …) under a shared hotel name, and coaches
-- pick a number.
--
-- Run: node scripts/run-sql.mjs migrations/20260730_room_numbers.sql
-- Additive and idempotent.

ALTER TABLE public.coach_travel_rooms ADD COLUMN IF NOT EXISTS room_no integer;

-- Number any pre-existing rooms per tournament by creation order.
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY tournament_id ORDER BY id) AS rn
  FROM public.coach_travel_rooms WHERE room_no IS NULL
)
UPDATE public.coach_travel_rooms r SET room_no = n.rn FROM numbered n WHERE n.id = r.id;

CREATE INDEX IF NOT EXISTS coach_travel_rooms_tn_no_idx ON public.coach_travel_rooms (tournament_id, room_no);
