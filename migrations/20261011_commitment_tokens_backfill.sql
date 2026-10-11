-- Players added after the 2026-09-07 commitment launch never got a token, so
-- their commitment link can't be built (Drew, Oct 11 2026: Rise families need
-- theirs at orientation). Fills only the blanks; existing links are untouched.
-- Run: node scripts/run-sql.mjs migrations/20261011_commitment_tokens_backfill.sql
update public.players set commitment_token = gen_random_uuid() where commitment_token is null;
select count(*) as players, count(commitment_token) as with_token from public.players;
