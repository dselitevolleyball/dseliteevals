-- Privates: which age groups and skills each coach wants to work with.
-- Run: node scripts/run-sql.mjs migrations/20260925_coach_privates_ages_skills.sql
alter table public.coach_privates add column if not exists ages   jsonb not null default '[]'::jsonb;  -- ["10u","11-12","13-14","15+"]
alter table public.coach_privates add column if not exists skills jsonb not null default '[]'::jsonb;  -- ["serving","serve-receive","attacking","libero","middles","setting"]
select count(*) from public.coach_privates;
