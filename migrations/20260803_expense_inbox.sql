-- 20260803 — Receipts arriving by email, and an approval step before they count.
--
-- Anything auto-captured lands as 'pending' and is excluded from the finance
-- totals until Drew approves it. A parser that silently mis-reads an amount is
-- worse than one that asks, so nothing machine-read is trusted on arrival.
--
-- message_id dedupes: Gmail re-delivers, and Apps Script re-runs overlap.
--
-- Run: node scripts/run-sql.mjs migrations/20260803_expense_inbox.sql
-- Additive and idempotent.

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS status       TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS vendor       TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS message_id   TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS email_subject TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS raw_email    TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS captured_at  TIMESTAMPTZ;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS approved_by  TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ;

-- One row per team per receipt: a registration split across ten teams is ten
-- rows sharing a message_id, so the key includes the allocation.
CREATE UNIQUE INDEX IF NOT EXISTS expenses_message_alloc_uniq
  ON public.expenses (message_id, coalesce(allocation, '')) WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS expenses_status_idx ON public.expenses (status) WHERE status <> 'approved';

COMMENT ON COLUMN public.expenses.status IS 'pending (awaiting review) | approved (counts) | rejected (ignored)';
