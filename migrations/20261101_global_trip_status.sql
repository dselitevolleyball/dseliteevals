-- Girls Global Challenge (Croatia, July 2027): where each player stands, set by
-- staff (Drew, Oct 26 2026: "update the Europe answers manually and see who is
-- not interested, interested, committed and paid").
--
-- The family's own answer stays in interest (yes / maybe / no, from /global).
-- status is staff's word and wins when set:
--   not_interested | interested | committed | paid
-- With no status, a "no" reads as not interested and a yes or maybe as
-- interested. amount_paid is what the family has paid so far (any status).
-- A family who sends the form again changes interest only, never status.
--
-- Also locks the table to signed-in staff. It was readable and writable with
-- the public key; the family form writes with the service role, so nothing
-- that should work stops working.
-- Run: node scripts/run-sql.mjs migrations/20261101_global_trip_status.sql

alter table public.global_challenge_interest add column if not exists status text
  check (status in ('not_interested', 'interested', 'committed', 'paid'));
alter table public.global_challenge_interest add column if not exists amount_paid numeric;
alter table public.global_challenge_interest add column if not exists staff_notes text;
alter table public.global_challenge_interest add column if not exists status_updated_by text;
alter table public.global_challenge_interest add column if not exists status_updated_at timestamptz;

drop policy if exists global_challenge_interest_read on public.global_challenge_interest;
create policy global_challenge_interest_read on public.global_challenge_interest for select to authenticated using (true);
drop policy if exists global_challenge_interest_write on public.global_challenge_interest;
create policy global_challenge_interest_write on public.global_challenge_interest for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.global_challenge_interest to authenticated;
select 'ok' as done;
