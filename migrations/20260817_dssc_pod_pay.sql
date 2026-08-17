-- Skill Pod economics: coach tier, and how many players actually showed.
--
-- DSSC clinic pay has been a flat $25/hr for everyone. Pods replace that with
-- a tiered model: a coach earns a base for the session plus a bonus for each
-- player beyond the first, so filling a pod pays. Two things have to be stored
-- for that to be computable — what tier the coach is, and how many players
-- turned up to the session.

-- 1. Coach tier. Lives on dssc_availability, which is already the DSSC-specific
--    record for a coach (availability, can_lead, skills) and is keyed on the
--    same coach_name the sessions and check-ins use. Null = not yet tiered;
--    those coaches keep falling back to the flat hourly rate.
alter table public.dssc_availability
  add column if not exists tier text
  check (tier is null or tier in ('competitive', 'elite', 'master'));

comment on column public.dssc_availability.tier is
  'Competitive / Elite / Master, lowest to highest. Sets pod pay: base + per-player bonus ($30+$15, $50+$20, $80+$30).';

-- 2. Attendance, PODS ONLY. A separate table rather than a field on the session
--    JSONB: this is payroll input, so it wants its own audit trail (who counted,
--    when), and it must not depend on the Playbook re-sync merge keeping an
--    unrecognised key alive. One row per session.
create table if not exists public.dssc_pod_attendance (
  id            bigint generated always as identity primary key,
  clinic_id     bigint not null references public.dssc_clinics(id) on delete cascade,
  session_id    text   not null,
  session_date  date   not null,
  players       int    not null check (players >= 0 and players <= 12),
  note          text,
  recorded_by   text,
  recorded_at   timestamptz not null default now(),
  unique (clinic_id, session_id)
);

comment on table public.dssc_pod_attendance is
  'Players who showed to a Skill Pod session. Drives coach pay (base + per-player).';

create index if not exists dssc_pod_attendance_date on public.dssc_pod_attendance (session_date);

alter table public.dssc_pod_attendance enable row level security;

-- Same posture as the other DSSC tables: any signed-in coach reads; writes are
-- the director's, enforced in the app rather than by a per-row policy.
drop policy if exists dssc_pod_attendance_rw on public.dssc_pod_attendance;
create policy dssc_pod_attendance_rw on public.dssc_pod_attendance
  for all to authenticated using (true) with check (true);
