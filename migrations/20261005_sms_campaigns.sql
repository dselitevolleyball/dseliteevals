-- SMS campaigns: a saved audience (filters), a message template, and a send
-- that's tracked per recipient. Used by DSSC Texts → Campaigns.
--
--   sms_segments            reusable audiences (filters jsonb)
--   sms_campaigns           draft / scheduled / sending / sent / cancelled
--   sms_campaign_recipients one row per number, snapshotted at send time with
--                           its personalised body; the sender works through the
--                           pending rows in batches (client loop + 10-min cron)
-- Brand is per campaign: 'dssc' = club number, 'dse' = DS Elite number.

create table if not exists sms_segments (
  id          bigserial primary key,
  brand       text not null default 'dssc',
  name        text not null,
  filters     jsonb not null default '{}'::jsonb,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists sms_campaigns (
  id              bigserial primary key,
  brand           text not null default 'dssc' check (brand in ('dssc','dse')),
  name            text not null default 'Untitled campaign',
  status          text not null default 'draft' check (status in ('draft','scheduled','sending','sent','cancelled','failed')),
  filters         jsonb not null default '{}'::jsonb,
  segment_id      bigint references sms_segments(id) on delete set null,
  body            text not null default '',
  media_urls      text[] not null default '{}',
  scheduled_at    timestamptz,
  started_at      timestamptz,
  sent_at         timestamptz,
  broadcast_id    bigint,
  recipient_count int not null default 0,
  sent_count      int not null default 0,
  failed_count    int not null default 0,
  skipped_count   int not null default 0,
  last_error      text,
  test_sent_at    timestamptz,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists sms_campaigns_status_idx on sms_campaigns (status, scheduled_at);

create table if not exists sms_campaign_recipients (
  id           bigserial primary key,
  campaign_id  bigint not null references sms_campaigns(id) on delete cascade,
  phone        text not null,
  name         text,
  kind         text,                 -- parent | player | coach
  players      text[] not null default '{}',
  team_name    text,
  program      text,
  body         text not null,
  status       text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  message_id   bigint,
  error        text,
  sent_at      timestamptz,
  unique (campaign_id, phone)
);
create index if not exists sms_campaign_recipients_pending_idx on sms_campaign_recipients (campaign_id, status);

-- Directors read/write from the app (same trust as the rest of DSSC Texts:
-- any signed-in approved coach can read; the API does the sending with the
-- service role and checks who is asking).
alter table sms_segments enable row level security;
alter table sms_campaigns enable row level security;
alter table sms_campaign_recipients enable row level security;
do $$ begin
  create policy sms_segments_rw on sms_segments for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy sms_campaigns_rw on sms_campaigns for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy sms_campaign_recipients_read on sms_campaign_recipients for select to authenticated using (true);
exception when duplicate_object then null; end $$;
