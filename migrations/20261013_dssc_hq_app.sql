-- DSSC HQ as its own app (drippingsportsclub.com/hq) — Drew, 13 Oct 2026.
--
--  * coaches / allowed_signup_emails get DSSC roles:
--      dssc_role  'admin' (runs DSSC: sees who's coaching, assigns, fixes clock-ins)
--                 'coach' (coaches DSSC classes)  'staff' (interns etc.: generic clock in/out)
--      dssc_only  true = not part of DS Elite; the app only ever shows DSSC
--      sports     which DSSC classes they coach / approve ('volleyball','basketball')
--    The signup trigger copies them from the allowlist onto the new login.
--  * dssc_clinics.sport — volleyball or basketball (Playbook category).
--  * dssc_people — DSSC coaches and staff who aren't on the DS Elite coach roster,
--    with just the basics (name, email, phone, role, sport).
--  * dssc_staff_shifts — generic clock in / clock out with what they worked on.
-- Run: node scripts/run-sql.mjs migrations/20261013_dssc_hq_app.sql

ALTER TABLE public.coaches ADD COLUMN IF NOT EXISTS dssc_role TEXT;
ALTER TABLE public.coaches ADD COLUMN IF NOT EXISTS dssc_only BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.coaches ADD COLUMN IF NOT EXISTS sports TEXT[];
ALTER TABLE public.allowed_signup_emails ADD COLUMN IF NOT EXISTS dssc_role TEXT;
ALTER TABLE public.allowed_signup_emails ADD COLUMN IF NOT EXISTS dssc_only BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.allowed_signup_emails ADD COLUMN IF NOT EXISTS sports TEXT[];

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
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.coaches) INTO v_first;
  IF NOT v_first THEN
    SELECT EXISTS (SELECT 1 FROM public.allowed_signup_emails WHERE LOWER(email) = LOWER(NEW.email)) INTO v_allowed;
    IF NOT v_allowed THEN
      RAISE EXCEPTION USING
        MESSAGE = 'Signup not permitted for this email. Ask a director to add you first.',
        ERRCODE = 'P0001';
    END IF;
    SELECT COALESCE(pre_approved, FALSE), display_name, dssc_role, COALESCE(dssc_only, FALSE), sports
      INTO v_pre, v_name, v_role, v_only, v_sports
      FROM public.allowed_signup_emails WHERE LOWER(email) = LOWER(NEW.email) LIMIT 1;
  END IF;
  INSERT INTO public.coaches (id, email, display_name, is_admin, is_approved, dssc_role, dssc_only, sports)
  VALUES (
    NEW.id, NEW.email,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'display_name', ''), v_name, split_part(NEW.email, '@', 1)),
    v_first, v_first OR v_pre, v_role, v_only, v_sports
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

ALTER TABLE public.dssc_clinics ADD COLUMN IF NOT EXISTS sport TEXT NOT NULL DEFAULT 'volleyball';

CREATE TABLE IF NOT EXISTS public.dssc_people (
  id bigserial PRIMARY KEY,
  email text UNIQUE,
  first_name text NOT NULL,
  last_name text,
  phone text,
  role text NOT NULL DEFAULT 'coach',          -- admin | coach | staff
  sports text[] NOT NULL DEFAULT '{}',          -- volleyball, basketball
  active boolean NOT NULL DEFAULT true,
  notes text,
  invited_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dssc_people ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_dssc_people" ON public.dssc_people;
CREATE POLICY "auth_all_dssc_people" ON public.dssc_people FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.dssc_staff_shifts (
  id bigserial PRIMARY KEY,
  person_email text NOT NULL,
  person_name text,
  clock_in timestamptz NOT NULL,
  clock_out timestamptz,
  task text,                                    -- what they're working on
  source text NOT NULL DEFAULT 'app',           -- app | past (added after the fact) | admin
  reminder_sent_at timestamptz,                 -- the 4-hour "still clocked in?" text
  approved boolean NOT NULL DEFAULT false,
  approved_by text,
  approved_at timestamptz,
  rejected boolean NOT NULL DEFAULT false,
  reject_note text,
  edited_by text,
  edited_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dssc_staff_shifts_person_idx ON public.dssc_staff_shifts (lower(person_email), clock_in DESC);
CREATE INDEX IF NOT EXISTS dssc_staff_shifts_open_idx ON public.dssc_staff_shifts (clock_in) WHERE clock_out IS NULL;
ALTER TABLE public.dssc_staff_shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_dssc_staff_shifts" ON public.dssc_staff_shifts;
CREATE POLICY "auth_all_dssc_staff_shifts" ON public.dssc_staff_shifts FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Hunter runs DSSC volleyball.
UPDATE public.coaches SET dssc_role = 'admin', sports = ARRAY['volleyball'] WHERE lower(email) IN ('hunter@drippingsportsclub.com', 'hunterhaleysc10@gmail.com');

-- The three new DSSC administrators (Drew, 13 Oct 2026). Pre-approved so they
-- can create their login at drippingsportsclub.com/hq straight away.
INSERT INTO public.allowed_signup_emails (email, added_by_name, note, pre_approved, display_name, dssc_role, dssc_only, sports) VALUES
  ('adrian@drippingsportsclub.com',   'Drew Rose', 'DSSC administrator - approves DSSC basketball hours', TRUE, 'Adrian',            'admin', TRUE, ARRAY['basketball','volleyball']),
  ('jonathan@drippingsportsclub.com', 'Drew Rose', 'DSSC administrator', TRUE, 'Jonathan DelaRosa', 'admin', TRUE, ARRAY['basketball','volleyball']),
  ('deroald@drippingsportsclub.com',  'Drew Rose', 'DSSC administrator', TRUE, 'Deroald',           'admin', TRUE, ARRAY['basketball','volleyball'])
ON CONFLICT (email) DO UPDATE SET pre_approved = TRUE, dssc_role = EXCLUDED.dssc_role, dssc_only = EXCLUDED.dssc_only, sports = EXCLUDED.sports, display_name = COALESCE(public.allowed_signup_emails.display_name, EXCLUDED.display_name), note = EXCLUDED.note;

INSERT INTO public.dssc_people (email, first_name, last_name, role, sports, created_by) VALUES
  ('adrian@drippingsportsclub.com',   'Adrian',   NULL,        'admin', ARRAY['basketball','volleyball'], 'Drew Rose'),
  ('jonathan@drippingsportsclub.com', 'Jonathan', 'DelaRosa',  'admin', ARRAY['basketball','volleyball'], 'Drew Rose'),
  ('deroald@drippingsportsclub.com',  'Deroald',  NULL,        'admin', ARRAY['basketball','volleyball'], 'Drew Rose')
ON CONFLICT (email) DO NOTHING;
