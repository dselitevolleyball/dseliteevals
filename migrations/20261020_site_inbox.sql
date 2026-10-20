-- DSSC shared inbox (Drew, 20 Oct 2026): "an inbox on the back end that all
-- the directors have access to and can respond to emails in a timely manner".
--
-- Today a family's email to info@drippingsportsclub.com lands in Drew's Gmail,
-- Jonathan answers from his own address, and nothing is tracked. From now on:
--
--   site_inquiries         one row per conversation ("thread"). Already held the
--                          DS Elite contact form; it now carries both sites
--                          (site = 'dselite' | 'dssc'), what the thread is about
--                          (kind, sport, details), who has it (assigned_to) and
--                          where it stands (status: new -> open -> waiting -> done).
--   site_inbox_messages    every message in a thread, in order: 'in' from the
--                          family (website form, or mail to info@ read over IMAP
--                          by api/site-inbox-poll.js), 'out' a director's reply
--                          (api/site-inbox-reply.js, Resend), 'note' an internal
--                          note nobody outside sees.
--   is_dssc_director()     the SQL twin of App.jsx isDsscDirector, so DSSC HQ
--                          reads and updates these tables with the user's own
--                          session. Real messages are inserted by the service
--                          role only; a director may insert a note.
--
-- Run: node scripts/run-sql.mjs migrations/20261020_site_inbox.sql
-- Additive and idempotent (safe to run twice).

-- ── 1. site_inquiries becomes the thread table ───────────────────────────────
ALTER TABLE public.site_inquiries ADD COLUMN IF NOT EXISTS site            text        NOT NULL DEFAULT 'dselite'; -- 'dselite' | 'dssc'
ALTER TABLE public.site_inquiries ADD COLUMN IF NOT EXISTS kind            text;                                   -- rental | party | reach | contact | camp | league | opengym | membership | email | tryouts | general | coaching | other
ALTER TABLE public.site_inquiries ADD COLUMN IF NOT EXISTS sport           text;                                   -- volleyball | basketball | reach | NULL
ALTER TABLE public.site_inquiries ADD COLUMN IF NOT EXISTS details         jsonb       NOT NULL DEFAULT '{}'::jsonb; -- { date, time, group, sport, age, duration, building, ... } as the form sent them
ALTER TABLE public.site_inquiries ADD COLUMN IF NOT EXISTS source_path     text;                                   -- the page the form was on
ALTER TABLE public.site_inquiries ADD COLUMN IF NOT EXISTS status          text        NOT NULL DEFAULT 'new';     -- new | open | waiting | done
ALTER TABLE public.site_inquiries ADD COLUMN IF NOT EXISTS assigned_to     text;                                   -- a director's email
ALTER TABLE public.site_inquiries ADD COLUMN IF NOT EXISTS assigned_at     timestamptz;
ALTER TABLE public.site_inquiries ADD COLUMN IF NOT EXISTS last_message_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.site_inquiries ADD COLUMN IF NOT EXISTS note            text;                                   -- a pinned internal note on the thread

-- A form without a message box (a rental quote request) still needs a row.
ALTER TABLE public.site_inquiries ALTER COLUMN message SET DEFAULT '';

-- Backfill what already exists (the DS Elite contact form rows).
UPDATE public.site_inquiries SET status = CASE WHEN handled THEN 'done' ELSE 'new' END
 WHERE status = 'new' AND handled;
UPDATE public.site_inquiries SET kind = topic WHERE kind IS NULL;

