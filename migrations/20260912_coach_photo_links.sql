-- Coaches get their own photo upload link.
--
-- The photo page (/photos?t=…) only ever knew families: the token lived on a
-- player, so the team was fixed by the link and the credit fell back to her
-- parent. Coaches take as many of the good photos as anyone — from the bench,
-- at practice, in the hotel lobby — and had no way in.
--
-- Same page, same private bucket, same player_photos library. What differs:
--   coach_roster.photo_upload_token  a per-coach capability link, bookmarked
--                                    all season, like the families' one
--   player_photos.coach_id           who sent it, when a coach did; player_id
--                                    stays null for those rows

ALTER TABLE public.coach_roster
  ADD COLUMN IF NOT EXISTS photo_upload_token uuid;
UPDATE public.coach_roster
   SET photo_upload_token = gen_random_uuid()
 WHERE photo_upload_token IS NULL;
ALTER TABLE public.coach_roster
  ALTER COLUMN photo_upload_token SET DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS coach_roster_photo_upload_token_idx
  ON public.coach_roster (photo_upload_token);
COMMENT ON COLUMN public.coach_roster.photo_upload_token IS
  'Per-coach capability token for /photos?t=… . Bookmarked and reused all season, so never rotated casually.';

ALTER TABLE public.player_photos
  ADD COLUMN IF NOT EXISTS coach_id bigint REFERENCES public.coach_roster(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS player_photos_coach_idx ON public.player_photos (coach_id);
