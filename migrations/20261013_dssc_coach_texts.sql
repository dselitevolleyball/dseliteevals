-- The 10am DSSC coach texts (api/dssc-coach-texts.js): one row per coach per
-- day per kind ('day' = class-day reminder, 'recap' = day-after pod recap ask,
-- 'email' = the directors' summary), so a cron retry never texts twice.
CREATE TABLE IF NOT EXISTS public.dssc_coach_texts (
  id bigserial PRIMARY KEY,
  coach_key text NOT NULL,
  coach_name text,
  phone text,
  for_date date NOT NULL,
  kind text NOT NULL,
  items jsonb,
  body text,
  status text,
  error text,
  is_test boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coach_key, for_date, kind)
);
ALTER TABLE public.dssc_coach_texts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_dssc_coach_texts" ON public.dssc_coach_texts;
CREATE POLICY "auth_read_dssc_coach_texts" ON public.dssc_coach_texts FOR SELECT USING (auth.uid() IS NOT NULL);
