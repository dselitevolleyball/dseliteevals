-- Migration: mirror of AES (Advanced Event Systems) volleyball events for the
-- Lone Star region (regionId=4), pulled from the public AES OData API by the
-- api/aes-poll cron. Lets us show a live Lone Star events list and alert Drew
-- the moment a new event is posted. Date: 2026-07-21. Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260721_aes_events.sql

CREATE TABLE IF NOT EXISTS public.aes_events (
  event_id      INTEGER PRIMARY KEY,            -- AES eventId
  name          TEXT,
  start_date    DATE,
  end_date      DATE,
  city          TEXT,
  state         TEXT,
  region_id     INTEGER,
  region_name   TEXT,
  reg_open      BOOLEAN,                         -- registration currently open
  is_past       BOOLEAN,
  url           TEXT,                            -- advancedeventsystems.com/{event_id}
  raw           JSONB,
  notified      BOOLEAN NOT NULL DEFAULT false,  -- have we alerted on this new event
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS aes_events_start_idx ON public.aes_events (start_date);

ALTER TABLE public.aes_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_aes_events" ON public.aes_events;
CREATE POLICY "auth_read_aes_events" ON public.aes_events FOR SELECT USING (auth.uid() IS NOT NULL);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='aes_events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.aes_events;
  END IF;
END $$;
