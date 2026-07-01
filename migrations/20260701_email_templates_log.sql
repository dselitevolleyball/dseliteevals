-- 20260701 — Move email templates off localStorage into Supabase (so they sync
-- across devices), and add a shared sent-email history log.
--
-- Run ONCE in the Supabase SQL editor. Additive, non-destructive, idempotent.

-- ── Shared email templates (subject + body, keyed by name) ──────────────
CREATE TABLE IF NOT EXISTS public.email_templates (
  name       TEXT         PRIMARY KEY,
  subject    TEXT         NOT NULL DEFAULT '',
  body       TEXT         NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_templates_all_approved ON public.email_templates;
CREATE POLICY email_templates_all_approved ON public.email_templates
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

-- ── Sent-email history ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_log (
  id              BIGSERIAL    PRIMARY KEY,
  subject         TEXT         NOT NULL DEFAULT '',
  body            TEXT         NOT NULL DEFAULT '',
  recipient_count INTEGER      NOT NULL DEFAULT 0,
  recipients      TEXT[]       NOT NULL DEFAULT '{}',
  sent_count      INTEGER,
  failed_count    INTEGER      NOT NULL DEFAULT 0,
  sent_by         TEXT,
  sent_by_email   TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_log_all_approved ON public.email_log;
CREATE POLICY email_log_all_approved ON public.email_log
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));
CREATE INDEX IF NOT EXISTS email_log_created_idx ON public.email_log (created_at DESC);

-- ── Realtime (so both sync live across devices) ─────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='email_templates') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.email_templates;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='email_log') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.email_log;
  END IF;
END $$;
