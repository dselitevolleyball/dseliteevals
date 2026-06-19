-- Migration: seed the preseason practice schedule (Sundays only).
-- Date: 2026-06-20
--
-- Constraints:
--   * Sunday only — preseason is a single weekly practice for every
--     non-developmental team.
--   * 4 courts maximum per slot.
--   * Rise (developmental) teams excluded — they don't run preseason.
--
-- Coach-conflict check passed for every slot:
--   12-2pm  Tara / Ella also coach later slots (different times)
--   2-4pm   Sam R, Jayden, Bree, Ambria all also coach later slots
--   4-6pm   no double-bookings
--   6-8pm   no double-bookings — but 6 teams in 4 courts (16 D + 17 D
--           overflow). Either pair them on shared courts or move one
--           up to 4-6pm via the Practice tab.

DELETE FROM public.practice_assignments WHERE phase = 'preseason';

INSERT INTO public.practice_assignments (team_name, day, slot, phase) VALUES
  -- 12-2pm — youngest cohort
  ('11 Diamond',  'Sun', '12-2pm', 'preseason'),
  ('12 Diamond',  'Sun', '12-2pm', 'preseason'),
  ('12 Ruby',     'Sun', '12-2pm', 'preseason'),
  ('13 Sapphire', 'Sun', '12-2pm', 'preseason'),
  -- 2-4pm — U13 + younger U14
  ('13 Diamond',  'Sun', '2-4pm',  'preseason'),
  ('13 Ruby',     'Sun', '2-4pm',  'preseason'),
  ('14 Topaz',    'Sun', '2-4pm',  'preseason'),
  ('14 Sapphire', 'Sun', '2-4pm',  'preseason'),
  -- 4-6pm — U14 / U15 Emerald
  ('14 Emerald',  'Sun', '4-6pm',  'preseason'),
  ('14 Ruby',     'Sun', '4-6pm',  'preseason'),
  ('14 Diamond',  'Sun', '4-6pm',  'preseason'),
  ('15 Emerald',  'Sun', '4-6pm',  'preseason'),
  -- 6-8pm — older teams (6 teams / 4 courts — see note above)
  ('15 Sapphire', 'Sun', '6-8pm',  'preseason'),
  ('15 Diamond',  'Sun', '6-8pm',  'preseason'),
  ('15 Ruby',     'Sun', '6-8pm',  'preseason'),
  ('16 Ruby',     'Sun', '6-8pm',  'preseason'),
  ('16 Diamond',  'Sun', '6-8pm',  'preseason'),
  ('17 Diamond',  'Sun', '6-8pm',  'preseason')
ON CONFLICT (team_name, day, slot, phase) DO NOTHING;
