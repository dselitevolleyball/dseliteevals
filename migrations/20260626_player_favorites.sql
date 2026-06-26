-- 20260626 — Per-coach player favorites.
--
-- Each coach keeps a private shortlist of players (a "favorites" board, ~10
-- players). RLS scopes every row to the signed-in coach, so a coach can only
-- ever see / change their OWN favorites — never anyone else's.
--
-- Run once in the Supabase SQL editor. Additive, non-destructive.

CREATE TABLE IF NOT EXISTS public.player_favorites (
  coach_id    UUID   NOT NULL,                       -- = auth.uid()
  player_id   BIGINT NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (coach_id, player_id)
);

CREATE INDEX IF NOT EXISTS player_favorites_coach_idx ON public.player_favorites(coach_id);

ALTER TABLE public.player_favorites ENABLE ROW LEVEL SECURITY;

-- Coach-specific: each coach reads and writes only their own rows.
DROP POLICY IF EXISTS "own_select_favorites" ON public.player_favorites;
DROP POLICY IF EXISTS "own_modify_favorites" ON public.player_favorites;
CREATE POLICY "own_select_favorites" ON public.player_favorites
  FOR SELECT USING (coach_id = auth.uid());
CREATE POLICY "own_modify_favorites" ON public.player_favorites
  FOR ALL USING (coach_id = auth.uid()) WITH CHECK (coach_id = auth.uid());
