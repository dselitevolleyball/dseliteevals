-- DS Elite Time Cards: "expected but didn't clock in" coaches get a text -
-- "Did you work it? Reply YES or NO, or tap to answer" (Drew, Oct 27 2026).
-- One row per text. `shifts` is the list it asked about, each answered on its
-- own from the link page or all at once by a YES / NO reply:
--   [{ date, team, slot, answer: null | 'yes' | 'no', at }]
-- A yes logs the shift in coach_checkins (source 'sms' or 'link'); a no
-- records the absence in practice_coverage - the same rows "+ Was there" and
-- "Called out" write - so the coach drops off the list either way.
-- Written only by the server (service role); admins read it in Time Cards.

create table if not exists public.shift_confirms (
  id            bigserial primary key,
  token         text not null unique,
  coach_name    text not null,
  phone         text,
  shifts        jsonb not null default '[]'::jsonb,
  status        text not null default 'sent',      -- sent | answered | failed
  answered_via  text,                              -- sms | link
  answered_at   timestamptz,
  reply_text    text,
  error         text,
  sent_by       text,
  sent_at       timestamptz not null default now()
);
create index if not exists shift_confirms_phone_idx on public.shift_confirms (phone, sent_at desc);
create index if not exists shift_confirms_sent_idx on public.shift_confirms (sent_at desc);

alter table public.shift_confirms enable row level security;
drop policy if exists shift_confirms_admin_select on public.shift_confirms;
create policy shift_confirms_admin_select on public.shift_confirms for select to authenticated using (public.is_admin_coach());
