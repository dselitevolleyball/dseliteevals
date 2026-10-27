-- Spam in the DSSC Inbox (Drew, Oct 27 2026: "need a way to annotate inbox
-- messages as spam on the app").
--
--   site_inquiries.status   gains 'spam'. A spam thread counts as handled (the
--                           Website -> Inquiries checkbox), stays out of New /
--                           Mine / All, and lives under the Inbox's Spam filter.
--   site_inbox_blocked      the senders marked as spam. Anything new from one of
--                           them (mail to info@, a website form) is filed
--                           straight to Spam and no director is emailed.
--                           "Not spam" on the thread takes the sender off.
--
-- Run: node scripts/run-sql.mjs migrations/20261105_inbox_spam.sql
-- Additive and idempotent (safe to run twice).

CREATE TABLE IF NOT EXISTS public.site_inbox_blocked (
  email       text        PRIMARY KEY,           -- lower-case address
  inquiry_id  bigint      REFERENCES public.site_inquiries(id) ON DELETE SET NULL,  -- the thread it was marked on
  blocked_by  text,
  blocked_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.site_inbox_blocked ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_inbox_blocked_director ON public.site_inbox_blocked;
CREATE POLICY site_inbox_blocked_director ON public.site_inbox_blocked FOR ALL
  USING (public.is_dssc_director()) WITH CHECK (public.is_dssc_director());

-- handled <-> status: spam is handled too.
CREATE OR REPLACE FUNCTION public.site_inquiries_sync_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.handled AND NEW.status NOT IN ('done', 'spam') THEN NEW.status := 'done'; END IF;
    IF NEW.status IN ('done', 'spam') AND NOT NEW.handled THEN NEW.handled := true; NEW.handled_at := coalesce(NEW.handled_at, now()); END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.handled := (NEW.status IN ('done', 'spam'));
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
