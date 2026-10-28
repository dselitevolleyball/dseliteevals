-- Adrian's HQ address is adrian@drippingsportsclub.com again (Drew, Oct 28
-- 2026), reversing 20261014_adrian_email.sql. His login (auth.users) keeps its
-- id and password and is moved to the new address separately through the auth
-- admin API, so his coaches row (same id) and everything keyed to him carry on.
-- dssc_contacts is left alone: it mirrors his Playbook account and the sync
-- would put it back.
-- Run: node scripts/run-sql.mjs migrations/20261107_adrian_email.sql
UPDATE public.coaches               SET email = 'adrian@drippingsportsclub.com' WHERE lower(email) = 'adrian@4thquarterathlete.com';
UPDATE public.allowed_signup_emails SET email = 'adrian@drippingsportsclub.com' WHERE lower(email) = 'adrian@4thquarterathlete.com';
UPDATE public.dssc_people           SET email = 'adrian@drippingsportsclub.com', updated_at = now() WHERE lower(email) = 'adrian@4thquarterathlete.com';
UPDATE public.dssc_pay_rates        SET email = 'adrian@drippingsportsclub.com' WHERE lower(email) = 'adrian@4thquarterathlete.com';
UPDATE public.mkt_spotlights        SET email = 'adrian@drippingsportsclub.com' WHERE lower(email) = 'adrian@4thquarterathlete.com';

-- The SQL twin of shared/dssc-directors.js: the new address, and the old one
-- while anything still signed in with it.
CREATE OR REPLACE FUNCTION public.is_dssc_director()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin_coach()
      OR EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved AND c.dssc_role = 'admin')
      OR lower(coalesce(auth.jwt() ->> 'email', '')) IN (
           'drew@drippingsportsclub.com', 'drew@dselitevolleyball.com',
           'jonathan@drippingsportsclub.com',
           'hunter@drippingsportsclub.com', 'hunterhaleysc10@gmail.com',
           'adrian@drippingsportsclub.com', 'adrian@4thquarterathlete.com',
           'brandon@drippingsportsclub.com',
           'deroald@drippingsportsclub.com');
$$;
