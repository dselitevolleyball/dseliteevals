-- Migration: convert Sunday 2-hour court slots into 1-hour granularity.
-- Date: 2026-06-21
--
-- Each existing 2-hour Sunday row ('12-2pm', '2-4pm', '4-6pm', '6-8pm')
-- expands into TWO 1-hour rows. Applies across all phases (summer/fall1/
-- fall2). After the expand the old 2-hour rows are deleted.
--
-- S&A already runs on 1-hour granularity; only court rows need conversion.

INSERT INTO public.practice_assignments (team_name, day, slot, phase, notes)
  SELECT team_name, 'Sun', '12-1pm', phase, notes FROM public.practice_assignments WHERE day='Sun' AND slot='12-2pm'
  UNION ALL
  SELECT team_name, 'Sun', '1-2pm',  phase, notes FROM public.practice_assignments WHERE day='Sun' AND slot='12-2pm'
  UNION ALL
  SELECT team_name, 'Sun', '2-3pm',  phase, notes FROM public.practice_assignments WHERE day='Sun' AND slot='2-4pm'
  UNION ALL
  SELECT team_name, 'Sun', '3-4pm',  phase, notes FROM public.practice_assignments WHERE day='Sun' AND slot='2-4pm'
  UNION ALL
  SELECT team_name, 'Sun', '4-5pm',  phase, notes FROM public.practice_assignments WHERE day='Sun' AND slot='4-6pm'
  UNION ALL
  SELECT team_name, 'Sun', '5-6pm',  phase, notes FROM public.practice_assignments WHERE day='Sun' AND slot='4-6pm'
  UNION ALL
  SELECT team_name, 'Sun', '6-7pm',  phase, notes FROM public.practice_assignments WHERE day='Sun' AND slot='6-8pm'
  UNION ALL
  SELECT team_name, 'Sun', '7-8pm',  phase, notes FROM public.practice_assignments WHERE day='Sun' AND slot='6-8pm'
ON CONFLICT (team_name, day, slot, phase) DO NOTHING;

DELETE FROM public.practice_assignments
WHERE day = 'Sun' AND slot IN ('12-2pm','2-4pm','4-6pm','6-8pm');
