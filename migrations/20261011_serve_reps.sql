-- Serve grader (Drew, Oct 11 2026): one row per serve, graded on the spot.
--   accuracy  0 = miss (net/out), 1 = in, 2 = target area, 3 = on target
--   toughness 1 = easy, 2 = pressure, 3 = nasty  (null on a miss)
--   score     accuracy x toughness, 0-9 (0 on a miss)
-- A "session" is a team + date. Run: node scripts/run-sql.mjs migrations/20261011_serve_reps.sql
create table if not exists public.serve_reps (
  id            bigserial primary key,
  player_id     integer not null references public.players(id) on delete cascade,
  team_name     text not null,
  session_date  date not null,
  serve_type    text not null check (serve_type in ('float', 'fast')),
  accuracy      smallint not null check (accuracy between 0 and 3),
  toughness     smallint check (toughness between 1 and 3),
  score         smallint not null check (score between 0 and 9),
  graded_by     text,
  created_at    timestamptz not null default now(),
  check ((accuracy = 0 and toughness is null and score = 0) or (accuracy > 0 and toughness is not null and score = accuracy * toughness))
);
create index if not exists serve_reps_team_date_idx on public.serve_reps (team_name, session_date);
create index if not exists serve_reps_player_idx on public.serve_reps (player_id, session_date);

alter table public.serve_reps enable row level security;
drop policy if exists "auth_all_serve_reps" on public.serve_reps;
create policy "auth_all_serve_reps" on public.serve_reps for all using (auth.uid() is not null) with check (auth.uid() is not null);
grant all on public.serve_reps to authenticated, service_role;
grant usage, select on sequence public.serve_reps_id_seq to authenticated, service_role;
select count(*) as serve_reps from public.serve_reps;
