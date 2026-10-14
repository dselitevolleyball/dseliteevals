-- Staff hours by department (Drew, 14 Oct 2026).
--  * Every staff shift carries a department - volleyball, basketball, reach or
--    operations - and, for operations, what kind of work (birthday party,
--    facility help, intern, events). Picked when clocking in.
--  * staff_view on a login says whose staff hours they see/approve:
--    NULL = every department (Drew, Jonathan, Deroald); Hunter volleyball,
--    Adrian basketball, Brandon (Butler) reach. Copied from the allowlist /
--    dssc_people on signup like dssc_role.
--  * dssc_people.sports now also holds a staff member's departments
--    (volleyball, basketball, reach, operations).
-- Run: node scripts/run-sql.mjs migrations/20261014_dssc_staff_departments.sql

ALTER TABLE public.dssc_staff_shifts ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE public.dssc_staff_shifts ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.coaches ADD COLUMN IF NOT EXISTS staff_view TEXT[];
ALTER TABLE public.allowed_signup_emails ADD COLUMN IF NOT EXISTS staff_view TEXT[];
ALTER TABLE public.dssc_people ADD COLUMN IF NOT EXISTS staff_view TEXT[];

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
  v_role    TEXT;
  v_only    BOOLEAN := FALSE;
  v_sports  TEXT[];
  v_view    TEXT[];
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.coaches) INTO v_first;
  IF NOT v_first THEN
    SELECT EXISTS (SELECT 1 FROM public.allowed_signup_emails WHERE LOWER(email) = LOWER(NEW.email)) INTO v_allowed;
    IF NOT v_allowed THEN
      RAISE EXCEPTION USING
        MESSAGE = 'Signup not permitted for this email. Ask a director to add you first.',
        ERRCODE = 'P0001';
    END IF;
    SELECT COALESCE(pre_approved, FALSE), display_name, dssc_role, COALESCE(dssc_only, FALSE), sports, staff_view
      INTO v_pre, v_name, v_role, v_only, v_sports, v_view
      FROM public.allowed_signup_emails WHERE LOWER(email) = LOWER(NEW.email) LIMIT 1;
  END IF;
  INSERT INTO public.coaches (id, email, display_name, is_admin, is_approved, dssc_role, dssc_only, sports, staff_view)
  VALUES (
    NEW.id, NEW.email,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'display_name', ''), v_name, split_part(NEW.email, '@', 1)),
    v_first, v_first OR v_pre, v_role, v_only, v_sports, v_view
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Adrian runs basketball (his board and approvals open on basketball).
UPDATE public.allowed_signup_emails SET sports = ARRAY['basketball'], staff_view = ARRAY['basketball'] WHERE lower(email) = 'adrian@drippingsportsclub.com';
UPDATE public.dssc_people SET sports = ARRAY['basketball'], staff_view = ARRAY['basketball'] WHERE lower(email) = 'adrian@drippingsportsclub.com';
-- Jonathan and Deroald: every department (staff_view NULL).
UPDATE public.allowed_signup_emails SET staff_view = NULL WHERE lower(email) IN ('jonathan@drippingsportsclub.com', 'deroald@drippingsportsclub.com');
-- Hunter: volleyball.
UPDATE public.coaches SET staff_view = ARRAY['volleyball'] WHERE lower(email) IN ('hunter@drippingsportsclub.com', 'hunterhaleysc10@gmail.com');
INSERT INTO public.dssc_people (email, first_name, last_name, phone, role, sports, staff_view, created_by)
  VALUES ('hunter@drippingsportsclub.com', 'Hunter', 'Haley', '+13106330352', 'admin', ARRAY['volleyball'], ARRAY['volleyball'], 'Drew Rose')
  ON CONFLICT (email) DO UPDATE SET role = 'admin', sports = ARRAY['volleyball'], staff_view = ARRAY['volleyball'], phone = COALESCE(public.dssc_people.phone, EXCLUDED.phone);
-- Brandon Butler (Reach): into DSSC HQ as Reach staff who also sees Reach staff hours.
UPDATE public.coaches SET dssc_role = 'staff', sports = ARRAY['reach'], staff_view = ARRAY['reach'] WHERE lower(email) = 'brandon@drippingsportsclub.com';
INSERT INTO public.dssc_people (email, first_name, last_name, role, sports, staff_view, created_by)
  VALUES ('brandon@drippingsportsclub.com', 'Brandon', 'Butler', 'staff', ARRAY['reach'], ARRAY['reach'], 'Drew Rose')
  ON CONFLICT (email) DO UPDATE SET role = 'staff', sports = ARRAY['reach'], staff_view = ARRAY['reach'], last_name = COALESCE(public.dssc_people.last_name, 'Butler');
