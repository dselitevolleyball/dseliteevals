-- Migration: is_email_registered RPC for friendly "already signed up" redirect
-- Date: 2026-05-24
--
-- The signup form pre-checks this before calling supabase.auth.signUp so we
-- can flip an accidental re-signup into a sign-in immediately instead of
-- hitting Supabase's email-rate-limit error.

CREATE OR REPLACE FUNCTION public.is_email_registered(check_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coaches WHERE LOWER(email) = LOWER(check_email)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_email_registered(TEXT) TO anon, authenticated;
