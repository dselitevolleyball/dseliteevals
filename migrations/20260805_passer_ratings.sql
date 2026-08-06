-- Migration: passer ratings — a dated series per player, per team.
-- Date: 2026-08-05  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260805_passer_ratings.sql
--
-- A coach logs the whole team in one go during a drill, so the session is the
-- unit: one row per logging, and one rating row per player inside it. Keeping
-- ratings as their own rows (rather than a jsonb blob on the session) is what
-- makes "this player across the season" a query rather than a scan.
--
-- Scale is stored per session. Most of volleyball grades passing 0-3; some
-- coaches use 0-4. Recording which was used means a 3 logged last month still
-- means the same thing next to a 3 logged today.

CREATE TABLE IF NOT EXISTS public.passing_sessions (
  id            BIGSERIAL PRIMARY KEY,
  team_name     TEXT NOT NULL,
  session_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  label         TEXT,                                   -- "Pre-CTPL serve receive"
  scale_max     NUMERIC NOT NULL DEFAULT 3,             -- 3 or 4
  season        TEXT,
  logged_by     TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT passing_sessions_scale_chk CHECK (scale_max IN (3, 4))
);

CREATE TABLE IF NOT EXISTS public.passing_ratings (
  id          BIGSERIAL PRIMARY KEY,
  session_id  BIGINT NOT NULL REFERENCES public.passing_sessions(id) ON DELETE CASCADE,
  player_id   INTEGER NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  rating      NUMERIC,          -- the average for that player in that drill
  attempts    INTEGER,          -- how many balls it's based on, if counted
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, player_id)
);

CREATE INDEX IF NOT EXISTS passing_sessions_team_idx ON public.passing_sessions(team_name, session_date DESC);
CREATE INDEX IF NOT EXISTS passing_ratings_player_idx ON public.passing_ratings(player_id);
CREATE INDEX IF NOT EXISTS passing_ratings_session_idx ON public.passing_ratings(session_id);

ALTER TABLE public.passing_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passing_ratings  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS passing_sessions_access ON public.passing_sessions;
DROP POLICY IF EXISTS passing_ratings_access  ON public.passing_ratings;

-- Same rule as evaluations: directors everywhere, a coach on their own teams.
CREATE POLICY passing_sessions_access ON public.passing_sessions FOR ALL
  USING (public.is_admin_coach() OR public.is_my_team(team_name))
  WITH CHECK (public.is_admin_coach() OR public.is_my_team(team_name));

-- Ratings inherit the session's team — no separate team column to drift.
CREATE POLICY passing_ratings_access ON public.passing_ratings FOR ALL
  USING (EXISTS (SELECT 1 FROM public.passing_sessions s WHERE s.id = session_id
                 AND (public.is_admin_coach() OR public.is_my_team(s.team_name))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.passing_sessions s WHERE s.id = session_id
                 AND (public.is_admin_coach() OR public.is_my_team(s.team_name))));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='passing_ratings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.passing_ratings;
  END IF;
END $$;
