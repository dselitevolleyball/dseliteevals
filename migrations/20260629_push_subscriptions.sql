-- 20260629 — Web Push device subscriptions.
--
-- One row per installed device that opted in to push. Denormalizes email,
-- is_admin and teams at subscribe time so the /api/send-push endpoint can
-- pick recipients (club-wide / a team / admins / one coach) without joins.
--
-- Run once in the Supabase SQL editor. Additive, non-destructive, idempotent.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         BIGSERIAL    PRIMARY KEY,
  endpoint   TEXT         UNIQUE NOT NULL,
  p256dh     TEXT         NOT NULL,
  auth       TEXT         NOT NULL,
  email      TEXT,
  is_admin   BOOLEAN      NOT NULL DEFAULT FALSE,
  teams      TEXT[]       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_subscriptions_all_approved ON public.push_subscriptions;
CREATE POLICY push_subscriptions_all_approved ON public.push_subscriptions
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));
