-- Girls Global Challenge: the position she plays now, alongside the ones she'd
-- be open to (positions). Codes as in shared/global-challenge.js GC_POSITIONS.
alter table public.global_challenge_interest add column if not exists primary_position text;
select column_name from information_schema.columns where table_name = 'global_challenge_interest' and column_name = 'primary_position';
