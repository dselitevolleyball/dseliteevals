-- DS Elite stock photos (Drew, Oct 30 2026: "I am going to upload a bunch of
-- pictures to be able to use for social media posts"). Uploaded in HQ ->
-- Social -> Stock photos, shrunk in the browser, stored public in the
-- dse-social bucket under stock/. Idea / "Your idea" graphics use them before
-- photos from past posts, the team's own first, least-used first.
create table if not exists public.dse_social_stock (
  id           bigint generated always as identity primary key,
  storage_path text not null unique,          -- dse-social bucket, stock/...
  url          text not null,
  thumb_path   text,
  thumb_url    text,
  width        int,
  height       int,
  team_name    text,                          -- practice_teams.team_name; null = the whole club
  note         text,                          -- what's in it ("13 Diamond huddle at CTPL"), for Drew and for Claude
  original_name text,
  hidden       boolean not null default false,
  used_count   int not null default 0,
  last_used_at timestamptz,
  uploaded_by  text,
  created_at   timestamptz not null default now()
);
create index if not exists dse_social_stock_team on public.dse_social_stock (team_name, hidden);
alter table public.dse_social_stock enable row level security;   -- service role only (HQ's /api/dse-social)
