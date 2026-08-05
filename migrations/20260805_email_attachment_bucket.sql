-- Migration: a bucket for outgoing email attachments.
-- Date: 2026-08-05  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260805_email_attachment_bucket.sql
--
-- Attachments were posted to /api/send-email as base64 inside the JSON body.
-- Vercel caps a serverless request body at 4.5MB and base64 inflates a file by
-- about 37%, so anything over ~3MB got a plain-text 413 back — which then blew
-- up as "Unexpected token 'R'" when the client tried to parse it as JSON.
--
-- The file now goes to storage and only its path is posted; the server fetches
-- it with the service role. The request body stays tiny no matter the file.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('email-attachments', 'email-attachments', false, 26214400)   -- 25MB
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 26214400;

DROP POLICY IF EXISTS email_att_insert ON storage.objects;
DROP POLICY IF EXISTS email_att_read   ON storage.objects;

-- Anyone who can send email can stage a file under their own uid.
CREATE POLICY email_att_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'email-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY email_att_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'email-attachments' AND
         ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin_coach()));
