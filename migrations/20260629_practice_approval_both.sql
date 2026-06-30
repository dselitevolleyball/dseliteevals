-- 20260629 — Practice approval requires BOTH coaches.
--
-- Adds approved_by (the canonical coach names who have approved). The schedule
-- is "approved" only when every listed coach (head + assistant) is in the list;
-- otherwise it stays pending. `approved` becomes the derived both-approved flag.
--
-- Run once in the Supabase SQL editor. Additive, non-destructive, idempotent.

ALTER TABLE public.practice_approvals
  ADD COLUMN IF NOT EXISTS approved_by TEXT[] NOT NULL DEFAULT '{}';
