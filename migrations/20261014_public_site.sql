-- Public brand website (dselitevolleyball.com, Drew, 14 Oct 2026).
--
-- The website never touches the database: it reads one whitelisted JSON payload
-- from api/site-data.js (service role, server side) and posts its two forms to
-- api/site-optin.js and api/site-contact.js. These are the pieces of data the
-- site needs that did not exist yet:
--
--   site_staff        titles, bios, headshots and sort order for the people on
--                     the site. name = the roster name on practice_teams, so a
--                     coach with no row still lists (name + teams); leadership
--                     rows (Drew, Coach T, Kristen) list even without a team.
--                     Edited by admins in HQ -> Website.
--   players.site_hidden  a family's opt-out from the public roster.
--   site_inquiries    the website's contact form. Inserts come only from the
--                     service role (api/site-contact.js); admins read and mark
--                     handled in HQ. is_test rows come from testing (no email).
--   site-media        public bucket for staff photos (staff/<slug>.webp);
--                     admins upload from HQ, the seed uses the service role.
--
-- Run: node scripts/run-sql.mjs migrations/20261014_public_site.sql
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.site_staff (
  name         text        PRIMARY KEY,                 -- roster name (practice_teams head/assistant/third_coach)
  slug         text        NOT NULL UNIQUE,             -- 'mia-de-la-rosa' (the website's /coaches/<slug>)
  title        text,                                    -- 'Founder & Club Director'; NULL = just their teams
  bio          text,                                    -- plain text, paragraphs separated by a blank line
  photo_url    text,                                    -- absolute URL (site-media public bucket)
  leadership   boolean     NOT NULL DEFAULT false,      -- the managing team (/about/leadership)
  sort_order   int         NOT NULL DEFAULT 100,
  show_on_site boolean     NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text
);
ALTER TABLE public.site_staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_staff_read_auth ON public.site_staff;
CREATE POLICY site_staff_read_auth ON public.site_staff FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS site_staff_admin_all ON public.site_staff;
CREATE POLICY site_staff_admin_all ON public.site_staff FOR ALL
  USING (public.is_admin_coach()) WITH CHECK (public.is_admin_coach());

ALTER TABLE public.players ADD COLUMN IF NOT EXISTS site_hidden boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.site_inquiries (
  id          bigserial   PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  name        text        NOT NULL,
  email       text        NOT NULL,
  phone       text,
  player_name text,
  age_group   text,
  topic       text        NOT NULL DEFAULT 'general',   -- tryouts | general | coaching | other
  message     text        NOT NULL,
  ip          text,
  handled     boolean     NOT NULL DEFAULT false,
  handled_at  timestamptz,
  handled_by  text,
  emailed_at  timestamptz,                              -- when the notification to Drew went out
  is_test     boolean     NOT NULL DEFAULT false        -- x-site-test: 1 / body.test (never emailed)
);
CREATE INDEX IF NOT EXISTS site_inquiries_created_idx ON public.site_inquiries (created_at DESC);
ALTER TABLE public.site_inquiries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_inquiries_admin_read ON public.site_inquiries;
CREATE POLICY site_inquiries_admin_read ON public.site_inquiries FOR SELECT USING (public.is_admin_coach());
DROP POLICY IF EXISTS site_inquiries_admin_update ON public.site_inquiries;
CREATE POLICY site_inquiries_admin_update ON public.site_inquiries FOR UPDATE
  USING (public.is_admin_coach()) WITH CHECK (public.is_admin_coach());
-- No INSERT / DELETE policy: rows arrive only through the service role.

-- Public bucket for staff photos (pattern: 20261008_heatwave_coaches_public.sql),
-- writes limited to admins since only the admin-only Website screen uploads.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('site-media', 'site-media', true, 10485760, ARRAY['image/webp', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "site_media_admin_select" ON storage.objects;
DROP POLICY IF EXISTS "site_media_admin_insert" ON storage.objects;
DROP POLICY IF EXISTS "site_media_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "site_media_admin_delete" ON storage.objects;
CREATE POLICY "site_media_admin_select" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'site-media' AND public.is_admin_coach());
CREATE POLICY "site_media_admin_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'site-media' AND public.is_admin_coach());
CREATE POLICY "site_media_admin_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'site-media' AND public.is_admin_coach());
CREATE POLICY "site_media_admin_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'site-media' AND public.is_admin_coach());

SELECT tablename, policyname, cmd FROM pg_policies
 WHERE tablename IN ('site_staff', 'site_inquiries') OR policyname LIKE 'site_media_%' ORDER BY 1, 2;
