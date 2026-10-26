-- DS Elite HQ → New players (Oct 2026): one checklist per player who joins
-- after the main invites - accepted, paid, onboarding form, uniform ordered /
-- handed out, jersey number, USAV membership, team roster, commitment,
-- SportsYou, shoes, scorekeeping, stay-to-play hotels. Items HQ can see for
-- itself are worked out on the screen; this keeps the ones a person ticks
-- (items: { key: { at, by } }), notes, and who was added or finished by hand.
create table if not exists public.player_onboarding (
  player_id   bigint primary key references public.players(id) on delete cascade,
  items       jsonb not null default '{}'::jsonb,
  notes       text,
  added_by    text,
  added_at    timestamptz not null default now(),
  archived_at timestamptz,
  archived_by text,
  updated_at  timestamptz not null default now()
);
alter table public.player_onboarding enable row level security;
drop policy if exists player_onboarding_approved on public.player_onboarding;
create policy player_onboarding_approved on public.player_onboarding for all
  using (exists (select 1 from public.coaches c where c.id = auth.uid() and c.is_approved))
  with check (exists (select 1 from public.coaches c where c.id = auth.uid() and c.is_approved));
