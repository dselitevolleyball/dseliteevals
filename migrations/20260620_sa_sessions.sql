-- Migration: S&A (Speed & Agility / Strength & Conditioning) per-Sunday schedule.
-- Date: 2026-06-20
--
-- One row per (block, Sunday, slot, team). Unique constraint on
-- (block, session_date, slot) enforces 1 team at a time in the S&A space.
--
-- Two blocks for the 2026-27 season:
--   Fall Block 1 (Sep 13 → Oct 11): 8 Nationals, 8 slots/Sun (12-8pm)
--   Fall Block 2 (Oct 18 → Nov 15): 9 Regionals, 9 slots/Sun (12-9pm)
--
-- 11 Diamond (U11) opts out of S&A entirely.

CREATE TABLE IF NOT EXISTS public.sa_sessions (
  id            BIGSERIAL PRIMARY KEY,
  block         TEXT NOT NULL,           -- 'fall_b1', 'fall_b2'
  session_date  DATE NOT NULL,           -- specific Sunday
  slot          TEXT NOT NULL,           -- '12-1pm', '1-2pm', ... '8-9pm'
  team_name     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (block, session_date, slot)
);

CREATE INDEX IF NOT EXISTS sa_sessions_block_idx ON public.sa_sessions(block);
CREATE INDEX IF NOT EXISTS sa_sessions_team_idx  ON public.sa_sessions(team_name);
CREATE INDEX IF NOT EXISTS sa_sessions_date_idx  ON public.sa_sessions(session_date);

ALTER TABLE public.sa_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_sa" ON public.sa_sessions;
DROP POLICY IF EXISTS "auth_modify_sa" ON public.sa_sessions;

CREATE POLICY "auth_select_sa" ON public.sa_sessions
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_modify_sa" ON public.sa_sessions
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Realtime
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='sa_sessions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sa_sessions;
  END IF;
END $$;

-- ─── Fall Block 1 seed ──────────────────────────────────────────────
-- 8 Nationals × 5 Sundays. Same slot every week (predictable for families).
-- Slots ordered by team age: youngest at noon, oldest at 7pm.
INSERT INTO public.sa_sessions (block, session_date, slot, team_name) VALUES
  -- Sep 13
  ('fall_b1', '2026-09-13', '12-1pm', '12 Diamond'),
  ('fall_b1', '2026-09-13', '1-2pm',  '13 Diamond'),
  ('fall_b1', '2026-09-13', '2-3pm',  '14 Ruby'),
  ('fall_b1', '2026-09-13', '3-4pm',  '14 Diamond'),
  ('fall_b1', '2026-09-13', '4-5pm',  '15 Ruby'),
  ('fall_b1', '2026-09-13', '5-6pm',  '15 Diamond'),
  ('fall_b1', '2026-09-13', '6-7pm',  '16 Diamond'),
  ('fall_b1', '2026-09-13', '7-8pm',  '17 Diamond'),
  -- Sep 20
  ('fall_b1', '2026-09-20', '12-1pm', '12 Diamond'),
  ('fall_b1', '2026-09-20', '1-2pm',  '13 Diamond'),
  ('fall_b1', '2026-09-20', '2-3pm',  '14 Ruby'),
  ('fall_b1', '2026-09-20', '3-4pm',  '14 Diamond'),
  ('fall_b1', '2026-09-20', '4-5pm',  '15 Ruby'),
  ('fall_b1', '2026-09-20', '5-6pm',  '15 Diamond'),
  ('fall_b1', '2026-09-20', '6-7pm',  '16 Diamond'),
  ('fall_b1', '2026-09-20', '7-8pm',  '17 Diamond'),
  -- Sep 27
  ('fall_b1', '2026-09-27', '12-1pm', '12 Diamond'),
  ('fall_b1', '2026-09-27', '1-2pm',  '13 Diamond'),
  ('fall_b1', '2026-09-27', '2-3pm',  '14 Ruby'),
  ('fall_b1', '2026-09-27', '3-4pm',  '14 Diamond'),
  ('fall_b1', '2026-09-27', '4-5pm',  '15 Ruby'),
  ('fall_b1', '2026-09-27', '5-6pm',  '15 Diamond'),
  ('fall_b1', '2026-09-27', '6-7pm',  '16 Diamond'),
  ('fall_b1', '2026-09-27', '7-8pm',  '17 Diamond'),
  -- Oct 4
  ('fall_b1', '2026-10-04', '12-1pm', '12 Diamond'),
  ('fall_b1', '2026-10-04', '1-2pm',  '13 Diamond'),
  ('fall_b1', '2026-10-04', '2-3pm',  '14 Ruby'),
  ('fall_b1', '2026-10-04', '3-4pm',  '14 Diamond'),
  ('fall_b1', '2026-10-04', '4-5pm',  '15 Ruby'),
  ('fall_b1', '2026-10-04', '5-6pm',  '15 Diamond'),
  ('fall_b1', '2026-10-04', '6-7pm',  '16 Diamond'),
  ('fall_b1', '2026-10-04', '7-8pm',  '17 Diamond'),
  -- Oct 11
  ('fall_b1', '2026-10-11', '12-1pm', '12 Diamond'),
  ('fall_b1', '2026-10-11', '1-2pm',  '13 Diamond'),
  ('fall_b1', '2026-10-11', '2-3pm',  '14 Ruby'),
  ('fall_b1', '2026-10-11', '3-4pm',  '14 Diamond'),
  ('fall_b1', '2026-10-11', '4-5pm',  '15 Ruby'),
  ('fall_b1', '2026-10-11', '5-6pm',  '15 Diamond'),
  ('fall_b1', '2026-10-11', '6-7pm',  '16 Diamond'),
  ('fall_b1', '2026-10-11', '7-8pm',  '17 Diamond')
