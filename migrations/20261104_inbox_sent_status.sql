-- The last Sent-folder check for each director's Gmail (api/site-inbox-sent-poll.js),
-- so a run can be checked without the cron secret or Vercel's logs (Oct 27 2026).
create table if not exists site_inbox_sent_status (
  account       text primary key,
  last_run_at   timestamptz not null default now(),
  scanned       int not null default 0,
  filed         int not null default 0,
  duplicates    int not null default 0,
  error         text,
  last_ok_at    timestamptz,
  last_filed_at timestamptz
);
alter table site_inbox_sent_status enable row level security;
