-- Repeat physical testing (Coach Brandon / Reach), one row per player per test
-- date, so the player card can show improvement from the tryout baseline.
-- Heights are inches; broad jump inches; dash seconds. vertical = approach
-- touch − stand & reach (stored as entered so history doesn't shift if the
-- formula ever changes).
create table if not exists player_stat_tests (
  id              bigserial primary key,
  player_id       bigint not null references players(id) on delete cascade,
  test_date       date not null,
  team_name       text,
  stand_reach     numeric,
  approach_touch  numeric,
  standing_touch  numeric,
  vertical        numeric,
  broad_jump      numeric,
  dash_10y        numeric,
  notes           text,
  recorded_by     text,
  source          text not null default 'stats-link',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (player_id, test_date)
);
create index if not exists player_stat_tests_player_idx on player_stat_tests (player_id, test_date);
alter table player_stat_tests enable row level security;
do $$ begin
  create policy player_stat_tests_rw on player_stat_tests for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
