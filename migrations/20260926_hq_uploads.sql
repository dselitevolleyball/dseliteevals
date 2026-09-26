-- Migration: files attached to Ask HQ questions.
-- Date: 2026-09-26  Idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260926_hq_uploads.sql
--
-- An admin can drop a PDF, a screenshot, a CSV or a text file into the Ask HQ
-- panel with their question — a housing pickup report, a Playbook export, an
-- invoice. The browser uploads it here (private bucket), the endpoint hands
-- Claude a short-lived signed URL, and the file stays so the same document
-- can be asked about again.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('hq-uploads', 'hq-uploads', false, 26214400,
        ARRAY['application/pdf','image/jpeg','image/png','image/webp','image/gif','image/heic','text/plain','text/csv','text/markdown','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/json'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "hq_uploads_auth_insert" ON storage.objects;
CREATE POLICY "hq_uploads_auth_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'hq-uploads');
DROP POLICY IF EXISTS "hq_uploads_auth_read" ON storage.objects;
CREATE POLICY "hq_uploads_auth_read" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'hq-uploads');

ALTER TABLE public.hq_assistant_log ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
