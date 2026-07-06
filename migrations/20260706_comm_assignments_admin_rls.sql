-- 20260706 — Lock communication-assignment tables to admins only.
--
-- Assignments + their per-team status are an admin/ops feature. Previously the
-- RLS allowed any authenticated user; tighten to is_admin coaches so a non-admin
-- can't read or modify them even via a direct API query. (comm_reminder_log
-- stays readable by all authenticated users so coaches still get their in-app
-- reminder notifications.)
--
-- Run: node scripts/run-sql.mjs migrations/20260706_comm_assignments_admin_rls.sql
-- Idempotent. Service-role writes (cron) bypass RLS regardless.

DROP POLICY IF EXISTS auth_all_comm_assignments ON public.comm_assignments;
DROP POLICY IF EXISTS auth_all_comm_status      ON public.comm_assignment_status;

CREATE POLICY admin_all_comm_assignments ON public.comm_assignments
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_admin));

CREATE POLICY admin_all_comm_status ON public.comm_assignment_status
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_admin));
