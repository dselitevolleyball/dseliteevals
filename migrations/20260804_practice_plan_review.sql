-- Migration: send a practice plan for review.
-- Date: 2026-08-04  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260804_practice_plan_review.sql
--
-- Same shape as the DSSC clinic plan review that already works: a coach drafts,
-- submits, and a director approves or asks for changes. Kept separate from the
-- existing `status` column (draft | done), which tracks whether the coach has
-- finished writing — not whether anybody has read it.
--
-- The uploaded original is kept alongside the parsed blocks. Reading a plan
-- means seeing what the coach actually wrote, not only what the parser made of
-- it — api/read-practice-plan.js is good but it is still an interpretation.

ALTER TABLE public.practice_plans ADD COLUMN IF NOT EXISTS plan_status      text NOT NULL DEFAULT 'draft';
ALTER TABLE public.practice_plans ADD COLUMN IF NOT EXISTS submitted_by     text;
ALTER TABLE public.practice_plans ADD COLUMN IF NOT EXISTS submitted_at     timestamptz;
ALTER TABLE public.practice_plans ADD COLUMN IF NOT EXISTS reviewed_by      text;
ALTER TABLE public.practice_plans ADD COLUMN IF NOT EXISTS reviewed_at      timestamptz;
ALTER TABLE public.practice_plans ADD COLUMN IF NOT EXISTS review_notes     text;
ALTER TABLE public.practice_plans ADD COLUMN IF NOT EXISTS source_file_path text;
ALTER TABLE public.practice_plans ADD COLUMN IF NOT EXISTS source_file_name text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practice_plans_plan_status_chk') THEN
    ALTER TABLE public.practice_plans ADD CONSTRAINT practice_plans_plan_status_chk
      CHECK (plan_status IN ('draft','submitted','approved','changes'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS practice_plans_review_idx ON public.practice_plans(plan_status, practice_date);

COMMENT ON COLUMN public.practice_plans.plan_status IS
  'draft → submitted → approved | changes. Separate from status (draft|done), which is about whether the coach finished writing it.';

-- The uploaded original. Private: a plan is internal coaching material, and
-- some are photos of a whiteboard with player names on them.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('plan-docs', 'plan-docs', false, 15728640,
        ARRAY['image/jpeg','image/png','image/heic','image/webp','application/pdf',
              'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = 15728640, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS plan_docs_insert_own ON storage.objects;
DROP POLICY IF EXISTS plan_docs_read       ON storage.objects;
DROP POLICY IF EXISTS plan_docs_admin_all  ON storage.objects;

-- Coaches file under their own uid…
CREATE POLICY plan_docs_insert_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'plan-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

-- …but any approved coach can READ one. Unlike a receipt, a practice plan is
-- meant to be shared — that is the entire point of sending it for review.
CREATE POLICY plan_docs_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'plan-docs');

CREATE POLICY plan_docs_admin_all ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'plan-docs' AND public.is_admin_coach())
  WITH CHECK (bucket_id = 'plan-docs' AND public.is_admin_coach());
