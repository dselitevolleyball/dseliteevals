-- Migration: soften the allowlist — allow any signup, auto-approve allowlisted
-- Date: 2026-05-24
--
-- Previously: signup was hard-blocked unless the email was on the allowlist.
-- Now: anyone can sign up; if their email is on the allowlist they're
-- auto-approved (no waiting), otherwise they land on the "Awaiting Approval"
-- screen and the admin sees a banner prompting them to review pending
-- coaches in the Coaches tab.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first       BOOLEAN;
  v_allowlisted BOOLEAN;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.coaches) INTO v_first;
  SELECT EXISTS (
    SELECT 1 FROM public.allowed_signup_emails WHERE LOWER(email) = LOWER(NEW.email)
  ) INTO v_allowlisted;

  INSERT INTO public.coaches (id, email, display_name, is_admin, is_approved)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    v_first,                           -- only the very first signup is admin
    v_first OR v_allowlisted           -- first signup OR allowlisted = auto-approved
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;
