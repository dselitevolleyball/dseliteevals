-- DSSC Marketing Machine, round 3 (Drew, 23 Oct 2026): "recommend posts based
-- on your own logic, time of year, holidays, news worthy items and add some
-- flair" and "reach out to a coach and ask interview questions and get fun
-- pictures and then add that to an email series ... that you can run on your
-- own with a quick approval or feedback loop for me".
--
--   mkt_ideas        the idea scout's suggestions (api/_lib/marketing-scout.js):
--                    a season / holiday / local-news / club-news / fun idea with
--                    the pitch, a hook, the line, channel, format and best day.
--                    A director makes it (-> a draft in mkt_items) or turns it
--                    down with a reason; the reasons are fed back to the scout.
--   mkt_spotlights   a coach interview (api/_lib/marketing-spotlight.js): who,
--                    the questions, the link token, the answers and photos that
--                    came back, and the drafts made from them (a quote post, a
--                    story and a "Meet the Coaches" email, episode n).
--   mkt_settings     flair (0 plain, 1 some personality, 2 bold) and scout
--                    ({ enabled, day, web, spotlight_every_weeks, via }).
--
-- Directors read and write both tables with their own session; the coach's
-- interview page and the cron use the service role.
-- Run after 20261023_marketing_rhythm_photos.sql:
--   node scripts/run-sql.mjs migrations/20261024_marketing_ideas_spotlights.sql
-- Additive and idempotent (safe to run twice).

CREATE TABLE IF NOT EXISTS public.mkt_ideas (
  id           bigserial   PRIMARY KEY,
  batch        text,                                    -- the scout run it came from (YYYY-MM-DD or 'ask:<at>')
  kind         text        NOT NULL DEFAULT 'fun',      -- season | holiday | local | club | program | spotlight | fun
  title        text        NOT NULL,
  pitch        text        NOT NULL DEFAULT '',         -- what to post and why now
  hook         text,                                    -- the flair: the opening line / format to try
  line         text,
  channel      text        NOT NULL DEFAULT 'social' CHECK (channel IN ('social', 'email', 'sms')),
  format       text        NOT NULL DEFAULT 'post',     -- post | story | email
  best_day     date,
  sources      jsonb       NOT NULL DEFAULT '[]'::jsonb, -- [{ title, url }]
  status       text        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'dismissed', 'expired')),
  feedback     text,
  item_id      bigint,
  spotlight_id bigint,
  created_by   text        NOT NULL DEFAULT 'scout',
  decided_by   text,
  decided_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mkt_ideas_status_idx ON public.mkt_ideas (status, best_day);

CREATE TABLE IF NOT EXISTS public.mkt_spotlights (
  id          bigserial   PRIMARY KEY,
  name        text        NOT NULL,
  email       text,
  phone       text,
  role        text,                                    -- "Director of Volleyball", "Skill pod coach"
  line        text,
  series      text        NOT NULL DEFAULT 'Meet the Coaches',
  episode     int,
  intro       text,                                    -- the note at the top of the coach's page
  questions   jsonb       NOT NULL DEFAULT '[]'::jsonb, -- [{ q, a? }]
  photos      jsonb       NOT NULL DEFAULT '[]'::jsonb, -- [{ url, path, caption }]
  token       uuid        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status      text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'answered', 'drafted', 'declined', 'cancelled')),
  consent     boolean,                                 -- the coach agreed the answers and photos can be shared
  sent_via    text[]      NOT NULL DEFAULT '{}',
  sent_at     timestamptz,
  reminded_at timestamptz,
  answered_at timestamptz,
  item_ids    bigint[]    NOT NULL DEFAULT '{}',
  error       text,
  created_by  text,
  approved_by text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mkt_spotlights_status_idx ON public.mkt_spotlights (status, created_at DESC);
DROP TRIGGER IF EXISTS mkt_spotlights_touch ON public.mkt_spotlights;
CREATE TRIGGER mkt_spotlights_touch BEFORE UPDATE ON public.mkt_spotlights FOR EACH ROW EXECUTE FUNCTION public.mkt_touch();

ALTER TABLE public.mkt_settings ADD COLUMN IF NOT EXISTS flair int NOT NULL DEFAULT 1 CHECK (flair BETWEEN 0 AND 2);
ALTER TABLE public.mkt_settings ADD COLUMN IF NOT EXISTS scout jsonb NOT NULL DEFAULT '{"enabled":true,"day":"sat","web":true,"spotlight_every_weeks":2,"via":["email","sms"]}'::jsonb;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mkt_ideas', 'mkt_spotlights'] LOOP
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

SELECT tablename, count(*) AS policies FROM pg_policies WHERE tablename IN ('mkt_ideas', 'mkt_spotlights') GROUP BY 1 ORDER BY 1;
