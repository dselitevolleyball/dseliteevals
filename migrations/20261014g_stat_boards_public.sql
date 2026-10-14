-- The leaderboard TV gets a plain address, www.drippingsportsclub.com/reach
-- (Drew, Oct 14 2026: "an easier website url"). A board marked public answers
-- /api/leaderboard with no key; the TV row is that board. Turning it back off
-- is one update - no deploy:  update stat_boards set public = false;
-- Run: node scripts/run-sql.mjs migrations/20261014g_stat_boards_public.sql
alter table public.stat_boards add column if not exists public boolean not null default false;
update public.stat_boards set public = true where label = 'DSSC touch-screen TV';
select label, public from public.stat_boards;
