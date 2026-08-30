-- 20260830 — Kelli Hardge moves from 16 Diamond to 15 Ruby.
--
-- She stays head coach of 13 Emerald. She picks up 15 Ruby as assistant, where
-- the slot was still the placeholder "15-2 Assistant Coach", and comes off
-- 16 Diamond, where she was the third coach.
--
-- Two weekends are carved out up front rather than discovered later. Both are
-- weekends where 13 Emerald has first claim on her, so 15 Ruby needs someone
-- else — recorded as asst_override='TBD', which is what the tournament board
-- already reads as "this needs a coach":
--
--   Countdown City Classic, 9–10 Jan — all three of her teams are at this one
--     event in San Antonio, and her focus is 13 Emerald.
--   March Mayhem, 3–4 Apr — 13 Emerald is at Final Countdown in Buda the same
--     weekend and 15 Ruby is in Waco, 100 miles away. She cannot do both.
--
-- Run: node scripts/run-sql.mjs migrations/20260830_kelli_15_ruby.sql

UPDATE public.practice_teams
   SET assistant_coach = 'Kelli Hardge', updated_at = NOW()
 WHERE team_name = '15 Ruby';

UPDATE public.practice_teams
   SET third_coach = NULL, updated_at = NOW()
 WHERE team_name = '16 Diamond' AND third_coach = 'Kelli Hardge';

UPDATE public.tournament_assignments
   SET asst_override = 'TBD',
       notes = TRIM(BOTH ' ' FROM COALESCE(notes || ' | ', '') ||
               'Kelli Hardge is with 13 Emerald at this event — 15 Ruby needs an assistant.')
 WHERE id = 109;

UPDATE public.tournament_assignments
   SET asst_override = 'TBD',
       notes = TRIM(BOTH ' ' FROM COALESCE(notes || ' | ', '') ||
               'Kelli Hardge is at Final Countdown with 13 Emerald (Buda) — 15 Ruby needs an assistant in Waco.')
 WHERE id = 191;
