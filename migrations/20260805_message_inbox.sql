-- Migration: make a sent message readable in the app by the person it was sent to.
-- Date: 2026-08-05  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260805_message_inbox.sql
--
-- Tapping a push opened the app but there was nowhere to read the message: the
-- notifications feed is built from updates, questions and reminders, and never
-- included anything sent from the Email composer. email_log now records every
-- send (subject, body, recipients), so it can be the inbox — no new table.
--
-- It also fixes a real privacy hole. The existing policy let ANY approved coach
-- read EVERY logged email, including messages sent to parents about other
-- people's children. A coach should see only what was addressed to them.

DROP POLICY IF EXISTS email_log_all_approved ON public.email_log;
DROP POLICY IF EXISTS email_log_admin        ON public.email_log;
DROP POLICY IF EXISTS email_log_mine         ON public.email_log;
DROP POLICY IF EXISTS email_log_insert       ON public.email_log;

-- Directors keep full visibility — they need the sent history.
CREATE POLICY email_log_admin ON public.email_log FOR ALL
  USING (public.is_admin_coach()) WITH CHECK (public.is_admin_coach());

-- A coach reads only messages addressed to them. Case-insensitive: addresses
-- are typed by hand in places and "Drew@" must still match "drew@".
CREATE POLICY email_log_mine ON public.email_log FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.coaches c
    WHERE c.id = auth.uid() AND c.is_approved AND c.email IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM unnest(coalesce(email_log.recipients, ARRAY[]::text[])) AS r
        WHERE lower(btrim(r)) = lower(btrim(c.email))
      )
  ));

-- Any approved coach may still WRITE a log row: several features send mail as
-- the signed-in coach and log it client-side. Writing a log entry reveals
-- nothing; reading other people's does.
CREATE POLICY email_log_insert ON public.email_log FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

CREATE INDEX IF NOT EXISTS email_log_created_idx ON public.email_log(created_at DESC);
