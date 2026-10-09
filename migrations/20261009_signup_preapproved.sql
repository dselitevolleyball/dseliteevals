-- Pre-approved signups: an allowlist entry can now say "approve on signup", so
-- a coach we've already vetted can create a login and use the app straight
-- away instead of waiting for someone to tick Approved in Coaches.
-- First use: brandon@drippingsportsclub.com (a new DSSC performance coach, NOT Brandon Blahnik;
-- coach — Testing Reports + testing links). Oct 9 2026.
-- Run: node scripts/run-sql.mjs migrations/20261009_signup_preapproved.sql

ALTER TABLE public.allowed_signup_emails ADD COLUMN IF NOT EXISTS pre_approved BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.allowed_signup_emails ADD COLUMN IF NOT EXISTS display_name TEXT;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first   BOOLEAN;
  v_allowed BOOLEAN;
  v_pre     BOOLEAN := FALSE;
  v_name    TEXT;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.coaches) INTO v_first;
  IF NOT v_first THEN
    SELECT EXISTS (SELECT 1 FROM public.allowed_signup_emails WHERE LOWER(email) = LOWER(NEW.email)) INTO v_allowed;
    IF NOT v_allowed THEN
      RAISE EXCEPTION USING
        MESSAGE = 'Signup not permitted for this email. Contact the Director of Volleyball to be added to the approved list.',
        ERRCODE = 'P0001';
    END IF;
    SELECT COALESCE(pre_approved, FALSE), display_name INTO v_pre, v_name
      FROM public.allowed_signup_emails WHERE LOWER(email) = LOWER(NEW.email) LIMIT 1;
  END IF;
  INSERT INTO public.coaches (id, email, display_name, is_admin, is_approved)
  VALUES (
    NEW.id, NEW.email,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'display_name', ''), v_name, split_part(NEW.email, '@', 1)),
    v_first, v_first OR v_pre
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

INSERT INTO public.allowed_signup_emails (email, added_by_name, note, pre_approved, display_name)
VALUES ('brandon@drippingsportsclub.com', 'Drew Rose', 'New Brandon at DSSC (performance coach) - not Brandon Blahnik. Approved on signup.', TRUE, NULL)
ON CONFLICT (email) DO UPDATE SET pre_approved = TRUE, note = EXCLUDED.note;
