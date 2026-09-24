-- Migration: DSSC coach hub — a class-by-class view of clinics & pods.
-- Date: 2026-09-24  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260924_dssc_class_hub.sql
--
-- A "class" is one session of a clinic (dssc_clinics.sessions[].id). Everything
-- here hangs off (clinic_id, session_id) so a coach sees the roster, the media
-- and the messages for the class in front of them, not the whole program.
-- Session ids come from the Playbook sync (p<program>-<date>-<HHMM>) and the
-- merge keeps them across re-syncs, so these rows stay attached.

-- ── Who is signed up ────────────────────────────────────────────────────────
-- Fed from Playbook registrations (Drew is wiring that up); coaches can also add
-- a walk-in by hand. session_id NULL = signed up for the whole program, which
-- is how Playbook sells most pods, so a class shows program-wide rows plus any
-- rows pinned to that session.
CREATE TABLE IF NOT EXISTS public.dssc_pod_roster (
  id             BIGSERIAL PRIMARY KEY,
  clinic_id      BIGINT NOT NULL REFERENCES public.dssc_clinics(id) ON DELETE CASCADE,
  session_id     TEXT,                              -- NULL = every session of the program
  player_name    TEXT NOT NULL,
  parent_name    TEXT,
  parent_email   TEXT,
  parent_phone   TEXT,
  sms_consent    BOOLEAN NOT NULL DEFAULT false,    -- only texted when true (10DLC)
  age            TEXT,
  notes          TEXT,
  source         TEXT NOT NULL DEFAULT 'manual',    -- playbook | manual
  source_ref     TEXT,                              -- Playbook registration id (dedupe)
  added_by       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dssc_pod_roster_clinic_idx ON public.dssc_pod_roster(clinic_id, session_id);
-- Plain (not partial) so PostgREST can use it as an ON CONFLICT target; NULLs are distinct anyway.
DROP INDEX IF EXISTS public.dssc_pod_roster_source_ref_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS dssc_pod_roster_source_ref_uniq ON public.dssc_pod_roster(source_ref);
ALTER TABLE public.dssc_pod_roster ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_dssc_pod_roster" ON public.dssc_pod_roster;
CREATE POLICY "auth_all_dssc_pod_roster" ON public.dssc_pod_roster FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Per-player attendance rides on the existing pod attendance row (which holds
-- the headcount that drives pay). `present` is the roster ids who showed.
ALTER TABLE public.dssc_pod_attendance ADD COLUMN IF NOT EXISTS present JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ── Pictures & video for one class ─────────────────────────────────────────
-- Public bucket: the whole point is that a parent taps a link in a text or an
-- email and it opens. Paths carry a random id so nothing is guessable.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('dssc-media', 'dssc-media', true, 104857600,
        ARRAY['image/jpeg','image/png','image/heic','image/heif','image/webp','image/gif','video/mp4','video/quicktime','video/webm'])
ON CONFLICT (id) DO UPDATE
  SET public = true, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "dssc_media_auth_upload" ON storage.objects;
CREATE POLICY "dssc_media_auth_upload" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'dssc-media');
DROP POLICY IF EXISTS "dssc_media_auth_delete" ON storage.objects;
CREATE POLICY "dssc_media_auth_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'dssc-media');
DROP POLICY IF EXISTS "dssc_media_public_read" ON storage.objects;
CREATE POLICY "dssc_media_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'dssc-media');

CREATE TABLE IF NOT EXISTS public.dssc_class_media (
  id             BIGSERIAL PRIMARY KEY,
  clinic_id      BIGINT NOT NULL REFERENCES public.dssc_clinics(id) ON DELETE CASCADE,
  session_id     TEXT NOT NULL,
  storage_path   TEXT NOT NULL UNIQUE,
  kind           TEXT NOT NULL DEFAULT 'image',     -- image | video
  content_type   TEXT,
  bytes          BIGINT,
  caption        TEXT,
  uploaded_by    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at        TIMESTAMPTZ                        -- last time it went out to the class
);
CREATE INDEX IF NOT EXISTS dssc_class_media_class_idx ON public.dssc_class_media(clinic_id, session_id);
ALTER TABLE public.dssc_class_media ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_dssc_class_media" ON public.dssc_class_media;
CREATE POLICY "auth_all_dssc_class_media" ON public.dssc_class_media FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- ── What went out to the class ──────────────────────────────────────────────
-- One row per send (not per recipient). Written by api/dssc-class-message.js.
CREATE TABLE IF NOT EXISTS public.dssc_class_messages (
  id             BIGSERIAL PRIMARY KEY,
  clinic_id      BIGINT NOT NULL REFERENCES public.dssc_clinics(id) ON DELETE CASCADE,
  session_id     TEXT NOT NULL,
  body           TEXT NOT NULL,
  media_ids      JSONB NOT NULL DEFAULT '[]'::jsonb,
  sent_by        TEXT,
  emails_sent    INT NOT NULL DEFAULT 0,
  texts_sent     INT NOT NULL DEFAULT 0,
  texts_skipped  INT NOT NULL DEFAULT 0,            -- had a phone but no consent, or texting not live yet
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dssc_class_messages_class_idx ON public.dssc_class_messages(clinic_id, session_id);
ALTER TABLE public.dssc_class_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_dssc_class_messages" ON public.dssc_class_messages;
CREATE POLICY "auth_all_dssc_class_messages" ON public.dssc_class_messages FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
