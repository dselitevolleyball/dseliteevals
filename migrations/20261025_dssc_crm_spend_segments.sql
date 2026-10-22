-- Migration: the DSSC CRM grows up — spend, email segments, old mailing lists,
-- and what happened to every marketing email.
-- Date: 2026-10-25  Additive, idempotent. Run after 20261022_marketing.sql.
-- Run: node scripts/run-sql.mjs migrations/20261025_dssc_crm_spend_segments.sql
--
--   dssc_purchases     what each family bought on Playbook, at list price, from
--                      the registrations report with prices (Reports →
--                      Registrations: invoice_number, registration_base_price).
--                      One row per invoice × person × program; re-importing an
--                      overlapping date range replaces, never doubles.
--   dssc_segments      saved email audiences ("girls 10–13 who did volleyball
--                      but nothing since August, spent $200+")
--   mkt_email_events   bounces, spam complaints, opens and clicks from Resend
--   dssc_contacts      + email_status (ok | bounced | complained | invalid),
--                      + lists[] (the old mailing lists an address came from),
--                      + last_emailed_at / last_opened_at / last_clicked_at

-- ── purchases ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dssc_purchases (
  id             BIGSERIAL PRIMARY KEY,
  source         TEXT        NOT NULL DEFAULT 'playbook',
  source_ref     TEXT        NOT NULL,                 -- invoice|person|program
  contact_id     BIGINT      REFERENCES public.dssc_contacts(id) ON DELETE CASCADE,
  participant_id BIGINT      REFERENCES public.dssc_participants(id) ON DELETE SET NULL,
  invoice        TEXT,
  program        TEXT        NOT NULL,
  category       TEXT,                                 -- volleyball | basketball | reach | facility | other
  kind           TEXT,                                 -- ClassRegistration | UserSubscription | RosterStatus
  sessions       INT         NOT NULL DEFAULT 1,
  amount_cents   INT         NOT NULL DEFAULT 0,       -- list price (before credits/discounts)
  purchased_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, source_ref)
);
CREATE INDEX IF NOT EXISTS dssc_purchases_contact_idx ON public.dssc_purchases(contact_id, purchased_at DESC);
CREATE INDEX IF NOT EXISTS dssc_purchases_when_idx ON public.dssc_purchases(purchased_at DESC);

-- ── contacts: email health and where an address came from ───────────────────
ALTER TABLE public.dssc_contacts ADD COLUMN IF NOT EXISTS email_status    TEXT NOT NULL DEFAULT 'ok';
ALTER TABLE public.dssc_contacts ADD COLUMN IF NOT EXISTS email_status_at TIMESTAMPTZ;
ALTER TABLE public.dssc_contacts ADD COLUMN IF NOT EXISTS lists           TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.dssc_contacts ADD COLUMN IF NOT EXISTS last_emailed_at TIMESTAMPTZ;
ALTER TABLE public.dssc_contacts ADD COLUMN IF NOT EXISTS last_opened_at  TIMESTAMPTZ;
ALTER TABLE public.dssc_contacts ADD COLUMN IF NOT EXISTS last_clicked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS dssc_contacts_lists_idx ON public.dssc_contacts USING gin (lists);

-- Add a list name to many addresses at once (an old list can be thousands).
CREATE OR REPLACE FUNCTION public.dssc_add_list(p_emails TEXT[], p_list TEXT)
RETURNS INT LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (
    UPDATE public.dssc_contacts c
       SET lists = (SELECT array_agg(DISTINCT x) FROM unnest(c.lists || ARRAY[p_list]) x),
           sources = CASE WHEN 'list' = ANY(c.sources) THEN c.sources ELSE c.sources || ARRAY['list'] END,
           updated_at = NOW()
     WHERE c.email = ANY(p_emails)
    RETURNING 1)
  SELECT count(*)::int FROM u;
$$;
REVOKE ALL ON FUNCTION public.dssc_add_list(TEXT[], TEXT) FROM PUBLIC, anon, authenticated;

-- ── saved segments ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dssc_segments (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT        NOT NULL,
  filters     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  notes       TEXT,
  last_count  INT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── email events (Resend webhook) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mkt_email_events (
  id         BIGSERIAL PRIMARY KEY,
  email      TEXT        NOT NULL,
  type       TEXT        NOT NULL,                     -- bounced | complained | opened | clicked | delivery_delayed
  resend_id  TEXT,                                     -- Resend's email id
  item_id    BIGINT,                                   -- mkt_items.id when known (tag)
  detail     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS mkt_email_events_once ON public.mkt_email_events (resend_id, type) WHERE resend_id IS NOT NULL AND type IN ('bounced', 'complained', 'opened');
CREATE INDEX IF NOT EXISTS mkt_email_events_item_idx ON public.mkt_email_events (item_id, type);
CREATE INDEX IF NOT EXISTS mkt_email_events_email_idx ON public.mkt_email_events (email, at DESC);

DROP TRIGGER IF EXISTS dssc_segments_touch ON public.dssc_segments;
CREATE TRIGGER dssc_segments_touch BEFORE UPDATE ON public.dssc_segments FOR EACH ROW EXECUTE FUNCTION public.mkt_touch();

-- ── row-level security: DSSC directors (spend is nobody else's business) ─────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dssc_purchases', 'dssc_segments', 'mkt_email_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_director_all', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_dssc_director()) WITH CHECK (public.is_dssc_director())', t || '_director_all', t);
  END LOOP;
END $$;
