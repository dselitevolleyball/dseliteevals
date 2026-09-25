-- 20260925 — Coaches running private lessons at DSSC: interest, and a monthly
-- grid of the days and hours each one can work, so Drew can load them into
-- Playbook.
--
-- Each coach gets a capability link (/privates?t=<token>) like the photo
-- link. One coach_privates row per coach per month ("2026-10"): interested
-- yes/no, the hour blocks she ticked, a note. coach_privates_asks remembers
-- every ask we sent (text / push / email), so the screen can say when a coach
-- was last asked and the monthly job doesn't double up.
--
-- Run: node scripts/run-sql.mjs migrations/20260925_coach_privates.sql
-- Additive, idempotent.

alter table public.coach_roster add column if not exists privates_token uuid;
update public.coach_roster set privates_token = gen_random_uuid() where privates_token is null;
create unique index if not exists coach_roster_privates_token_idx on public.coach_roster(privates_token);

create table if not exists public.coach_privates (
  id           bigserial primary key,
  coach_id     bigint not null references public.coach_roster(id) on delete cascade,
  coach_name   text,
  month        text not null,                  -- 'YYYY-MM'
  interested   boolean,                        -- null = not answered yet
  slots        jsonb not null default '{}'::jsonb,  -- { "Mon": ["15","16","17"], ... } hours (24h) she can start
  note         text,
  submitted_at timestamptz,
  updated_at   timestamptz not null default now(),
  unique (coach_id, month)
);

create table if not exists public.coach_privates_asks (
  id         bigserial primary key,
  coach_id   bigint references public.coach_roster(id) on delete cascade,
  month      text not null,
  channels   text[] not null default '{}',     -- sms | push | email
  is_test    boolean not null default false,
  sent_by    text,
  sent_at    timestamptz not null default now()
);
create index if not exists coach_privates_asks_coach_idx on public.coach_privates_asks(coach_id, month);

alter table public.coach_privates      enable row level security;
alter table public.coach_privates_asks enable row level security;
drop policy if exists "auth_all_coach_privates"      on public.coach_privates;
drop policy if exists "auth_all_coach_privates_asks" on public.coach_privates_asks;
create policy "auth_all_coach_privates"      on public.coach_privates      for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "auth_all_coach_privates_asks" on public.coach_privates_asks for all using (auth.uid() is not null) with check (auth.uid() is not null);

select count(*) as coaches, count(privates_token) as with_link from public.coach_roster;
