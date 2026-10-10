-- Tournament Hub: each DS Elite team's schedule and results at a tournament,
-- pulled from the platform that runs it (AES or OTTO, the renamed SportWrench),
-- for coaches in HQ and for parents on the public /hub page (Drew, 10 Oct 2026:
-- "a way to track teams' performances at tournaments ... like Volleyball Hub").
--
-- Where a team's games live is not where it registered: most Texas events take
-- entries on SportWrench/OTTO but publish schedules on AES, and one tournaments
-- row can be several platform events (Lone Star Classic is one AES event per
-- site). So the link is per (tournament, team), found by api/tournament-sync.js
-- and fixable by hand.
--
-- Run: node scripts/run-sql.mjs migrations/20261010_tournament_hub.sql

-- Each team's id on each platform. AES team ids are global (the same TeamId in
-- every event); OTTO's per-event team ids change, its master_team_id doesn't.
alter table public.practice_teams add column if not exists aes_team_id integer;
alter table public.practice_teams add column if not exists otto_master_team_id integer;

-- Venue time zone. Both platforms give match times as local wall-clock with no
-- zone, so "now" and "next match" have to be judged in the venue's zone.
-- Null = America/Chicago.
alter table public.tournaments add column if not exists time_zone text;

-- A platform event a tournament's games are on.
--   platform   'aes' | 'otto'
--   event_ref  AES: eventId, or 'sched:<eventSchedulerId>' for scheduler-only
--              events (no eventId); OTTO: the numeric event id
--   event_key  what the results API takes: AES eventSchedulerKey, OTTO 9-hex
--              esw id. Null until the director publishes the schedule.
create table if not exists public.tournament_feeds (
  id              bigserial primary key,
  tournament_id   bigint not null references public.tournaments(id) on delete cascade,
  platform        text not null check (platform in ('aes','otto')),
  event_ref       text not null,
  event_key       text,
  event_name      text,
  start_date      date,
  end_date        date,
  location        text,
  published       boolean not null default false,
  linked_by       text not null default 'auto',     -- 'auto' | 'manual'
  last_stamp      text,                              -- AES LastUpdatedTimestamp / OTTO payload hash
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tournament_id, platform, event_ref)
);
create index if not exists tournament_feeds_tn_idx on public.tournament_feeds (tournament_id);

-- One row per DS Elite team at a tournament: which feed its games are on, its
-- id there, and the latest normalized snapshot (shape in shared/tournament-feed.js).
create table if not exists public.tournament_team_feed (
  tournament_id    bigint not null references public.tournaments(id) on delete cascade,
  team_name        text not null,
  feed_id          bigint references public.tournament_feeds(id) on delete set null,
  platform_team_id text,
  division_id      text,
  division_name    text,
  snapshot         jsonb,
  synced_at        timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (tournament_id, team_name)
);

-- When discovery last looked for a tournament's events, so the 5-minute cron
-- only searches the platforms every few hours.
alter table public.tournaments add column if not exists feed_discovered_at timestamptz;

-- Parents (and anyone) who tapped "Notify me" on /hub. Kept apart from the
-- coaches' push_subscriptions on purpose: coach broadcasts must never reach
-- parents. Written only by api/hub-subscribe.js (service role).
create table if not exists public.hub_push_subscriptions (
  endpoint    text primary key,
  p256dh      text not null,
  auth        text not null,
  teams       text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  failures    integer not null default 0
);

-- Alerts already sent, so each fact ("next match: 2:30 Court 7", "won 2-0")
-- goes out once however often the sync runs.
create table if not exists public.hub_alerts_sent (
  id             bigserial primary key,
  tournament_id  bigint not null,
  team_name      text not null,
  kind           text not null,
  key            text not null,
  body           text,
  recipients     integer,
  sent_at        timestamptz not null default now(),
  unique (tournament_id, team_name, kind, key)
);

-- Coaches read feeds and snapshots in HQ, same rule as tournaments.
alter table public.tournament_feeds enable row level security;
drop policy if exists tournament_feeds_all_approved on public.tournament_feeds;
create policy tournament_feeds_all_approved on public.tournament_feeds
  for all
  using      (exists (select 1 from public.coaches c where c.id = auth.uid() and c.is_approved))
  with check (exists (select 1 from public.coaches c where c.id = auth.uid() and c.is_approved));

alter table public.tournament_team_feed enable row level security;
drop policy if exists tournament_team_feed_all_approved on public.tournament_team_feed;
create policy tournament_team_feed_all_approved on public.tournament_team_feed
  for all
  using      (exists (select 1 from public.coaches c where c.id = auth.uid() and c.is_approved))
  with check (exists (select 1 from public.coaches c where c.id = auth.uid() and c.is_approved));

-- Service role only (no policies).
alter table public.hub_push_subscriptions enable row level security;
alter table public.hub_alerts_sent enable row level security;

-- Platform ids, found 10 Oct 2026: AES club 32611 (DSELI) /api/clubs/32611/teams,
-- OTTO master_team_id from paginatedClubs(search:"DSELI").
update public.practice_teams p set aes_team_id = v.aes, otto_master_team_id = coalesce(v.otto, p.otto_master_team_id)
from (values
  ('11 Diamond', 226736, 184253), ('12 Diamond', 226737, 184255), ('12 Ruby', 226738, 184256),
  ('13 Diamond', 218685, 184258), ('13 Ruby', 233298, null),      ('13 Sapphire', 237078, 184260),
  ('13 Emerald', 237079, 184261), ('14 Diamond', 218683, 184263), ('14 Ruby', 218684, 184264),
  ('14 Sapphire', 237080, null),  ('14 Emerald', 237081, null),   ('14 Topaz', 237082, 184267),
  ('15 Diamond', 237083, 184268), ('15 Ruby', 237084, 184269),    ('15 Sapphire', 237085, 184270),
  ('15 Emerald', 237086, 184271), ('16 Diamond', 237087, 184272)
) as v(team, aes, otto)
where p.team_name = v.team and p.aes_team_id is null;
update public.practice_teams set otto_master_team_id = 195215 where team_name = '14 Crystal' and otto_master_team_id is null;

-- Venues off Central time this season (the code also infers a zone from the
-- state in location when this is blank).
update public.tournaments set time_zone = 'Pacific/Honolulu'    where id = 167 and time_zone is null;                     -- SPAM Slam, Honolulu
update public.tournaments set time_zone = 'America/Los_Angeles' where id in (184, 205, 780, 471, 616) and time_zone is null; -- Las Vegas, Anaheim
update public.tournaments set time_zone = 'America/New_York'    where id in (777, 778, 779) and time_zone is null;         -- AAU Nationals, Orlando

select team_name, aes_team_id, otto_master_team_id from public.practice_teams order by team_name;