ON CONFLICT (block, session_date, slot) DO NOTHING;

-- ─── Fall Block 2 seed ──────────────────────────────────────────────
-- 9 Regionals × 5 Sundays (12-9pm to fit 9 slots).
INSERT INTO public.sa_sessions (block, session_date, slot, team_name) VALUES
  -- Oct 18
  ('fall_b2', '2026-10-18', '12-1pm', '12 Ruby'),
  ('fall_b2', '2026-10-18', '1-2pm',  '13 Ruby'),
  ('fall_b2', '2026-10-18', '2-3pm',  '13 Sapphire'),
  ('fall_b2', '2026-10-18', '3-4pm',  '14 Topaz'),
  ('fall_b2', '2026-10-18', '4-5pm',  '14 Emerald'),
  ('fall_b2', '2026-10-18', '5-6pm',  '14 Sapphire'),
  ('fall_b2', '2026-10-18', '6-7pm',  '15 Emerald'),
  ('fall_b2', '2026-10-18', '7-8pm',  '15 Sapphire'),
  ('fall_b2', '2026-10-18', '8-9pm',  '16 Ruby'),
  -- Oct 25
  ('fall_b2', '2026-10-25', '12-1pm', '12 Ruby'),
  ('fall_b2', '2026-10-25', '1-2pm',  '13 Ruby'),
  ('fall_b2', '2026-10-25', '2-3pm',  '13 Sapphire'),
  ('fall_b2', '2026-10-25', '3-4pm',  '14 Topaz'),
  ('fall_b2', '2026-10-25', '4-5pm',  '14 Emerald'),
  ('fall_b2', '2026-10-25', '5-6pm',  '14 Sapphire'),
  ('fall_b2', '2026-10-25', '6-7pm',  '15 Emerald'),
  ('fall_b2', '2026-10-25', '7-8pm',  '15 Sapphire'),
  ('fall_b2', '2026-10-25', '8-9pm',  '16 Ruby'),
  -- Nov 1
  ('fall_b2', '2026-11-01', '12-1pm', '12 Ruby'),
  ('fall_b2', '2026-11-01', '1-2pm',  '13 Ruby'),
  ('fall_b2', '2026-11-01', '2-3pm',  '13 Sapphire'),
  ('fall_b2', '2026-11-01', '3-4pm',  '14 Topaz'),
  ('fall_b2', '2026-11-01', '4-5pm',  '14 Emerald'),
  ('fall_b2', '2026-11-01', '5-6pm',  '14 Sapphire'),
  ('fall_b2', '2026-11-01', '6-7pm',  '15 Emerald'),
  ('fall_b2', '2026-11-01', '7-8pm',  '15 Sapphire'),
  ('fall_b2', '2026-11-01', '8-9pm',  '16 Ruby'),
  -- Nov 8
  ('fall_b2', '2026-11-08', '12-1pm', '12 Ruby'),
  ('fall_b2', '2026-11-08', '1-2pm',  '13 Ruby'),
  ('fall_b2', '2026-11-08', '2-3pm',  '13 Sapphire'),
  ('fall_b2', '2026-11-08', '3-4pm',  '14 Topaz'),
  ('fall_b2', '2026-11-08', '4-5pm',  '14 Emerald'),
  ('fall_b2', '2026-11-08', '5-6pm',  '14 Sapphire'),
  ('fall_b2', '2026-11-08', '6-7pm',  '15 Emerald'),
  ('fall_b2', '2026-11-08', '7-8pm',  '15 Sapphire'),
  ('fall_b2', '2026-11-08', '8-9pm',  '16 Ruby'),
  -- Nov 15
  ('fall_b2', '2026-11-15', '12-1pm', '12 Ruby'),
  ('fall_b2', '2026-11-15', '1-2pm',  '13 Ruby'),
  ('fall_b2', '2026-11-15', '2-3pm',  '13 Sapphire'),
  ('fall_b2', '2026-11-15', '3-4pm',  '14 Topaz'),
  ('fall_b2', '2026-11-15', '4-5pm',  '14 Emerald'),
  ('fall_b2', '2026-11-15', '5-6pm',  '14 Sapphire'),
  ('fall_b2', '2026-11-15', '6-7pm',  '15 Emerald'),
  ('fall_b2', '2026-11-15', '7-8pm',  '15 Sapphire'),
  ('fall_b2', '2026-11-15', '8-9pm',  '16 Ruby')
ON CONFLICT (block, session_date, slot) DO NOTHING;
