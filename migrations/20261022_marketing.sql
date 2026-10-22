-- DSSC Marketing Machine (Drew, 22 Oct 2026): "an automated marketing
-- machine" in DSSC HQ that plans and drafts Facebook + Instagram posts, a
-- weekly email and the occasional text from the programs feed, lets a
-- director edit / ask for changes / approve, and publishes approved items on
-- schedule. Nothing goes out without a director's approval.
--
--   mkt_settings      one row (id = 1): brand voice notes, line weights, cadence,
--                     auto-generate day, email audience, default text audience,
--                     who gets the "drafts are ready" email
--   mkt_priorities    what matters right now ("Thanksgiving break - push Camp
--                     Elevate"): lines (first = the headline line), weight 1-5,
--                     window, channels; avoid_lines for "less of X" asks
--   mkt_items         every draft / approved / published post, email and text
--   mkt_photos        the photo library graphics are built from (site photos.json,
--                     uploads, class photos)
--   mkt_unsubscribes  addresses that left the marketing email
--   mkt_log           what the machine did (generate, publish, sync, errors)
--   storage 'marketing'  rendered graphics (items/<id>/<ts>.png) and uploads
--
-- Directors (public.is_dssc_director(), from 20261020_site_inbox.sql) read and
-- write every table with their own session; the API and cron use the service
-- role. Run after 20261020_site_inbox.sql:
--   node scripts/run-sql.mjs migrations/20261022_marketing.sql
-- Additive and idempotent (safe to run twice).

-- ── settings ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mkt_settings (
  id             int         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  voice          text        NOT NULL DEFAULT '',
  weights        jsonb       NOT NULL DEFAULT '{"volleyball":3,"basketball":3,"reach":2,"camp_elevate":2,"parties":2,"rentals":1,"open_gym":1,"club":1}'::jsonb,
  cadence        jsonb       NOT NULL DEFAULT '{"social":{"per_week":4,"days":["mon","wed","fri","sat"],"time":"18:30"},"email":{"day":"thu","time":"07:30"},"sms":{"per_month":2,"time":"17:30"}}'::jsonb,
  auto_generate  boolean     NOT NULL DEFAULT true,
  generate_day   text        NOT NULL DEFAULT 'sun',
  email_audience jsonb       NOT NULL DEFAULT '{"source":"dssc_contacts"}'::jsonb,
  sms_filters    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  notify_emails  text[]      NOT NULL DEFAULT '{drew@drippingsportsclub.com}',
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text
);
INSERT INTO public.mkt_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── priorities ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mkt_priorities (
  id          bigserial   PRIMARY KEY,
  title       text        NOT NULL,
  notes       text        NOT NULL DEFAULT '',
  lines       text[]      NOT NULL DEFAULT '{}',          -- first = the headline line
  avoid_lines text[]      NOT NULL DEFAULT '{}',          -- "less volleyball" asks
  weight      int         NOT NULL DEFAULT 3 CHECK (weight BETWEEN 1 AND 5),
  starts_on   date,
  ends_on     date,
  channels    text[]      NOT NULL DEFAULT '{social,email,sms}',
  active      boolean     NOT NULL DEFAULT true,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mkt_priorities ADD COLUMN IF NOT EXISTS avoid_lines text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS mkt_priorities_window_idx ON public.mkt_priorities (active, starts_on, ends_on);

INSERT INTO public.mkt_priorities (title, notes, lines, weight, starts_on, ends_on, channels, active, created_by)
SELECT 'Thanksgiving break — push Camp Elevate',
       'Thanksgiving break (Nov 23–25): push Camp Elevate hard, plus the volleyball and basketball break camps/clinics. Camp Elevate is a full-day, every-sport camp — pick one day or all three.',
       '{camp_elevate,volleyball,basketball}', 5, '2026-10-26', '2026-11-24', '{social,email,sms}', true, 'drew@drippingsportsclub.com'
WHERE NOT EXISTS (SELECT 1 FROM public.mkt_priorities WHERE title = 'Thanksgiving break — push Camp Elevate');

-- ── items ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mkt_items (
  id              bigserial   PRIMARY KEY,
  week_of         date        NOT NULL,                         -- the Monday
  channel         text        NOT NULL CHECK (channel IN ('social', 'email', 'sms')),
  platforms       text[]      NOT NULL DEFAULT '{facebook,instagram}',
  line            text,
  program         jsonb,                                        -- {id,name,url,first_date,status,sport,...}
  programs        jsonb       NOT NULL DEFAULT '[]'::jsonb,     -- email: several
  reason          text,
  angle           text,                                         -- starting_soon|new|just_started|evergreen|priority|reminder|last_call
  status          text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'publishing', 'published', 'failed', 'rejected')),
  scheduled_at    timestamptz,
  headline        text,
  body            text,                                         -- caption / text / email intro
  email_subject   text,
  email_preheader text,
  email_html      text,
  email_blocks    jsonb       NOT NULL DEFAULT '[]'::jsonb,     -- email: [{program_id,title,date_label,blurb,url,cta}] the html is built from
  cta_text        text,
  cta_url         text,
  hashtags        text[]      NOT NULL DEFAULT '{}',
  graphic         jsonb,
  asset_url       text,
  asset_story_url text,
  audience        jsonb,
  sms_campaign_id bigint,
  external_ids    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  error           text,
  revisions       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_by      text        NOT NULL DEFAULT 'auto',
  approved_by     text,
  approved_at     timestamptz,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mkt_items ADD COLUMN IF NOT EXISTS email_blocks jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS mkt_items_week_idx ON public.mkt_items (week_of, channel);
CREATE INDEX IF NOT EXISTS mkt_items_due_idx  ON public.mkt_items (status, scheduled_at);

-- ── photos ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mkt_photos (
  id           bigserial   PRIMARY KEY,
  url          text        NOT NULL UNIQUE,
  source       text        NOT NULL DEFAULT 'site',             -- site | upload | class
  key          text,
  tags         text[]      NOT NULL DEFAULT '{}',
  line         text,
  alt          text,
  width        int,
  height       int,
  active       boolean     NOT NULL DEFAULT true,
  used_count   int         NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mkt_photos_line_idx ON public.mkt_photos (active, line);

-- ── unsubscribes / log ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mkt_unsubscribes (
  email      text        PRIMARY KEY,                           -- lower-cased
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mkt_log (
  id      bigserial   PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  item_id bigint,
  kind    text        NOT NULL,                                 -- generate | auto_generate | publish | publish_error | photos_sync | digest | revise | brief | approve | test
  detail  jsonb       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS mkt_log_kind_idx ON public.mkt_log (kind, at DESC);
CREATE INDEX IF NOT EXISTS mkt_log_item_idx ON public.mkt_log (item_id, at DESC) WHERE item_id IS NOT NULL;

-- ── updated_at on every change (the app may update with its own session) ─────
CREATE OR REPLACE FUNCTION public.mkt_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS mkt_settings_touch ON public.mkt_settings;
CREATE TRIGGER mkt_settings_touch BEFORE UPDATE ON public.mkt_settings FOR EACH ROW EXECUTE FUNCTION public.mkt_touch();
DROP TRIGGER IF EXISTS mkt_priorities_touch ON public.mkt_priorities;
CREATE TRIGGER mkt_priorities_touch BEFORE UPDATE ON public.mkt_priorities FOR EACH ROW EXECUTE FUNCTION public.mkt_touch();
DROP TRIGGER IF EXISTS mkt_items_touch ON public.mkt_items;
CREATE TRIGGER mkt_items_touch BEFORE UPDATE ON public.mkt_items FOR EACH ROW EXECUTE FUNCTION public.mkt_touch();

-- ── row-level security: DSSC directors, all four verbs, every mkt_* table ────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mkt_settings', 'mkt_priorities', 'mkt_items', 'mkt_photos', 'mkt_unsubscribes', 'mkt_log'] LOOP
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

-- ── storage: public bucket for rendered graphics and uploaded photos ─────────
-- Public URLs (Meta and email clients fetch the PNG); only directors write.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('marketing', 'marketing', true, 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS "marketing_public_read"     ON storage.objects;
DROP POLICY IF EXISTS "marketing_director_insert" ON storage.objects;
DROP POLICY IF EXISTS "marketing_director_update" ON storage.objects;
DROP POLICY IF EXISTS "marketing_director_delete" ON storage.objects;
CREATE POLICY "marketing_public_read"     ON storage.objects FOR SELECT USING (bucket_id = 'marketing');
CREATE POLICY "marketing_director_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'marketing' AND public.is_dssc_director());
CREATE POLICY "marketing_director_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'marketing' AND public.is_dssc_director()) WITH CHECK (bucket_id = 'marketing' AND public.is_dssc_director());
CREATE POLICY "marketing_director_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'marketing' AND public.is_dssc_director());

SELECT tablename, policyname, cmd FROM pg_policies
 WHERE tablename LIKE 'mkt\_%' OR policyname LIKE 'marketing\_%' ORDER BY 1, 2;
