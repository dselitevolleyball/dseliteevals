-- Heatwave applications (Drew, 14 Oct 2026): "almost like a college application".
-- Register + pay a $250 deposit (card saved for the balance), then in the
-- applicant portal: add film (links/uploads) and name a club coach/director who
-- submits a letter of recommendation through their own link. Automated
-- reminders. HQ reviews (film player, letter) and accepts (charge the balance),
-- waitlists, or declines (refund the deposit).
-- Families log in with an emailed 6-digit code - NOT Supabase Auth (that's the
-- coaches' login, gated by allowed_signup_emails). All access from the
-- heatwaveatx.com API with the service role; HQ (authenticated staff) reads.
-- Run: node scripts/run-sql.mjs migrations/20261014_heatwave_applications.sql

ALTER TABLE public.dssc_camp_sessions ADD COLUMN IF NOT EXISTS applications_open boolean NOT NULL DEFAULT false;
UPDATE public.dssc_camp_sessions SET applications_open = true WHERE focus = 'winter';

CREATE TABLE IF NOT EXISTS public.heatwave_login_codes (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS heatwave_login_codes_email_idx ON public.heatwave_login_codes (lower(email), created_at DESC);

CREATE TABLE IF NOT EXISTS public.heatwave_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_email text NOT NULL,                -- who logs in (usually a parent)
  parent_name text, parent_phone text,
  player_name text, player_email text, player_phone text,
  grad_year text, birthdate date, age_group text,       -- 14s / 15s / 16s
  position text, height text,
  club text, team text, club_director text, level text,  -- national / bubble / regional
  city text, notes text,
  session_ids int[] NOT NULL DEFAULT '{}',
  total_amount numeric NOT NULL DEFAULT 0,    -- sessions' price, before card fees
  deposit_amount numeric NOT NULL DEFAULT 250,
  -- draft -> deposit_pending (bank payment clearing) -> submitted (deposit paid)
  -- -> complete (film + letter in) -> accepted | waitlisted | declined; withdrawn
  status text NOT NULL DEFAULT 'draft',
  stripe_customer_id text, stripe_payment_method_id text, card_brand text, card_last4 text, card_funding text,
  deposit_intent_id text, deposit_fee numeric NOT NULL DEFAULT 0, deposit_paid_at timestamptz,
  balance_intent_id text, balance_amount numeric, balance_fee numeric NOT NULL DEFAULT 0, balance_paid_at timestamptz, balance_error text,
  refund_id text, refunded_at timestamptz,
  decision text, decision_note text, decided_by text, decided_at timestamptz,
  review_notes text, rating int,
  submitted_at timestamptz, completed_at timestamptz,
  last_family_reminder_at timestamptz, family_reminders int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS heatwave_applications_email_idx ON public.heatwave_applications (lower(account_email));

CREATE TABLE IF NOT EXISTS public.heatwave_film (
  id bigserial PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES public.heatwave_applications(id) ON DELETE CASCADE,
  kind text NOT NULL,                         -- link | upload
  url text, storage_path text, file_name text, bytes bigint,
  title text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.heatwave_recommendations (
  id bigserial PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES public.heatwave_applications(id) ON DELETE CASCADE,
  name text NOT NULL, email text NOT NULL, role text, club text, phone text,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'requested',   -- requested | submitted | cancelled
  letter_text text, letter_path text, letter_file_name text,
  relationship text, years_known text, level_rating text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  reminders int NOT NULL DEFAULT 0, last_reminder_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.heatwave_events (
  id bigserial PRIMARY KEY,
  application_id uuid REFERENCES public.heatwave_applications(id) ON DELETE CASCADE,
  kind text NOT NULL, detail text, actor text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.heatwave_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- 3% on credit cards only, OFF until surcharging is registered with Stripe/the
-- card brands (~30 days' notice). Debit, prepaid and bank payments never pay it.
INSERT INTO public.heatwave_settings (key, value) VALUES ('surcharge', '{"enabled": false, "pct": 3}'::jsonb) ON CONFLICT (key) DO NOTHING;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['heatwave_login_codes','heatwave_applications','heatwave_film','heatwave_recommendations','heatwave_events','heatwave_settings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "staff_all_%s" ON public.%I', t, t);
    -- Families never touch these directly (service role via the site API).
    -- Staff signed in to HQ read and update them; login codes stay server-only.
    IF t <> 'heatwave_login_codes' THEN
      EXECUTE format('CREATE POLICY "staff_all_%s" ON public.%I FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)', t, t);
    END IF;
  END LOOP;
END $$;

-- Private bucket for uploaded film and letter files (50 MB a file: the
-- project's plan limit). Staff read through signed URLs.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('heatwave-apps', 'heatwave-apps', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 52428800;
DROP POLICY IF EXISTS "heatwave_apps_staff_read" ON storage.objects;
CREATE POLICY "heatwave_apps_staff_read" ON storage.objects FOR SELECT USING (bucket_id = 'heatwave-apps' AND auth.uid() IS NOT NULL);
