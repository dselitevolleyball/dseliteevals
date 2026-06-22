-- Migration: restore the regular-season practice plan under phase='season'.
-- Date: 2026-06-22
--
-- The 20260621 phase rename moved the original regular-season schedule from
-- phase='season' to 'fall1', leaving the new "Regular Season" tab empty.
-- This re-seeds the original plan (exactly as committed in
-- 20260612_practice_schedule.sql) under phase='season', then converts the
-- Sunday rows to the current 1-hour slot format (matching 20260621_hour_slots).
--
-- SAFE: idempotent (ON CONFLICT DO NOTHING) and scoped to phase='season'.
-- It does NOT touch summer / fall1 / fall2, and does NOT modify practice_teams
-- (so current coach assignments are preserved). Run once in the Supabase SQL
-- editor.

-- 1) Re-seed the original regular-season plan as phase='season'.
INSERT INTO public.practice_assignments (team_name, day, slot, phase) VALUES
  ('16 Ruby',     'Sun', '6-8pm',  'season'),
  ('16 Ruby',     'Wed', '7-9pm',  'season'),
  ('16 Diamond',  'Sun', '6-8pm',  'season'),
  ('16 Diamond',  'Mon', '7-9pm',  'season'),
  ('16 Diamond',  'Thu', '7-9pm',  'season'),
  ('15 Sapphire', 'Sun', '6-8pm',  'season'),
  ('15 Sapphire', 'Wed', '7-9pm',  'season'),
  ('15 Ruby',     'Sun', '6-8pm',  'season'),
  ('15 Ruby',     'Mon', '7-9pm',  'season'),
  ('15 Ruby',     'Thu', '7-9pm',  'season'),
  ('15 Diamond',  'Sun', '6-8pm',  'season'),
  ('15 Diamond',  'Mon', '7-9pm',  'season'),
  ('15 Diamond',  'Thu', '7-9pm',  'season'),
  ('15 Emerald',  'Sun', '6-8pm',  'season'),
  ('15 Emerald',  'Wed', '7-9pm',  'season'),
  ('14 Sapphire', 'Sun', '4-6pm',  'season'),
  ('14 Sapphire', 'Wed', '7-9pm',  'season'),
  ('14 Ruby',     'Sun', '4-6pm',  'season'),
  ('14 Ruby',     'Thu', '5-7pm',  'season'),
  ('14 Ruby',     'Thu', '7-9pm',  'season'),
  ('14 Emerald',  'Sun', '4-6pm',  'season'),
  ('14 Emerald',  'Thu', '7-9pm',  'season'),
  ('14 Diamond',  'Sun', '4-6pm',  'season'),
  ('14 Diamond',  'Mon', '5-7pm',  'season'),
  ('14 Diamond',  'Thu', '7-9pm',  'season'),
  ('13 Ruby',     'Sun', '4-6pm',  'season'),
  ('13 Ruby',     'Mon', '5-7pm',  'season'),
  ('13 Rise',     'Sun', '4-6pm',  'season'),
  ('13 Rise',     'Mon', '5-7pm',  'season'),
  ('13 Diamond',  'Sun', '2-4pm',  'season'),
  ('13 Diamond',  'Mon', '5-7pm',  'season'),
  ('13 Diamond',  'Thu', '5-7pm',  'season'),
  ('13 Sapphire', 'Sun', '2-4pm',  'season'),
  ('13 Sapphire', 'Thu', '5-7pm',  'season'),
  ('12 Ruby',     'Sun', '2-4pm',  'season'),
  ('12 Ruby',     'Mon', '5-7pm',  'season'),
  ('12 Rise 1',   'Sun', '12-2pm', 'season'),
  ('12 Rise 1',   'Wed', '5-7pm',  'season'),
  ('12 Diamond',  'Sun', '2-4pm',  'season'),
  ('12 Diamond',  'Thu', '5-7pm',  'season'),
  ('12 Rise 2',   'Sun', '12-2pm', 'season'),
  ('12 Rise 2',   'Wed', '5-7pm',  'season'),
  ('11 Rise',     'Sun', '12-2pm', 'season'),
  ('11 Rise',     'Wed', '5-7pm',  'season'),
  ('11 Diamond',  'Sun', '12-2pm', 'season'),
  ('11 Diamond',  'Wed', '5-7pm',  'season')
ON CONFLICT (team_name, day, slot, phase) DO NOTHING;

-- 2) Convert season Sunday 2-hour rows into the current 1-hour format.
INSERT INTO public.practice_assignments (team_name, day, slot, phase)
  SELECT team_name, 'Sun', '12-1pm', 'season' FROM public.practice_assignments WHERE phase='season' AND day='Sun' AND slot='12-2pm'
  UNION ALL SELECT team_name, 'Sun', '1-2pm', 'season' FROM public.practice_assignments WHERE phase='season' AND day='Sun' AND slot='12-2pm'
  UNION ALL SELECT team_name, 'Sun', '2-3pm', 'season' FROM public.practice_assignments WHERE phase='season' AND day='Sun' AND slot='2-4pm'
  UNION ALL SELECT team_name, 'Sun', '3-4pm', 'season' FROM public.practice_assignments WHERE phase='season' AND day='Sun' AND slot='2-4pm'
  UNION ALL SELECT team_name, 'Sun', '4-5pm', 'season' FROM public.practice_assignments WHERE phase='season' AND day='Sun' AND slot='4-6pm'
  UNION ALL SELECT team_name, 'Sun', '5-6pm', 'season' FROM public.practice_assignments WHERE phase='season' AND day='Sun' AND slot='4-6pm'
  UNION ALL SELECT team_name, 'Sun', '6-7pm', 'season' FROM public.practice_assignments WHERE phase='season' AND day='Sun' AND slot='6-8pm'
  UNION ALL SELECT team_name, 'Sun', '7-8pm', 'season' FROM public.practice_assignments WHERE phase='season' AND day='Sun' AND slot='6-8pm'
ON CONFLICT (team_name, day, slot, phase) DO NOTHING;

-- 3) Remove the now-expanded season Sunday 2-hour rows.
DELETE FROM public.practice_assignments
WHERE phase='season' AND day='Sun' AND slot IN ('12-2pm','2-4pm','4-6pm','6-8pm');
