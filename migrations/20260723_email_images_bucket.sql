-- Migration: a public Storage bucket for images embedded in outgoing emails.
-- Email clients need a real public URL (they strip base64/blobs), so composer
-- images are uploaded here and referenced by their public URL.
-- Date: 2026-07-23. Idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260723_email_images_bucket.sql

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('email-images', 'email-images', true, 10485760, ARRAY['image/png','image/jpeg','image/gif','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 10485760, allowed_mime_types = ARRAY['image/png','image/jpeg','image/gif','image/webp'];

-- Signed-in coaches may upload; anyone may read (bucket is public).
DROP POLICY IF EXISTS "email_images_auth_upload" ON storage.objects;
CREATE POLICY "email_images_auth_upload" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'email-images');

DROP POLICY IF EXISTS "email_images_public_read" ON storage.objects;
CREATE POLICY "email_images_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'email-images');
