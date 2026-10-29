-- Marketing → Videos: collections (Drew, 29 Oct 2026: "group multiple video
-- break downs to analyze and make a reel from - last night I took 6 videos
-- from a Hitting Pod, I want to add them all to 1 collection to make a couple
-- of reels from").
--
--   mkt_video_collections  a named group of uploaded videos (video_ids), and
--                          Claude's read of them together (plan): a summary
--                          and a few reel ideas, each a set of moments picked
--                          across the videos ({ summary, ideas: [{ id, title,
--                          angle, picks: [{ video_id, moment_id }], reel_id }] }).
--
-- Run after 20261025_marketing_video.sql:
--   node scripts/run-sql.mjs migrations/20261113_video_collections.sql
-- Additive and idempotent (safe to run twice).

CREATE TABLE IF NOT EXISTS public.mkt_video_collections (
  id          bigserial   PRIMARY KEY,
  name        text        NOT NULL,
  line        text,
  notes       text,                                         -- what to look for, e.g. "show the arm swing"
  video_ids   bigint[]    NOT NULL DEFAULT '{}',
  plan        jsonb,
  plan_at     timestamptz,
  active      boolean     NOT NULL DEFAULT true,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mkt_video_collections_created_idx ON public.mkt_video_collections (created_at DESC);
DROP TRIGGER IF EXISTS mkt_video_collections_touch ON public.mkt_video_collections;
CREATE TRIGGER mkt_video_collections_touch BEFORE UPDATE ON public.mkt_video_collections FOR EACH ROW EXECUTE FUNCTION public.mkt_touch();

ALTER TABLE public.mkt_video_collections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mkt_video_collections_director_select ON public.mkt_video_collections;
DROP POLICY IF EXISTS mkt_video_collections_director_insert ON public.mkt_video_collections;
DROP POLICY IF EXISTS mkt_video_collections_director_update ON public.mkt_video_collections;
DROP POLICY IF EXISTS mkt_video_collections_director_delete ON public.mkt_video_collections;
CREATE POLICY mkt_video_collections_director_select ON public.mkt_video_collections FOR SELECT TO authenticated USING (public.is_dssc_director());
CREATE POLICY mkt_video_collections_director_insert ON public.mkt_video_collections FOR INSERT TO authenticated WITH CHECK (public.is_dssc_director());
CREATE POLICY mkt_video_collections_director_update ON public.mkt_video_collections FOR UPDATE TO authenticated USING (public.is_dssc_director()) WITH CHECK (public.is_dssc_director());
CREATE POLICY mkt_video_collections_director_delete ON public.mkt_video_collections FOR DELETE TO authenticated USING (public.is_dssc_director());

SELECT count(*) AS collections FROM public.mkt_video_collections;
