-- Migration: restore the regular-season practice plan under phase='season'.
-- Date: 2026-06-22
--
-- The 20260621 phase rename moved the regular-season schedule from
-- phase='season' to 'fall1', leaving the "Regular Season" tab empty. fall1
-- still holds the complete, current schedule (74 rows), so copy it back into
-- 'season'. (fall2 is an identical copy the rename made; left untouched here.)
--
-- SAFE: additive, idempotent (ON CONFLICT DO NOTHING). It only creates
-- phase='season' rows; it does not modify or delete fall1 / fall2 / summer,
-- and does not touch practice_teams. Run once in the Supabase SQL editor.

INSERT INTO public.practice_assignments (team_name, day, slot, phase, notes)
SELECT team_name, day, slot, 'season', notes
FROM   public.practice_assignments
WHERE  phase = 'fall1'
ON CONFLICT (team_name, day, slot, phase) DO NOTHING;
