-- 20260925 — Team and coach text broadcasts, and an inbox grouped by team.
--
-- A broadcast is one message fanned out as INDIVIDUAL texts: every recipient
-- gets her own thread with the club number, replies come back one-to-one, and
-- nobody sees anyone else's number. sms_broadcasts records the send as a
-- whole; each sms_messages row points back at it.
--
-- Threads carry the team and who the number belongs to, so the inbox can file
-- a parent's reply under her daughter's team and a coach's under Coaches.
--
-- sms_consents is the record of who opted in to texts (the /text-updates
-- form). Team audiences default to opted-in numbers only; the composer shows
-- who is being held back and lets the sender include them on purpose.
--
-- Run: node scripts/run-sql.mjs migrations/20260925_sms_broadcasts.sql
-- Additive, idempotent.

alter table public.sms_threads add column if not exists team_name    text;
alter table public.sms_threads add column if not exists contact_kind text;   -- parent | player | coach | other
alter table public.sms_threads add column if not exists contact_name text;

create table if not exists public.sms_broadcasts (
  id               bigserial primary key,
  body             text not null,
  audience         jsonb,                      -- { type: 'team'|'coaches', team, who, include_unconsented }
  recipient_count  int  not null default 0,
  sent_count       int  not null default 0,
  failed_count     int  not null default 0,
  sent_by_coach_id uuid references public.coaches(id) on delete set null,
  sent_by_label    text,
  created_at       timestamptz not null default now()
);

alter table public.sms_messages add column if not exists broadcast_id bigint references public.sms_broadcasts(id) on delete set null;
create index if not exists sms_messages_broadcast_idx on public.sms_messages(broadcast_id);

create table if not exists public.sms_consents (
  phone        text primary key,               -- E.164
  name         text,
  source       text,                           -- 'text-updates form' | 'pasted' | ...
  consented_at timestamptz not null default now(),
  added_by     text,
  notes        text
);

alter table public.sms_broadcasts enable row level security;
alter table public.sms_consents   enable row level security;
drop policy if exists "auth_all_sms_broadcasts" on public.sms_broadcasts;
drop policy if exists "auth_all_sms_consents"   on public.sms_consents;
create policy "auth_all_sms_broadcasts" on public.sms_broadcasts for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "auth_all_sms_consents"   on public.sms_consents   for all using (auth.uid() is not null) with check (auth.uid() is not null);

select count(*) as threads, count(team_name) as with_team from public.sms_threads;
