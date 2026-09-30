-- The hourly Playbook calendar pull emails only after two failed runs in a row;
-- a single slow hour recovers on its own at the next run.
alter table public.dssc_sync add column if not exists calendar_fail_streak int not null default 0;
