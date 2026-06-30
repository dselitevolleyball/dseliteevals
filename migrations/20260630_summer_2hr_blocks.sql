-- 20260630 — Collapse SUMMER Sunday practice assignments from 1-hour slots
-- into 2-hour blocks (matching the regular season). Fall 1 / Fall 2 are left
-- on 1-hour granularity.
--
-- Mapping:  1-2pm,2-3pm -> 1-3pm   3-4pm,4-5pm -> 3-5pm
--           5-6pm,6-7pm -> 5-7pm   7-8pm,8-9pm -> 7-9pm
--
-- Run once in the Supabase SQL editor. Non-destructive to other phases;
-- only touches phase='summer', day='Sun'. Dedupe-safe (handles a team being
-- assigned to both hours of a block, or to a single odd hour).

-- 1) Drop duplicate rows that would collide once both hours map to one block,
--    keeping the lowest id per (team, block).
WITH mapped AS (
  SELECT id, team_name,
    CASE slot
      WHEN '1-2pm' THEN '1-3pm' WHEN '2-3pm' THEN '1-3pm'
      WHEN '3-4pm' THEN '3-5pm' WHEN '4-5pm' THEN '3-5pm'
      WHEN '5-6pm' THEN '5-7pm' WHEN '6-7pm' THEN '5-7pm'
      WHEN '7-8pm' THEN '7-9pm' WHEN '8-9pm' THEN '7-9pm'
      ELSE slot END AS block
  FROM public.practice_assignments
  WHERE phase = 'summer' AND day = 'Sun'
),
ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY team_name, block ORDER BY id) AS rn
  FROM mapped
)
DELETE FROM public.practice_assignments
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2) Relabel the survivors to their 2-hour block.
UPDATE public.practice_assignments SET slot = CASE slot
  WHEN '1-2pm' THEN '1-3pm' WHEN '2-3pm' THEN '1-3pm'
  WHEN '3-4pm' THEN '3-5pm' WHEN '4-5pm' THEN '3-5pm'
  WHEN '5-6pm' THEN '5-7pm' WHEN '6-7pm' THEN '5-7pm'
  WHEN '7-8pm' THEN '7-9pm' WHEN '8-9pm' THEN '7-9pm'
  ELSE slot END
WHERE phase = 'summer' AND day = 'Sun'
  AND slot IN ('1-2pm','2-3pm','3-4pm','4-5pm','5-6pm','6-7pm','7-8pm','8-9pm');

-- 3) Same collapse for any summer floating-coach (☁) blocks, if present.
WITH mappedf AS (
  SELECT id, coach_name,
    CASE slot
      WHEN '1-2pm' THEN '1-3pm' WHEN '2-3pm' THEN '1-3pm'
      WHEN '3-4pm' THEN '3-5pm' WHEN '4-5pm' THEN '3-5pm'
      WHEN '5-6pm' THEN '5-7pm' WHEN '6-7pm' THEN '5-7pm'
      WHEN '7-8pm' THEN '7-9pm' WHEN '8-9pm' THEN '7-9pm'
      ELSE slot END AS block
  FROM public.coach_floats
  WHERE phase = 'summer' AND day = 'Sun'
),
rankedf AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY coach_name, block ORDER BY id) AS rn
  FROM mappedf
)
DELETE FROM public.coach_floats
WHERE id IN (SELECT id FROM rankedf WHERE rn > 1);

UPDATE public.coach_floats SET slot = CASE slot
  WHEN '1-2pm' THEN '1-3pm' WHEN '2-3pm' THEN '1-3pm'
  WHEN '3-4pm' THEN '3-5pm' WHEN '4-5pm' THEN '3-5pm'
  WHEN '5-6pm' THEN '5-7pm' WHEN '6-7pm' THEN '5-7pm'
  WHEN '7-8pm' THEN '7-9pm' WHEN '8-9pm' THEN '7-9pm'
  ELSE slot END
WHERE phase = 'summer' AND day = 'Sun'
  AND slot IN ('1-2pm','2-3pm','3-4pm','4-5pm','5-6pm','6-7pm','7-8pm','8-9pm');
