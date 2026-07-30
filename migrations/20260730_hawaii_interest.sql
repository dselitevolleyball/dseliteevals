-- 20260730 — Hawaii trip interest tracking.
--
-- An optional tournament open only to 13 Diamond, 14 Diamond and 15 Diamond
-- (31 players). One row per player recording where they are on the ladder:
--   not_asked -> interested -> committed, or declined
--
-- Admin-only at Drew's request, so the policy checks is_admin as well as
-- is_approved — unlike most tables here, an ordinary approved coach gets
-- nothing. Rows are created lazily on first status change; a player with no
-- row is treated as 'not_asked' by the UI, so the table stays empty until
-- someone actually answers.
--
-- Run: node scripts/run-sql.mjs migrations/20260730_hawaii_interest.sql
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.hawaii_interest (
  player_id  INTEGER     PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  status     TEXT        NOT NULL DEFAULT 'not_asked',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.hawaii_interest ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hawaii_interest_admin_all ON public.hawaii_interest;
CREATE POLICY hawaii_interest_admin_all ON public.hawaii_interest FOR ALL
  USING (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved AND c.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved AND c.is_admin));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='hawaii_interest') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.hawaii_interest;
  END IF;
END $$;