CREATE INDEX IF NOT EXISTS site_inquiries_status_idx ON public.site_inquiries (status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS site_inquiries_email_idx  ON public.site_inquiries (lower(email), created_at DESC);

-- Keep the old handled flag and the new status telling the same story, so
-- HQ -> Website -> Inquiries (handled checkbox) and the Inbox (status) agree.
CREATE OR REPLACE FUNCTION public.site_inquiries_sync_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.handled AND NEW.status <> 'done' THEN NEW.status := 'done'; END IF;
    IF NEW.status = 'done' AND NOT NEW.handled THEN NEW.handled := true; NEW.handled_at := coalesce(NEW.handled_at, now()); END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.handled := (NEW.status = 'done');
    IF NEW.handled AND NOT OLD.handled THEN NEW.handled_at := now(); END IF;
    IF NOT NEW.handled THEN NEW.handled_at := NULL; NEW.handled_by := NULL; END IF;
  ELSIF NEW.handled IS DISTINCT FROM OLD.handled THEN
    NEW.status := CASE WHEN NEW.handled THEN 'done' ELSE 'open' END;
  END IF;
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    NEW.assigned_at := CASE WHEN NEW.assigned_to IS NULL THEN NULL ELSE now() END;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS site_inquiries_sync_status ON public.site_inquiries;
CREATE TRIGGER site_inquiries_sync_status BEFORE INSERT OR UPDATE ON public.site_inquiries
  FOR EACH ROW EXECUTE FUNCTION public.site_inquiries_sync_status();

-- ── 2. The messages ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.site_inbox_messages (
  id             bigserial   PRIMARY KEY,
  inquiry_id     bigint      NOT NULL REFERENCES public.site_inquiries(id) ON DELETE CASCADE,
  direction      text        NOT NULL CHECK (direction IN ('in', 'out', 'note')),
  from_name      text,
  from_email     text,
  to_email       text,
  subject        text,
  body_text      text,
  body_html      text,
  message_id     text,                                   -- RFC 5322 Message-ID (mail in; our own on mail out)
  in_reply_to    text,
  references_ids text[],
  provider_id    text,                                   -- Resend's id for mail we sent
  sent_by        text,                                   -- the director's email ('out' and 'note')
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_inbox_messages_inquiry_idx ON public.site_inbox_messages (inquiry_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS site_inbox_messages_message_id_idx ON public.site_inbox_messages (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_inbox_messages_provider_idx ON public.site_inbox_messages (provider_id) WHERE provider_id IS NOT NULL;

-- Rows from before this migration got last_message_at = the moment the column
-- was added; a thread with no messages yet is as old as its form submission.
UPDATE public.site_inquiries i SET last_message_at = i.created_at
 WHERE i.last_message_at > i.created_at
   AND NOT EXISTS (SELECT 1 FROM public.site_inbox_messages m WHERE m.inquiry_id = i.id);

-- ── 3. Who is a DSSC director (mirrors App.jsx isDsscDirector) ───────────────
-- True for DS Elite admins (is_admin_coach), for an approved login with
-- coaches.dssc_role = 'admin', and for the directors by email. Keep the list in
-- step with shared/dssc-directors.js.
CREATE OR REPLACE FUNCTION public.is_dssc_director()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin_coach()
      OR EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved AND c.dssc_role = 'admin')
      OR lower(coalesce(auth.jwt() ->> 'email', '')) IN (
           'drew@drippingsportsclub.com', 'drew@dselitevolleyball.com',
           'jonathan@drippingsportsclub.com',
           'hunter@drippingsportsclub.com', 'hunterhaleysc10@gmail.com',
           'adrian@4thquarterathlete.com',
           'brandon@drippingsportsclub.com',
           'deroald@drippingsportsclub.com');
$$;

-- ── 4. Policies: directors read and update with their own session ───────────
ALTER TABLE public.site_inquiries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_inquiries_admin_read   ON public.site_inquiries;
DROP POLICY IF EXISTS site_inquiries_admin_update ON public.site_inquiries;
DROP POLICY IF EXISTS site_inquiries_director_read   ON public.site_inquiries;
DROP POLICY IF EXISTS site_inquiries_director_update ON public.site_inquiries;
CREATE POLICY site_inquiries_director_read ON public.site_inquiries FOR SELECT
  USING (public.is_dssc_director());
CREATE POLICY site_inquiries_director_update ON public.site_inquiries FOR UPDATE
  USING (public.is_dssc_director()) WITH CHECK (public.is_dssc_director());
-- No INSERT / DELETE policy: threads start only through the service role
-- (api/site-inbox.js, api/site-contact.js, api/site-inbox-poll.js).

ALTER TABLE public.site_inbox_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_inbox_messages_director_read   ON public.site_inbox_messages;
DROP POLICY IF EXISTS site_inbox_messages_director_note   ON public.site_inbox_messages;
DROP POLICY IF EXISTS site_inbox_messages_director_update ON public.site_inbox_messages;
CREATE POLICY site_inbox_messages_director_read ON public.site_inbox_messages FOR SELECT
  USING (public.is_dssc_director());
-- A director may write an internal note from HQ; 'in' and 'out' rows come only
-- from the service role (the poller and the reply API).
CREATE POLICY site_inbox_messages_director_note ON public.site_inbox_messages FOR INSERT
  WITH CHECK (public.is_dssc_director() AND direction = 'note');
CREATE POLICY site_inbox_messages_director_update ON public.site_inbox_messages FOR UPDATE
  USING (public.is_dssc_director()) WITH CHECK (public.is_dssc_director());

SELECT tablename, policyname, cmd FROM pg_policies
 WHERE tablename IN ('site_inquiries', 'site_inbox_messages') ORDER BY 1, 2;
