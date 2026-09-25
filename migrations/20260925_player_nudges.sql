-- 20260925 — Nudges sent from the "Waiting on" screen.
--
-- One row per reminder actually sent to a family about one thing (gear sizes,
-- shoe invoice, SportsEngine membership, commitment signature), so the screen
-- can say "nudged 3 days ago" instead of leaving Drew to remember.
--
-- Run: node scripts/run-sql.mjs migrations/20260925_player_nudges.sql
-- Additive, idempotent.

create table if not exists public.player_nudges (
  id          bigserial primary key,
  player_id   bigint not null references public.players(id) on delete cascade,
  need        text   not null,                 -- gear | shoes | sportsengine | commitment
  channel     text   not null default 'email', -- email | sms
  recipients  text[],
  sent_by     text,
  sent_at     timestamptz not null default now()
);
create index if not exists player_nudges_player_idx on public.player_nudges(player_id, need, sent_at desc);

alter table public.player_nudges enable row level security;
drop policy if exists "auth_all_player_nudges" on public.player_nudges;
create policy "auth_all_player_nudges" on public.player_nudges
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

select count(*) as nudges from public.player_nudges;
