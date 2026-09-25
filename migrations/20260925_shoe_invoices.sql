-- 20260925 — Avoli club-shoe invoices, imported from Playbook's sale export.
--
-- Shoes are the one piece of gear a family pays for separately (see the gear
-- form's shoe_invoice_ack). Playbook invoices each family $167 and its
-- Reports → Sales export is the only record of who has paid. This table is
-- that export, one row per sale, matched to the player it is for, so the gear
-- board can show paid / unpaid / no invoice beside her sizes.
--
-- Re-importing upserts on sale_id: statuses refresh, nothing is removed.
--
-- Run: node scripts/run-sql.mjs migrations/20260925_shoe_invoices.sql
-- Additive, idempotent.

create table if not exists public.shoe_invoices (
  sale_id       text primary key,              -- Playbook "Sale ID"
  sale_date     timestamptz,
  account_owner text,                          -- who was invoiced (parent)
  participant   text not null,                 -- the player, as Playbook has her
  item_name     text,
  price         numeric(10,2),
  paid          numeric(10,2),
  remaining     numeric(10,2),
  status        text,                          -- Paid | Unpaid | ...
  player_id     bigint references public.players(id) on delete set null,
  match_note    text,                          -- why a row is (or isn't) matched
  imported_at   timestamptz not null default now(),
  imported_by   text
);
create index if not exists shoe_invoices_player_idx on public.shoe_invoices(player_id);

alter table public.shoe_invoices enable row level security;
drop policy if exists "auth_all_shoe_invoices" on public.shoe_invoices;
create policy "auth_all_shoe_invoices" on public.shoe_invoices
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

select count(*) as shoe_invoices from public.shoe_invoices;
