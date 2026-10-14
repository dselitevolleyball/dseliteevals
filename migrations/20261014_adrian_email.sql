-- Adrian's real email is adrian@4thquarterathlete.com, not @drippingsportsclub.com
-- (Drew, 14 Oct 2026). He hadn't created a login yet, so only the pre-approved
-- allowlist entry and his DSSC people row move.
UPDATE public.allowed_signup_emails SET email = 'adrian@4thquarterathlete.com' WHERE lower(email) = 'adrian@drippingsportsclub.com';
UPDATE public.dssc_people SET email = 'adrian@4thquarterathlete.com', invited_at = NULL, updated_at = now() WHERE lower(email) = 'adrian@drippingsportsclub.com';
UPDATE public.dssc_pay_rates SET email = 'adrian@4thquarterathlete.com' WHERE lower(email) = 'adrian@drippingsportsclub.com';
