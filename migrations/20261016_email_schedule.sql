-- Emails queued for a later day (Drew, Oct 16 2026: gear-store reminders on
-- Oct 23, Oct 30 and Nov 1). /api/send-email can only hand Resend a send up
-- to 72 hours out, so anything further waits here and api/email-schedule.js
-- (hourly cron) sends it once send_at has passed.
--   audience: 'families' = parents of every current DS Elite player (team +
--             live offer), worked out at send time; 'emails' = recipients[].
-- Cancel one before it goes: update email_schedule set status = 'cancelled' where id = …;
-- Run: node scripts/run-sql.mjs migrations/20261016_email_schedule.sql
create table if not exists public.email_schedule (
  id          bigserial primary key,
  send_at     timestamptz not null,
  subject     text not null,
  body        text not null,
  body_html   text,
  audience    text not null default 'families' check (audience in ('families', 'emails')),
  recipients  jsonb not null default '[]'::jsonb,
  label       text,
  status      text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  sent_at     timestamptz,
  result      jsonb,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists email_schedule_due on public.email_schedule (status, send_at);
alter table public.email_schedule enable row level security;
grant all on public.email_schedule to service_role;
grant usage, select on sequence public.email_schedule_id_seq to service_role;
select 'ok' as done;
