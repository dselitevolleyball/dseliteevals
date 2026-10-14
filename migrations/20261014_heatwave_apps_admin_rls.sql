-- Heatwave applications hold recommendation letters (confidential), family
-- contact details and payment status, so HQ access is admins only, not every
-- signed-in coach: DS Elite admins (is_admin) and DSSC admins (dssc_role
-- 'admin'), the same people heatwaveatx.com/api/admin accepts.
-- Run: node scripts/run-sql.mjs migrations/20261014_heatwave_apps_admin_rls.sql
CREATE OR REPLACE FUNCTION public.is_heatwave_staff()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved AND (c.is_admin OR c.dssc_role = 'admin'));
$$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['heatwave_applications','heatwave_film','heatwave_recommendations','heatwave_events','heatwave_settings'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "staff_all_%s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "staff_all_%s" ON public.%I FOR ALL USING (public.is_heatwave_staff()) WITH CHECK (public.is_heatwave_staff())', t, t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS "heatwave_apps_staff_read" ON storage.objects;
CREATE POLICY "heatwave_apps_staff_read" ON storage.objects FOR SELECT USING (bucket_id = 'heatwave-apps' AND public.is_heatwave_staff());
SELECT tablename, policyname, qual FROM pg_policies WHERE tablename LIKE 'heatwave_%' OR policyname = 'heatwave_apps_staff_read' ORDER BY 1;
