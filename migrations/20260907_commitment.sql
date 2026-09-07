-- Orientation night commitment: what players and parents sign, and the record of it.
--
-- Drew walks the deck, hits slide 24, and families open a link on their phones
-- in the gym. Both sign — separately, because they are agreeing to different
-- things — and the player card shows it the moment they do.
--
-- Per-player uuid token, same shape as school_form_token / gear_form_token, so
-- a URL cannot be walked to another family's form by editing a number.

alter table public.players add column if not exists commitment_token uuid;
update public.players set commitment_token = gen_random_uuid() where commitment_token is null;
create unique index if not exists players_commitment_token_key on public.players(commitment_token);

create table if not exists public.player_commitments (
  player_id            integer primary key references public.players(id) on delete cascade,
  season               text not null default '2026-27',
  version              text not null default '2026-27.1',
  -- Two signatures, taken separately. Either may arrive first; the card only
  -- reads "signed" when both are in.
  player_name          text,
  player_signed_at     timestamptz,
  player_items         jsonb not null default '{}'::jsonb,
  parent_name          text,
  parent_signed_at     timestamptz,
  parent_items         jsonb not null default '{}'::jsonb,
  -- Kept because a signature is worth nothing if you cannot say when and from
  -- where it came. Not shown in the app; it exists for the one disputed case.
  signed_ip            text,
  signed_user_agent    text,
  note                 text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.player_commitments is
  'Orientation-night commitment signatures. player_items / parent_items hold the ticked clause keys from shared/commitment.js, so an older signature still says exactly what was agreed to when the wording changes.';

alter table public.player_commitments enable row level security;
drop policy if exists player_commitments_read on public.player_commitments;
create policy player_commitments_read on public.player_commitments for select using (true);
drop policy if exists player_commitments_write on public.player_commitments;
create policy player_commitments_write on public.player_commitments for all using (true) with check (true);

select count(*) as players, count(commitment_token) as with_token from public.players;
