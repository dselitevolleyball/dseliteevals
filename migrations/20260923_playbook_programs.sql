-- What Playbook (drippingsports.playbookapi.com) is currently publishing.
--
-- The public /programs/register/ page carries a filter list of every live
-- listing — programs, seasons, memberships and pass packages — by name. A daily
-- cron (api/playbook-programs.js) reads it, keeps this table current, and
-- emails Drew what appeared and what disappeared. Names are the key: the page
-- exposes no ids to an anonymous visitor.
create table if not exists public.playbook_programs (
  kind        text        not null,          -- programs | seasons | memberships | pass_packages
  name        text        not null,
  first_seen  date        not null default current_date,
  last_seen   date        not null default current_date,
  active      boolean     not null default true,
  gone_since  date,                          -- set when it drops off the page
  primary key (kind, name)
);

comment on table public.playbook_programs is
  'Playbook listings as seen by the daily cron. active=false + gone_since when a listing is no longer published.';

-- One row per run so a quiet day is distinguishable from a broken fetch.
create table if not exists public.playbook_program_runs (
  id          bigserial primary key,
  ran_at      timestamptz not null default now(),
  listed      int         not null,
  added       int         not null default 0,
  removed     int         not null default 0,
  returned    int         not null default 0,
  emailed     boolean     not null default false,
  note        text
);
