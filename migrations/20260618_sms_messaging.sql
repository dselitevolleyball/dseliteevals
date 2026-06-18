-- Migration: SMS messaging tables (Twilio-backed)
-- Date: 2026-06-18
--
-- Two tables:
--   sms_threads  — one row per outside phone number we're conversing with
--   sms_messages — every outbound + inbound SMS, foreign-keyed to a thread
--
-- The frontend reads both via Supabase Realtime so new inbound messages
-- show up live in the inbox + on the player profile card without a refresh.

CREATE TABLE IF NOT EXISTS public.sms_threads (
  id                    BIGSERIAL PRIMARY KEY,
  phone                 TEXT UNIQUE NOT NULL,         -- E.164 (+15551234567)
  player_id             BIGINT REFERENCES public.players(id) ON DELETE SET NULL,
  display_name          TEXT,                          -- e.g. "Jamie Smith (Avery's mom)"
  last_message_at       TIMESTAMPTZ,
  last_message_preview  TEXT,
  last_message_direction TEXT CHECK (last_message_direction IN ('outbound','inbound')),
  unread_count          INT NOT NULL DEFAULT 0,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sms_messages (
  id                BIGSERIAL PRIMARY KEY,
  thread_id         BIGINT NOT NULL REFERENCES public.sms_threads(id) ON DELETE CASCADE,
  direction         TEXT NOT NULL CHECK (direction IN ('outbound','inbound')),
  body              TEXT NOT NULL,
  twilio_sid        TEXT UNIQUE,                       -- nullable for queued outbound
  status            TEXT,                              -- queued|sending|sent|delivered|failed|received
  error_code        TEXT,
  error_message     TEXT,
  sent_by_coach_id  UUID REFERENCES public.coaches(id) ON DELETE SET NULL,
  sent_by_label     TEXT,                              -- denormalized coach display name
  sent_at           TIMESTAMPTZ,                       -- when twilio accepted (outbound) or received (inbound)
  delivered_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sms_messages_thread_idx ON public.sms_messages(thread_id);
CREATE INDEX IF NOT EXISTS sms_messages_sid_idx    ON public.sms_messages(twilio_sid);
CREATE INDEX IF NOT EXISTS sms_threads_phone_idx   ON public.sms_threads(phone);

-- RLS — authenticated users only. Service role (used by webhooks + send
-- function) bypasses RLS so server code can insert messages regardless.
ALTER TABLE public.sms_threads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_sms_threads" ON public.sms_threads;
DROP POLICY IF EXISTS "auth_modify_sms_threads" ON public.sms_threads;
DROP POLICY IF EXISTS "auth_select_sms_messages" ON public.sms_messages;
DROP POLICY IF EXISTS "auth_modify_sms_messages" ON public.sms_messages;

CREATE POLICY "auth_select_sms_threads" ON public.sms_threads
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_modify_sms_threads" ON public.sms_threads
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth_select_sms_messages" ON public.sms_messages
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_modify_sms_messages" ON public.sms_messages
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Realtime — push new + updated rows to subscribed clients.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='sms_threads') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sms_threads;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='sms_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sms_messages;
  END IF;
END $$;
