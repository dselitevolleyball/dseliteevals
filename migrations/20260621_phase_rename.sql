-- Migration: rename Practice phases to Summer / Fall1 / Fall2.
-- Date: 2026-06-21
--
-- Reasoning: the practice schedule the user sees on Sundays differs by
-- calendar window:
--   summer  = Jul 12 – Sep 12 (4 courts, no S&A)
--   fall1   = Sep 13 – Oct 11 (6 courts, S&A Fall Block 1)
--   fall2   = Oct 18 – Nov 15 (6 courts, S&A Fall Block 2)
-- We previously stored phase as 'preseason' and 'season'; map those to
-- 'summer' and 'fall1', then duplicate fall1 court rows into 'fall2' so
-- both fall phases start with the same court schedule (Drew can edit
-- either independently going forward).
--
-- sa_sessions.block also gets renamed: 'fall_b1' → 'fall1', 'fall_b2'
-- → 'fall2', matching the phase identifiers.

UPDATE public.practice_assignments SET phase = 'summer' WHERE phase = 'preseason';
UPDATE public.practice_assignments SET phase = 'fall1'  WHERE phase = 'season';

-- Seed fall2 court schedule from fall1 (skips duplicates if rerun).
INSERT INTO public.practice_assignments (team_name, day, slot, phase, notes)
SELECT team_name, day, slot, 'fall2', notes
FROM   public.practice_assignments
WHERE  phase = 'fall1'
ON CONFLICT (team_name, day, slot, phase) DO NOTHING;

UPDATE public.sa_sessions SET block = 'fall1' WHERE block = 'fall_b1';
UPDATE public.sa_sessions SET block = 'fall2' WHERE block = 'fall_b2';
