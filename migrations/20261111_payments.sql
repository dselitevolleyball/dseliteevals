-- DS Elite Payments (Drew, Oct 29 2026: "set up a payment system through
-- Stripe that I can use for things like the NCAA tickets").
-- A pay_request is one thing families pay for (e.g. NCAA Championship
-- tickets, $52 each). Each family gets a pay_item with its own private link
-- (/pay?t=<token>) that opens Stripe Checkout; the webhook
-- (/api/pay-webhook) marks it paid. Cash / Venmo / check can be recorded by
-- hand. DS Elite absorbs the card fees: families pay the listed price.
-- The Stripe key and webhook secret live in mkt_secrets ('dse_stripe',
-- 'dse_stripe_whsec'), never in the browser.
create table if not exists public.pay_requests (
  id                bigint generated always as identity primary key,
  title             text not null,
  description       text,
  unit_label        text not null default 'ticket',
  unit_amount_cents integer not null check (unit_amount_cents >= 50),
  allow_qty_change  boolean not null default true,
  max_qty           integer not null default 30,
  due_date          date,
  status            text not null default 'open' check (status in ('open', 'closed')),
  source            text,                       -- e.g. 'ncaa' when families came from the NCAA form
  email_subject     text,
  email_body        text,                       -- {greeting} {qty} {unit} {total} {link} {due} {title}
  sms_body          text,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create table if not exists public.pay_items (
  id                 bigint generated always as identity primary key,
  request_id         bigint not null references public.pay_requests(id) on delete cascade,
  token              uuid not null default gen_random_uuid() unique,
  player_ids         integer[] not null default '{}',   -- players.id: the family (brothers and sisters share one item)
  family_label       text not null,                  -- "Ava & Mia Smith (12 Rise, 15 Ruby)"
  qty                integer not null default 1 check (qty >= 1),
  status             text not null default 'unpaid' check (status in ('unpaid', 'pending', 'paid', 'refunded', 'canceled')),
  method             text,                           -- card | bank | cash | venmo | check | other
  paid_qty           integer,
  paid_cents         integer,
  paid_at            timestamptz,
  refunded_cents     integer,
  stripe_session_id  text,
  stripe_payment_intent text,
  note               text,
  sent_at            timestamptz,
  reminded_at        timestamptz,
  opened_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (request_id, family_label)
);
create index if not exists pay_items_request on public.pay_items (request_id, status);
create index if not exists pay_items_pi on public.pay_items (stripe_payment_intent);
alter table public.pay_requests enable row level security;   -- service role only (/api/pay, /api/pay-form, /api/pay-webhook)
alter table public.pay_items enable row level security;
