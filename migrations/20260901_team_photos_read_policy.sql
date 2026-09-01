-- 20260901 — let coaches actually see the photos families send.
--
-- The bucket was created and the upload path worked, but nothing could be read
-- back: thumbnails stayed blank and downloading gave "Object not found".
--
-- The uploads go in with the service role, which ignores RLS, so they were
-- never blocked. Reading happens in the browser with the coach's own session,
-- and storage.objects has RLS on with no policy naming this bucket — so every
-- object in it was invisible. Storage reports a hidden object as MISSING rather
-- than forbidden, which is why the error pointed at the file rather than at
-- permissions.
--
-- Mirrors the receipts bucket: approved coaches read, admins manage.
--
-- Run: node scripts/run-sql.mjs migrations/20260901_team_photos_read_policy.sql
-- Additive and idempotent.

CREATE OR REPLACE FUNCTION public.is_approved_coach()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved);
$$;

DROP POLICY IF EXISTS team_photos_read_approved ON storage.objects;
CREATE POLICY team_photos_read_approved ON storage.objects
  FOR SELECT
  USING (bucket_id = 'team-photos' AND public.is_approved_coach());

-- Deleting a photo is an admin job — a coach clearing their own team's gallery
-- by accident is not recoverable.
DROP POLICY IF EXISTS team_photos_admin_all ON storage.objects;
CREATE POLICY team_photos_admin_all ON storage.objects
  FOR ALL
  USING      (bucket_id = 'team-photos' AND public.is_admin_coach())
  WITH CHECK (bucket_id = 'team-photos' AND public.is_admin_coach());
