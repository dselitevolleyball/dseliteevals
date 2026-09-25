-- 20260925 — Quick player check-ins: a coach's two-week read on every player.
--
-- Not the full evaluation (player_evaluations). One screen per player, a few
-- taps: trend, category, a high and a low. A coach with two teams does both
-- in ten minutes. Rounds are two-week windows starting on the Monday of an
-- odd ISO week; one row per player per round per coach, upserted as she taps.
--
-- Run: node scripts/run-sql.mjs migrations/20260925_player_checkins.sql
-- Additive, idempotent.

create table if not exists public.player_checkins (
  id          bigserial primary key,
  player_id   bigint not null references public.players(id) on delete cascade,
  team_name   text,
  round       date not null,                   -- Monday the two-week round starts
  coach_email text not null,
  coach_name  text,
  trend       text,                            -- up | flat | down
  category    text,                            -- driver | solid | coming | concern
  highs       text[] not null default '{}',    -- tags: serving, passing, attacking, defense, setting, effort, attitude, leadership, communication
  lows        text[] not null default '{}',
  high_note   text,
  low_note    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (player_id, round, coach_email)
);
create index if not exists player_checkins_player_idx on public.player_checkins(player_id, round desc);
create index if not exists player_checkins_team_idx   on public.player_checkins(team_name, round desc);

alter table public.player_checkins enable row level security;
drop policy if exists "auth_all_player_checkins" on public.player_checkins;
create policy "auth_all_player_checkins" on public.player_checkins
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

select count(*) as checkins from public.player_checkins;
