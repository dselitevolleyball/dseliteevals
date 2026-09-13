-- Daily email of new team photos.
--
-- Each photo is stamped the moment it goes out in a digest, so every photo is
-- in exactly one email: never skipped because it landed in a gap between two
-- time windows, never repeated because a run was retried.

ALTER TABLE public.player_photos
  ADD COLUMN IF NOT EXISTS digested_at timestamptz;
CREATE INDEX IF NOT EXISTS player_photos_undigested_idx
  ON public.player_photos (created_at) WHERE digested_at IS NULL;
