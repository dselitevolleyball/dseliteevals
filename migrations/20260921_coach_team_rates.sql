-- A coach can be paid differently on one team. Breanna Coward is $30/h, but
-- $25/h when she's coaching 15 Diamond.
--
-- team_rates maps team name → hourly rate: {"15 Diamond": 25}. It sits after a
-- per-shift rate_override and before head_rate / hourly_rate — see
-- shared/coach-pay.js, which the App's Time Cards mirror.
alter table public.coach_rates add column if not exists team_rates jsonb not null default '{}'::jsonb;

comment on column public.coach_rates.team_rates is
  'Per-team hourly rate, e.g. {"15 Diamond": 25}. Beats head_rate and hourly_rate for shifts on that team; a shift rate_override still wins.';

update public.coach_rates set team_rates = team_rates || '{"15 Diamond": 25}'::jsonb, updated_at = now()
where coach_name = 'Breanna Coward';

select coach_name, hourly_rate, head_rate, team_rates from public.coach_rates where coach_name = 'Breanna Coward';
