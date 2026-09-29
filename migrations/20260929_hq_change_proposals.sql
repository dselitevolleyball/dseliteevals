-- Ask HQ: changes proposed from an uploaded document, waiting for an admin.
--
-- Ask HQ never writes. When an admin uploads a spreadsheet and says "update
-- HQ from this", Claude matches it against the database and files a proposal
-- here: one entry per row it would change, with the value it saw before. The
-- admin reviews it in the panel and api/hq-apply.js applies the ticked ones,
-- re-checking each row still holds the "before" value so nothing written in
-- the meantime is overwritten.
create table if not exists public.hq_change_proposals (
  id           uuid primary key default gen_random_uuid(),
  created_by   text,
  summary      text,
  source_files jsonb not null default '[]'::jsonb,
  -- [{ table, action: 'update'|'insert', pk: {id: 12}, label, set: {col: value}, before: {col: value}, reason }]
  changes      jsonb not null default '[]'::jsonb,
  status       text not null default 'pending' check (status in ('pending','applied','partial','discarded')),
  results      jsonb,
  applied_by   text,
  applied_at   timestamptz,
  created_at   timestamptz not null default now()
);
comment on table public.hq_change_proposals is 'Ask HQ document uploads: proposed database changes and what the admin applied. Written only by the service role (api/ask-hq.js, api/hq-apply.js).';
alter table public.hq_change_proposals enable row level security;
drop policy if exists hq_change_proposals_read on public.hq_change_proposals;
create policy hq_change_proposals_read on public.hq_change_proposals for select to authenticated using (true);
select count(*) from public.hq_change_proposals;
