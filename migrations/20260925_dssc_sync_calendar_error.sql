-- The calendar now pulls itself every hour (api/playbook-calendar.js). Like the
-- registrations pull, it remembers its last failure so a repeat is not re-mailed.
-- Run: node scripts/run-sql.mjs migrations/20260925_dssc_sync_calendar_error.sql
alter table public.dssc_sync add column if not exists calendar_error text;
alter table public.dssc_sync add column if not exists calendar_error_at timestamptz;
