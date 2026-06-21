-- 20260621 — Widen the Spring Break (DSISD) blackout window.
--
-- The original seed (migrations/20260525_tournament_planning.sql) set Spring
-- Break to 2027-03-15 → 2027-03-19. Widen it to 2027-03-12 → 2027-03-21 so
-- every tournament across that window is labeled "Spring Break (DSISD)" on its
-- card (and the adjacent weekends count toward the 3-day-weekend badge).
--
-- Run once in the Supabase SQL editor. Non-destructive (updates one row).

UPDATE public.blackout_dates
   SET date_start = '2027-03-12',
       date_end   = '2027-03-21'
 WHERE name = 'Spring Break (DSISD)';

-- If the Spring Break row was deleted at some point, recreate it instead:
INSERT INTO public.blackout_dates (date_start, date_end, name, type)
SELECT '2027-03-12', '2027-03-21', 'Spring Break (DSISD)', 'spring_break'
 WHERE NOT EXISTS (SELECT 1 FROM public.blackout_dates WHERE name = 'Spring Break (DSISD)');
