-- Migration: in-season player evaluations.
-- Date: 2026-08-04  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260804_player_evaluations.sql
--
-- Separate from the tryout scores in players.scores, which are a single
-- snapshot from May. This is a dated series: a coach evaluates a player
-- whenever they want to, and the history is the point — you can see whether
-- passing actually improved between November and March.
--
-- Scored on the same nine skills as tryouts, deliberately, so a player's
-- tryout score and their in-season score are directly comparable.
--
-- Visibility: directors, plus the coaches of that player's team. Not parents —
-- there is no release step here, and adding one later means adding a status
-- beyond draft/final rather than reworking this.

CREATE TABLE IF NOT EXISTS public.player_evaluations (
  id           BIGSERIAL PRIMARY KEY,
  player_id    INTEGER NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  -- Snapshotted, not derived: an evaluation is a record of how the player was
  -- doing on the team they were on at the time. Moving teams must not rewrite it.
  team_name    TEXT NOT NULL,
  season       TEXT,
  eval_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  scores       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { "Passing": 4, ... } 1-5
  strengths    TEXT,
  focus        TEXT,                                  -- what to work on
  goal         TEXT,
  status       TEXT NOT NULL DEFAULT 'draft',         -- draft | final
  coach_name   TEXT,
  coach_email  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT player_evaluations_status_chk CHECK (status IN ('draft','final'))
);

CREATE INDEX IF NOT EXISTS player_evaluations_player_idx ON public.player_evaluations(player_id, eval_date DESC);
CREATE INDEX IF NOT EXISTS player_evaluations_team_idx   ON public.player_evaluations(team_name, eval_date DESC);

-- Is the caller a coach of this team? Team membership isn't stored on the
-- coaches row (team_divs holds age groups, not teams), so it's derived from
-- who is named as head or assistant — the same source tournament staffing uses.
CREATE OR REPLACE FUNCTION public.is_my_team(p_team text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = p_team
      AND (public.is_me_coach(t.head_coach) OR public.is_me_coach(t.assistant_coach))
  ) OR EXISTS (
    SELECT 1 FROM public.practice_teams pt
    WHERE pt.team_name = p_team
      AND (public.is_me_coach(pt.head_coach) OR public.is_me_coach(pt.assistant_coach))
  );
$$;
REVOKE ALL ON FUNCTION public.is_my_team(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_my_team(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_my_team(text) TO authenticated;

ALTER TABLE public.player_evaluations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS player_evaluations_admin ON public.player_evaluations;
DROP POLICY IF EXISTS player_evaluations_team  ON public.player_evaluations;

CREATE POLICY player_evaluations_admin ON public.player_evaluations FOR ALL
  USING (public.is_admin_coach()) WITH CHECK (public.is_admin_coach());

-- A coach reads and writes evaluations for their own teams only.
CREATE POLICY player_evaluations_team ON public.player_evaluations FOR ALL
  USING (public.is_my_team(team_name)) WITH CHECK (public.is_my_team(team_name));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='player_evaluations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.player_evaluations;
  END IF;
END $$;
