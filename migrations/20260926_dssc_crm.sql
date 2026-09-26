-- Migration: the DSSC CRM — everyone who has ever bought, registered or played
-- with Dripping Springs Sports Club, with their kids and what they took part in.
-- Date: 2026-09-26  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260926_dssc_crm.sql
--
-- Three tables:
--   dssc_contacts       the account holder (usually a parent) — one per email
--   dssc_participants   the people who actually play — kids under a contact,
--                       or the contact themself for adult programs
--   dssc_participation  one row per program/event a participant took part in,
--                       from any source: Upper Hand (the old sales platform),
--                       Playbook (the current one), or the DS Elite roster
--   dssc_orders         what each contact has bought (Upper Hand), for spend
-- Everything is keyed so re-importing an export tops up instead of duplicating.
-- The Texts screen's audience is built from this plus sms_consents.

CREATE TABLE IF NOT EXISTS public.dssc_contacts (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT UNIQUE,                     -- lower-cased; the join key across sources
  first_name    TEXT,
  last_name     TEXT,
  phone         TEXT,                            -- E.164
  address       TEXT,
  city          TEXT,
  state         TEXT,
  zip           TEXT,
  dob           DATE,
  sources       TEXT[] NOT NULL DEFAULT '{}',    -- upperhand | playbook | dse | form
  tags          TEXT[] NOT NULL DEFAULT '{}',
  notes         TEXT,
  do_not_text   BOOLEAN NOT NULL DEFAULT false,
  uh_added_at   DATE,                            -- Upper Hand "added_date"
  uh_last_login DATE,
  dse_player_ids BIGINT[] NOT NULL DEFAULT '{}', -- DS Elite players under this family
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dssc_contacts_phone_idx ON public.dssc_contacts(phone);
CREATE INDEX IF NOT EXISTS dssc_contacts_name_idx ON public.dssc_contacts(lower(last_name), lower(first_name));

CREATE TABLE IF NOT EXISTS public.dssc_participants (
  id            BIGSERIAL PRIMARY KEY,
  contact_id    BIGINT REFERENCES public.dssc_contacts(id) ON DELETE CASCADE,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  name_key      TEXT NOT NULL,                   -- lower(first last), for dedupe
  dob           DATE,
  gender        TEXT,
  is_contact    BOOLEAN NOT NULL DEFAULT false,  -- the account holder themself (adult programs)
  dse_player_id BIGINT,
  sources       TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contact_id, name_key)
);
CREATE INDEX IF NOT EXISTS dssc_participants_dob_idx ON public.dssc_participants(dob);

CREATE TABLE IF NOT EXISTS public.dssc_participation (
  id             BIGSERIAL PRIMARY KEY,
  participant_id BIGINT REFERENCES public.dssc_participants(id) ON DELETE CASCADE,
  contact_id     BIGINT REFERENCES public.dssc_contacts(id) ON DELETE CASCADE,
  program        TEXT NOT NULL,                  -- as named at the source
  category       TEXT,                           -- volleyball | basketball | reach | other
  event_date     DATE,                           -- the class/session/season start
  source         TEXT NOT NULL,                  -- playbook | upperhand | dse
  source_ref     TEXT NOT NULL,                  -- unique within source
  amount_cents   INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, source_ref)
);
CREATE INDEX IF NOT EXISTS dssc_participation_contact_idx ON public.dssc_participation(contact_id, event_date DESC);
CREATE INDEX IF NOT EXISTS dssc_participation_cat_idx ON public.dssc_participation(category, event_date DESC);

CREATE TABLE IF NOT EXISTS public.dssc_orders (
  id            TEXT PRIMARY KEY,                -- Upper Hand order id
  contact_id    BIGINT REFERENCES public.dssc_contacts(id) ON DELETE SET NULL,
  buyer         TEXT,
  order_number  TEXT,
  total_cents   INT NOT NULL DEFAULT 0,
  method        TEXT,
  sale_source   TEXT,
  ordered_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dssc_orders_contact_idx ON public.dssc_orders(contact_id, ordered_at DESC);

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['dssc_contacts','dssc_participants','dssc_participation','dssc_orders'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "auth_all_%s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "auth_all_%s" ON public.%I FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)', t, t);
  END LOOP;
END $$;
