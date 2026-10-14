-- The testing leaderboard TV (Drew, Oct 14 2026: "a display that will highlight
-- the top 20 athletes for each of the measurements ... shown on 42" touch
-- screen tv"). One row per display; the TV opens /board?k=<key> and
-- api/leaderboard.js answers only for a key on this table. Service role only:
-- no browser policies, so the keys can't be read with the anon key.
--   settings: optional overrides, e.g. {"title": "...", "subtitle": "...",
--             "slide_seconds": 14, "idle_seconds": 75}
-- Run: node scripts/run-sql.mjs migrations/20261014f_stat_boards.sql
create table if not exists public.stat_boards (
  key         text primary key,
  label       text not null default 'Leaderboard TV',
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
alter table public.stat_boards enable row level security;
grant all on public.stat_boards to service_role;

insert into public.stat_boards (key, label)
select replace(gen_random_uuid()::text, '-', ''), 'DSSC touch-screen TV'
where not exists (select 1 from public.stat_boards);

select label, key from public.stat_boards;
