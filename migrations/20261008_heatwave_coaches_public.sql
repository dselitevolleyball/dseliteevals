-- Heatwave: coaches on the public site (heatwaveatx.com hero), and every session
-- is two days, 14 athletes, $1,600 ($800/day). Oct 8 2026, Drew.
-- Run: node scripts/run-sql.mjs migrations/20261008_heatwave_coaches_public.sql

ALTER TABLE public.dssc_camp_coaches
  ADD COLUMN IF NOT EXISTS photo_url    TEXT,
  ADD COLUMN IF NOT EXISTS bio          TEXT,
  ADD COLUMN IF NOT EXISTS show_on_site BOOLEAN NOT NULL DEFAULT FALSE;

-- Public bucket for coach headshots (the site shows them; HQ users upload).
INSERT INTO storage.buckets (id, name, public) VALUES ('heatwave', 'heatwave', true) ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "heatwave_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "heatwave_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "heatwave_auth_delete" ON storage.objects;
CREATE POLICY "heatwave_auth_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'heatwave');
CREATE POLICY "heatwave_auth_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'heatwave');
CREATE POLICY "heatwave_auth_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'heatwave');

UPDATE public.dssc_camp_sessions SET days = 2, cap = 14, price_per_day = 800;
