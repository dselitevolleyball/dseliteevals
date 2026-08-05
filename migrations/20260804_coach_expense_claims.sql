-- Migration: coaches claim tournament expenses back, with a receipt.
-- Date: 2026-08-04  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260804_coach_expense_claims.sql
--
-- Deliberately the SAME table as club spend rather than a parallel one. An
-- expense is an expense: it already carries tournament_id, season, category,
-- team allocation, status and reimbursed, and the finance screen and the
-- accountant report already read it. A second table would mean two review
-- queues and two things to remember to send.
--
-- What's new is who asked and what they're standing on: a submitter, the person
-- owed, and a receipt image.

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS submitted_by       text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS submitted_by_email text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS submitted_at       timestamptz;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS reimburse_to       text;   -- who gets paid back
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS receipt_path       text;   -- storage object path
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS receipt_name       text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS reject_note        text;

COMMENT ON COLUMN public.expenses.submitted_by IS
  'Coach who claimed this back. NULL means club spend captured from email, not a claim.';
COMMENT ON COLUMN public.expenses.receipt_path IS
  'Object path in the private "receipts" bucket. Signed URLs only — never public.';

CREATE INDEX IF NOT EXISTS expenses_submitted_idx ON public.expenses(submitted_by, status);

-- ── Receipts live in a PRIVATE bucket ──────────────────────────────────────
-- A receipt carries a name, a card tail and sometimes an address. The existing
-- email-images bucket is public, so it must not be reused for these.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('receipts', 'receipts', false, 10485760,
        ARRAY['image/jpeg','image/png','image/heic','image/webp','application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = 10485760,
      allowed_mime_types = ARRAY['image/jpeg','image/png','image/heic','image/webp','application/pdf'];

-- Objects are filed under the submitter's uid, which is what the policies key on.
DROP POLICY IF EXISTS receipts_insert_own ON storage.objects;
DROP POLICY IF EXISTS receipts_read_own   ON storage.objects;
DROP POLICY IF EXISTS receipts_admin_all  ON storage.objects;

CREATE POLICY receipts_insert_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY receipts_read_own ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY receipts_admin_all ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'receipts' AND public.is_admin_coach())
  WITH CHECK (bucket_id = 'receipts' AND public.is_admin_coach());

-- ── A coach sees and files only their own claims ───────────────────────────
-- expenses_admin (ALL / is_admin_coach) stays as it is; these are additive and
-- must never expose club spend to a coach.
DROP POLICY IF EXISTS expenses_claim_read   ON public.expenses;
DROP POLICY IF EXISTS expenses_claim_insert ON public.expenses;
DROP POLICY IF EXISTS expenses_claim_update ON public.expenses;

CREATE POLICY expenses_claim_read ON public.expenses FOR SELECT
  USING (submitted_by IS NOT NULL AND public.is_me_coach(submitted_by));

-- Filed in their own name, and pending. A coach cannot post an approved row.
CREATE POLICY expenses_claim_insert ON public.expenses FOR INSERT
  WITH CHECK (submitted_by IS NOT NULL AND public.is_me_coach(submitted_by) AND status = 'pending');

-- Correctable only while it is still pending, and it must stay pending —
-- otherwise "edit" becomes "approve my own money".
CREATE POLICY expenses_claim_update ON public.expenses FOR UPDATE
  USING (submitted_by IS NOT NULL AND public.is_me_coach(submitted_by) AND status = 'pending')
  WITH CHECK (submitted_by IS NOT NULL AND public.is_me_coach(submitted_by) AND status = 'pending');
