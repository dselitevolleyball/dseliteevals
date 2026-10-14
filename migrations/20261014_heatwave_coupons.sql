-- Heatwave VB ATX coupon codes (Drew, 14 Oct 2026). A family enters a code on
-- the application; it changes the total (and so the balance charged on
-- acceptance) before the deposit is paid.
--   percent  value = % off the sessions' price
--   amount   value = dollars off
--   fixed    value = the new total; deposit = what the deposit becomes
-- emails: only these sign-in emails can use it (NULL = anyone).
-- max_uses counts applications that paid their deposit with the code.
-- HWTEST is Drew's end-to-end test: $1.00 total = $0.50 deposit (Stripe's
-- minimum charge) + $0.50 balance on acceptance, so the real card flow,
-- saved card, balance charge and refund all run for a dollar.
-- Run: node scripts/run-sql.mjs migrations/20261014_heatwave_coupons.sql
CREATE TABLE IF NOT EXISTS public.heatwave_coupons (
  code text PRIMARY KEY CHECK (code = upper(code) AND code ~ '^[A-Z0-9_-]{3,30}$'),
  kind text NOT NULL CHECK (kind IN ('percent', 'amount', 'fixed')),
  value numeric NOT NULL CHECK (value >= 0),
  deposit numeric CHECK (deposit IS NULL OR deposit >= 0),
  max_uses int,
  emails text[],
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.heatwave_applications
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS list_amount numeric,
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE public.heatwave_coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_all_heatwave_coupons" ON public.heatwave_coupons;
CREATE POLICY "staff_all_heatwave_coupons" ON public.heatwave_coupons FOR ALL USING (public.is_heatwave_staff()) WITH CHECK (public.is_heatwave_staff());
INSERT INTO public.heatwave_coupons (code, kind, value, deposit, emails, note, created_by)
VALUES ('HWTEST', 'fixed', 1.00, 0.50, ARRAY['drew@drippingsportsclub.com', 'drew@dselitevolleyball.com'],
        'Drew''s end-to-end test: $1.00 total ($0.50 deposit + $0.50 balance). Only Drew''s emails can use it.', 'Claude')
ON CONFLICT (code) DO NOTHING;
SELECT code, kind, value, deposit, emails, active FROM public.heatwave_coupons;
