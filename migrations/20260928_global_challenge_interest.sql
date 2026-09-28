-- Girls Global Challenge (Croatia, July 2027): who's interested.
--
-- Hunter is gauging interest from 14 Diamond, 14 Ruby, 15 Diamond and 15 Ruby
-- before committing to a U17 team. One answer per player, re-editable from the
-- same link, so a "maybe" can become a "yes" without a second row.
--
-- Per-player uuid token, same shape as commitment_token / gear_form_token.

alter table public.players add column if not exists global_token uuid;
update public.players set global_token = gen_random_uuid() where global_token is null;
alter table public.players alter column global_token set default gen_random_uuid();
create unique index if not exists players_global_token_key on public.players(global_token);

create table if not exists public.global_challenge_interest (
  player_id        integer primary key references public.players(id) on delete cascade,
  interest         text not null check (interest in ('yes','maybe','no')),
  positions        text[] not null default '{}',
  travel           text check (travel in ('solo','parent','family','unsure')),
  travelers        integer,          -- family members besides the player
  city             text,             -- pre-tour city preference (shared/global-challenge.js keys)
  passport         text check (passport in ('yes','no','unsure')),
  respondent_name  text,
  questions        text,
  submitted_ip     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.global_challenge_interest is
  'Interest form for the 2027 Girls Global Challenge in Croatia (/global?t=players.global_token). Option keys live in shared/global-challenge.js.';

alter table public.global_challenge_interest enable row level security;
drop policy if exists global_challenge_interest_read on public.global_challenge_interest;
create policy global_challenge_interest_read on public.global_challenge_interest for select using (true);
drop policy if exists global_challenge_interest_write on public.global_challenge_interest;
create policy global_challenge_interest_write on public.global_challenge_interest for all using (true) with check (true);

select count(*) as players, count(global_token) as with_token from public.players;
