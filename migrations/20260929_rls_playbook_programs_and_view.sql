-- 20260929 — Close the gaps the Supabase security advisor flagged.
--
-- 1. playbook_programs / playbook_program_runs had Row-Level Security off, so
--    anyone holding the public (anon) key — which ships in the app bundle —
--    could read, edit and delete them. Only the daily cron writes them
--    (api/playbook-programs.js, service role, which RLS doesn't restrict), so
--    RLS goes on with a read-only policy for signed-in users and no write
--    policy at all.
--
-- 2. coach_family_tournaments is a view of coaches' children, their teams and
--    their shared tournaments. It ran with its owner's rights (bypassing RLS
--    on players etc.) and anon had SELECT on it, so a logged-out visitor with
--    the public key could list those children. Nothing in the app reads it.
--    It now runs with the caller's rights (security_invoker) and anon loses
--    access; signed-in staff still see it through the base tables' policies.
--
-- Run: node scripts/run-sql.mjs migrations/20260929_rls_playbook_programs_and_view.sql

alter table public.playbook_programs     enable row level security;
alter table public.playbook_program_runs enable row level security;
drop policy if exists "auth_read_playbook_programs"     on public.playbook_programs;
drop policy if exists "auth_read_playbook_program_runs" on public.playbook_program_runs;
create policy "auth_read_playbook_programs"     on public.playbook_programs     for select using (auth.uid() is not null);
create policy "auth_read_playbook_program_runs" on public.playbook_program_runs for select using (auth.uid() is not null);

alter view public.coach_family_tournaments set (security_invoker = true);
revoke all on public.coach_family_tournaments from anon;

select c.relname, c.relrowsecurity as rls_on
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity;
