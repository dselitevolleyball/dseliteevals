-- Migration: record what was attached to a sent email.
-- Date: 2026-08-05  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260805_email_attachments.sql
--
-- Names only, not the files. The attachment goes out with the email; keeping a
-- second copy in the database would double the storage for no benefit, but a
-- recipient reading the message in the app should still see that something was
-- attached and what it was called.

ALTER TABLE public.email_log ADD COLUMN IF NOT EXISTS attachment_names text[];

COMMENT ON COLUMN public.email_log.attachment_names IS
  'Filenames attached to this send. The files themselves live in the recipients'' mailboxes, not here.';
