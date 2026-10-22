-- DSSC Marketing Machine, round 2 (Drew, 23 Oct 2026): the photo library gets
-- an AI librarian, and the planner follows the club's own marketing calendar
-- (Annual_Marketing_Table.xlsx) instead of four generic slots.
--
--   mkt_photos     what Claude sees in each photo: a description, who's in it,
--                  where it was taken, what it's good for (post, story, email
--                  banner, website hero, program card), a 1-5 quality score and
--                  whether recognizable kids are in it. release_ok records the
--                  director's answer for those: true = OK to post, false = never
--                  post it (the machine skips it), NULL = not checked yet.
--   mkt_items      kind  - post | story | follow_up | preview | roundup | dedicated | text
--                  theme - the content idea the planner gave the slot
--   mkt_settings   themes - the content ideas per line ({ line: [idea, ...] });
--                  empty = the built-in ideas from the calendar's notes
--
-- Run after 20261022_marketing.sql:
--   node scripts/run-sql.mjs migrations/20261023_marketing_rhythm_photos.sql
-- Additive and idempotent (safe to run twice).

ALTER TABLE public.mkt_photos ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.mkt_photos ADD COLUMN IF NOT EXISTS people      text;                       -- none | kids | teens | adults | mixed
ALTER TABLE public.mkt_photos ADD COLUMN IF NOT EXISTS setting     text;                       -- court | gym | party_room | outdoor | facility | event | other
ALTER TABLE public.mkt_photos ADD COLUMN IF NOT EXISTS uses        text[] NOT NULL DEFAULT '{}'; -- social_post | story | email_banner | website_hero | program_card
ALTER TABLE public.mkt_photos ADD COLUMN IF NOT EXISTS quality     smallint CHECK (quality IS NULL OR quality BETWEEN 1 AND 5);
ALTER TABLE public.mkt_photos ADD COLUMN IF NOT EXISTS minors      boolean;                    -- recognizable children in the photo
ALTER TABLE public.mkt_photos ADD COLUMN IF NOT EXISTS release_ok  boolean;
ALTER TABLE public.mkt_photos ADD COLUMN IF NOT EXISTS filename    text;
ALTER TABLE public.mkt_photos ADD COLUMN IF NOT EXISTS ai_at       timestamptz;
ALTER TABLE public.mkt_photos ADD COLUMN IF NOT EXISTS ai_model    text;
ALTER TABLE public.mkt_photos ADD COLUMN IF NOT EXISTS ai_error    text;
CREATE INDEX IF NOT EXISTS mkt_photos_ai_idx ON public.mkt_photos (ai_at NULLS FIRST) WHERE active;

-- Photos synced from the club website are already public there.
UPDATE public.mkt_photos SET release_ok = true WHERE source = 'site' AND release_ok IS NULL;

ALTER TABLE public.mkt_items ADD COLUMN IF NOT EXISTS kind  text;
ALTER TABLE public.mkt_items ADD COLUMN IF NOT EXISTS theme text;
UPDATE public.mkt_items SET kind = CASE channel WHEN 'email' THEN 'roundup' WHEN 'sms' THEN 'text' ELSE 'post' END WHERE kind IS NULL;

ALTER TABLE public.mkt_settings ADD COLUMN IF NOT EXISTS themes jsonb NOT NULL DEFAULT '{}'::jsonb;

SELECT (SELECT count(*) FROM public.mkt_photos) AS photos,
       (SELECT count(*) FROM public.mkt_photos WHERE release_ok) AS released,
       (SELECT count(*) FROM public.mkt_items) AS items;
