-- Marketing → Settings → Reconnect Facebook (Oct 2026): the Meta Page token a
-- director pastes in HQ, so reconnecting never needs Vercel. Service-role only:
-- RLS on, no policies - the browser can't read or write it.
create table if not exists public.mkt_secrets (
  key        text primary key,
  value      text not null,
  meta       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.mkt_secrets enable row level security;
