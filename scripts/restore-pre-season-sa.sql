-- Revert the season S&A plan (90 sessions + 3 practice moves).
-- Run: node scripts/run-sql.mjs scripts/restore-pre-season-sa.sql
DELETE FROM public.sa_sessions WHERE block IN ('season1','season2');
DELETE FROM public.practice_slot_moves WHERE practice_date='2026-12-06' AND team_name='15 Sapphire';
DELETE FROM public.practice_slot_moves WHERE practice_date='2027-01-24' AND team_name='15 Sapphire';
DELETE FROM public.practice_slot_moves WHERE practice_date='2027-02-07' AND team_name='16 Ruby';
DELETE FROM public.practice_slot_moves WHERE practice_date='2027-04-18' AND team_name='16 Ruby';
