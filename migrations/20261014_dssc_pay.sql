-- DSSC pay, editable (Drew, 14 Oct 2026): "add payment information, hourly
-- rate, calculate how much they're getting paid per shift ... volleyball pods
-- [are] a different payment structure that we need to include, and be able to edit."
--
--  dssc_pay_settings (one row): the club defaults - class hourly rate, staff
--    hourly rate, which sports' pods pay by tier, and the pod tier table.
--    Shape: see shared/dssc-pay.js DEFAULT_PAY. Empty = the defaults there.
--  dssc_pay_rates: per-person overrides, keyed by the person's name the way
--    sessions/clock-ins name them. class_rate = $/hr for class clock-ins,
--    staff_rate = $/hr for general (staff) shifts. NULL = use the default.
--    A coach's pod tier stays on dssc_availability.tier.
-- Run: node scripts/run-sql.mjs migrations/20261014_dssc_pay.sql

CREATE TABLE IF NOT EXISTS public.dssc_pay_settings (
  id int PRIMARY KEY DEFAULT 1,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dssc_pay_settings_one_row CHECK (id = 1)
);
INSERT INTO public.dssc_pay_settings (id, data, updated_by) VALUES (1, '{}'::jsonb, 'migration') ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.dssc_pay_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_dssc_pay_settings" ON public.dssc_pay_settings;
CREATE POLICY "auth_all_dssc_pay_settings" ON public.dssc_pay_settings FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.dssc_pay_rates (
  person_key text PRIMARY KEY,          -- lower-cased name, single spaces
  person_name text NOT NULL,
  email text,
  class_rate numeric,
  staff_rate numeric,
  notes text,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dssc_pay_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_dssc_pay_rates" ON public.dssc_pay_rates;
CREATE POLICY "auth_all_dssc_pay_rates" ON public.dssc_pay_rates FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
