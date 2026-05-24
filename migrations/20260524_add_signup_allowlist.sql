-- Migration: signup email allowlist
-- Date: 2026-05-24
--
-- Restricts who can create an account. Admins manage the list from the
-- Coaches tab. The handle_new_user trigger now rejects signups whose email
-- is not on the list (the very first signup is still exempt, as a bootstrap
-- safeguard — but at this point a first coach already exists, so that branch
-- is dormant going forward).
--
-- Existing coach emails are auto-seeded into the allowlist so they can
-- always re-signup if their auth account is ever deleted by mistake.

-- ───── 1. allowed_signup_emails table ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.allowed_signup_emails (
  email          TEXT         PRIMARY KEY,
  added_by       UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  added_by_name  TEXT,
  added_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  note           TEXT
);

ALTER TABLE public.allowed_signup_emails ENABLE ROW LEVEL SECURITY;

-- Any approved coach can read (so the Coaches tab can display the list).
DROP POLICY IF EXISTS allowed_emails_select_approved ON public.allowed_signup_emails;
CREATE POLICY allowed_emails_select_approved ON public.allowed_signup_emails
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved)
  );

-- Only admins can add/remove entries.
DROP POLICY IF EXISTS allowed_emails_insert_admin ON public.allowed_signup_emails;
CREATE POLICY allowed_emails_insert_admin ON public.allowed_signup_emails
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_admin)
  );

DROP POLICY IF EXISTS allowed_emails_delete_admin ON public.allowed_signup_emails;
CREATE POLICY allowed_emails_delete_admin ON public.allowed_signup_emails
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_admin)
  );

-- Auto-seed: every existing coach's email goes in the allowlist so they can
-- always re-signup if their auth.users row is ever deleted by accident.
INSERT INTO public.allowed_signup_emails (email, note)
  SELECT email, 'auto-added from existing coach' FROM public.coaches
  ON CONFLICT (email) DO NOTHING;

-- Seed: 2026-05-24 coaching staff list (18 emails). Notes hold the coach's
-- name so future admins can match an email to a person at a glance.
-- (Lindsey Shumway and Mia De la Rosa were on the roster without emails —
--  add them later via the Coaches tab once collected.)
INSERT INTO public.allowed_signup_emails (email, note) VALUES
  ('ambriarupp@gmail.com',         'Ambria Rupp'),
  ('brandonblahnik@outlook.com',   'Brandon Blahnik'),
  ('divoga24@gmail.com',           'Breanna Cohen'),
  ('changguo@utexas.edu',          'Chang Guo'),
  ('drew@drippingsportsclub.com',  'Drew Rose'),
  ('ella.hinkle00@gmail.com',      'Ella Hinkle'),
  ('jbaerwald23@gmail.com',        'Jason Baerwald'),
  ('jaydenwright0131@gmail.com',   'Jayden Wright'),
  ('kristen.alexandrov@gmail.com', 'Kristen Alexandrov'),
  ('matthewmercier87@gmail.com',   'Matt Mercier'),
  ('mikayla_sw_95@yahoo.com',      'Mikayla Smith-Wright'),
  ('adrielroberts97@gmail.com',    'Rob (Adriel) Roberts'),
  ('reneandamys@gmail.com',        'Rene Sandoval'),
  ('samanthagmabry@gmail.com',     'Sam Mabry'),
  ('sammystar29@gmail.com',        'Sam Robinson'),
  ('shelwilliams@gmail.com',       'Shellie Williams'),
  ('taraanne888@yahoo.com',        'Tara Fisher'),
  ('tionne@drippingsportsclub.com','Tionne Graves-Brown')
ON CONFLICT (email) DO NOTHING;

-- ───── 2. Pre-check RPC (called by the client before signUp) ──────────
-- Anon users can call this to find out whether their email is permitted, so
-- we can show a clean error message instead of a confusing "Database error
-- saving new user" from Supabase Auth. The trigger below is the real
-- enforcement — this is just for UX.
CREATE OR REPLACE FUNCTION public.is_signup_allowed(check_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    NOT EXISTS (SELECT 1 FROM public.coaches)
    OR EXISTS (
      SELECT 1 FROM public.allowed_signup_emails
      WHERE LOWER(email) = LOWER(check_email)
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_signup_allowed(TEXT) TO anon, authenticated;

-- ───── 3. Update handle_new_user to enforce the allowlist ─────────────
-- Replaces the trigger function created in the auth migration. The very
-- first signup (when public.coaches is empty) is still allowed through so
-- there's always a bootstrap escape hatch. Every subsequent signup must
-- match an entry in allowed_signup_emails or the trigger raises and the
-- auth.users insert rolls back.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first   BOOLEAN;
  v_allowed BOOLEAN;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.coaches) INTO v_first;

  IF NOT v_first THEN
    SELECT EXISTS (
      SELECT 1 FROM public.allowed_signup_emails
      WHERE LOWER(email) = LOWER(NEW.email)
    ) INTO v_allowed;
    IF NOT v_allowed THEN
      RAISE EXCEPTION
        USING
          MESSAGE = 'Signup not permitted for this email. Contact the Director of Volleyball to be added to the approved list.',
          ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.coaches (id, email, display_name, is_admin, is_approved)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    v_first,
    v_first
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
-- (The on_auth_user_created trigger from the previous migration already
--  binds this function; replacing the function alone is enough.)
