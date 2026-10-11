-- Daily registration check (Drew, 11 Oct 2026: "Fix HQ now — do a daily
-- check as well"). Compares what AES and OTTO (the renamed SportWrench) say
-- about each DS Elite team's tournament registrations with the statuses in
-- tournament_assignments: brings "registered" up to "accepted" when AES has
-- accepted the team, and flags what a person has to look at (a team AES
-- dropped, a team HQ thinks is going but the platform doesn't list, a team
-- entered somewhere HQ doesn't know about).
--
-- Run: node scripts/run-sql.mjs migrations/20261011_registration_check.sql

-- What the platforms say, one row per (platform event, DS Elite team).
--   status: AES acceptedType ('Accepted', 'Pending', 'Dropped', 'Waitlisted', …)
--           or 'Entered' when only presence is known (OTTO; AES events whose
--           team list is hidden).
create table if not exists public.tournament_registrations (
  id                bigserial primary key,
  platform          text not null check (platform in ('aes','otto')),
  event_ref         text not null,                 -- AES eventId / OTTO numeric event id
  event_name        text,
  event_start       date,
  event_end         date,
  event_location    text,
  team_name         text not null,                 -- HQ practice_teams.team_name
  platform_team_id  text,
  division          text,
  status            text not null,
  tournament_id     bigint references public.tournaments(id) on delete set null,
  match_how         text,                          -- 'source_url' | 'feed' | 'name+date' | null
  first_seen_at     timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  gone_at           timestamptz,                   -- no longer listed by the platform
  unique (platform, event_ref, team_name)
);
create index if not exists tournament_registrations_tn_idx on public.tournament_registrations (tournament_id);

-- Things a person should look at. key is stable per fact so a flag is raised
-- (and emailed) once, and resolved when it stops being true.
--   kind: 'dropped_on_platform' | 'not_on_platform' | 'not_in_hq' |
--         'unknown_event' | 'not_found' | 'auto_updated'
create table if not exists public.registration_flags (
  id               bigserial primary key,
  key              text not null unique,
  kind             text not null,
  tournament_id    bigint references public.tournaments(id) on delete cascade,
  team_name        text,
  message          text not null,
  detail           jsonb,
  first_flagged_at timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  resolved_at      timestamptz,
  emailed_at       timestamptz,
  dismissed_at     timestamptz,
  dismissed_by     text
);
create index if not exists registration_flags_open_idx on public.registration_flags (resolved_at, dismissed_at);

-- One row per run: when, what it changed, how many calls, errors.
create table if not exists public.registration_check_runs (
  id        bigserial primary key,
  run_at    timestamptz not null default now(),
  ok        boolean not null default true,
  summary   jsonb,
  error     text
);

-- Coaches read all three in HQ (same rule as tournaments); approved coaches
-- may dismiss a flag. Writes otherwise come from the service role.
alter table public.tournament_registrations enable row level security;
drop policy if exists tournament_registrations_read on public.tournament_registrations;
create policy tournament_registrations_read on public.tournament_registrations
  for select using (exists (select 1 from public.coaches c where c.id = auth.uid() and c.is_approved));

alter table public.registration_flags enable row level security;
drop policy if exists registration_flags_read on public.registration_flags;
create policy registration_flags_read on public.registration_flags
  for select using (exists (select 1 from public.coaches c where c.id = auth.uid() and c.is_approved));
drop policy if exists registration_flags_dismiss on public.registration_flags;
create policy registration_flags_dismiss on public.registration_flags
  for update using (exists (select 1 from public.coaches c where c.id = auth.uid() and c.is_approved))
  with check (exists (select 1 from public.coaches c where c.id = auth.uid() and c.is_approved));

alter table public.registration_check_runs enable row level security;
drop policy if exists registration_check_runs_read on public.registration_check_runs;
create policy registration_check_runs_read on public.registration_check_runs
  for select using (exists (select 1 from public.coaches c where c.id = auth.uid() and c.is_approved));

select 'ok' as done;
