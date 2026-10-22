-- DSSC Marketing Machine, round 4 (Drew, 23 Oct 2026): "If I upload videos
-- from meta glasses to the app - can you edit them and find cool videos to
-- cut together using the marketing tool?"
--
--   storage 'marketing-video'  the raw footage, PRIVATE (it's full of kids):
--                              directors upload (resumable) and play it back
--                              on short signed links; the server reads it
--                              with the service role. No size cap of its own
--                              (the project's limit applies - raise it after
--                              the Supabase Pro upgrade).
--   storage 'marketing'        now also takes the finished reels (MP4) and the
--                              music library (MP3 / M4A / WAV); the contact
--                              sheets, posters and moment thumbnails live here
--                              under videos/<id>/ like the photo uploads.
--   mkt_videos   one uploaded video: size, length, what's in it, and the
--                moments Claude found ([{ id, start, end, score, label,
--                description, tags, minors, thumb_url, skip }]).
--   mkt_music    tracks the club has the rights to (a director confirms on upload).
--   mkt_items    a reel is kind 'reel': video = the cut ({ clips: [{ video_id,
--                start, end, label }], music_id, music_volume, original_volume,
--                cards: { intro, outro, overlay } }), asset_video_url = the
--                rendered MP4, render_status / render_error / rendered_at.
--
-- Run after 20261024_marketing_ideas_spotlights.sql:
--   node scripts/run-sql.mjs migrations/20261025_marketing_video.sql
-- Additive and idempotent (safe to run twice).

CREATE TABLE IF NOT EXISTS public.mkt_videos (
  id           bigserial   PRIMARY KEY,
  path         text        NOT NULL UNIQUE,                 -- marketing-video/<path>
  filename     text,
  bytes        bigint,
  content_type text,
  source       text        NOT NULL DEFAULT 'upload',       -- glasses | phone | upload
  duration     numeric,                                      -- seconds
  width        int,
  height       int,
  has_audio    boolean,
  poster_url   text,
  sheets       jsonb       NOT NULL DEFAULT '[]'::jsonb,     -- [{ url, start, step, frames }]
  status       text        NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'analyzing', 'ready', 'failed')),
  line         text,
  tags         text[]      NOT NULL DEFAULT '{}',
  description  text,
  moments      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  minors       boolean,
  release_ok   boolean,
  active       boolean     NOT NULL DEFAULT true,
  used_count   int         NOT NULL DEFAULT 0,
  ai_at        timestamptz,
  ai_model     text,
  ai_error     text,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mkt_videos_status_idx ON public.mkt_videos (status, created_at DESC);
DROP TRIGGER IF EXISTS mkt_videos_touch ON public.mkt_videos;
CREATE TRIGGER mkt_videos_touch BEFORE UPDATE ON public.mkt_videos FOR EACH ROW EXECUTE FUNCTION public.mkt_touch();

CREATE TABLE IF NOT EXISTS public.mkt_music (
  id          bigserial   PRIMARY KEY,
  title       text        NOT NULL,
  artist      text,
  url         text        NOT NULL,
  path        text,
  duration    numeric,
  mood        text[]      NOT NULL DEFAULT '{}',            -- upbeat | hype | chill | warm | epic | fun
  rights_note text,                                          -- where the licence comes from
  rights_ok   boolean     NOT NULL DEFAULT false,            -- a director confirmed the club may use it
  active      boolean     NOT NULL DEFAULT true,
  used_count  int         NOT NULL DEFAULT 0,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mkt_items ADD COLUMN IF NOT EXISTS video           jsonb;
ALTER TABLE public.mkt_items ADD COLUMN IF NOT EXISTS asset_video_url text;
ALTER TABLE public.mkt_items ADD COLUMN IF NOT EXISTS render_status   text;   -- needs_render | rendering | rendered | failed
ALTER TABLE public.mkt_items ADD COLUMN IF NOT EXISTS render_error    text;
ALTER TABLE public.mkt_items ADD COLUMN IF NOT EXISTS rendered_at     timestamptz;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mkt_videos', 'mkt_music'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_director_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_director_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_director_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_director_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_dssc_director())', t || '_director_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_dssc_director())', t || '_director_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_dssc_director()) WITH CHECK (public.is_dssc_director())', t || '_director_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_dssc_director())', t || '_director_delete', t);
  END LOOP;
END $$;

-- Raw footage: private; directors upload and play back, nobody else reads it.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('marketing-video', 'marketing-video', false, NULL, ARRAY['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = NULL, allowed_mime_types = EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS "marketing_video_director_select" ON storage.objects;
DROP POLICY IF EXISTS "marketing_video_director_insert" ON storage.objects;
DROP POLICY IF EXISTS "marketing_video_director_update" ON storage.objects;
DROP POLICY IF EXISTS "marketing_video_director_delete" ON storage.objects;
CREATE POLICY "marketing_video_director_select" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'marketing-video' AND public.is_dssc_director());
CREATE POLICY "marketing_video_director_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'marketing-video' AND public.is_dssc_director());
CREATE POLICY "marketing_video_director_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'marketing-video' AND public.is_dssc_director()) WITH CHECK (bucket_id = 'marketing-video' AND public.is_dssc_director());
CREATE POLICY "marketing_video_director_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'marketing-video' AND public.is_dssc_director());

-- The public marketing bucket also holds finished reels and the music library.
UPDATE storage.buckets SET file_size_limit = 52428800,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav']
WHERE id = 'marketing';

SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id IN ('marketing', 'marketing-video') ORDER BY id;
