-- Work Duty, simplified (Drew, Oct 9 2026): assignments are generic and
-- numbered (#1, #2, ...), pre-dealt for every team — no tournaments, dates or
-- matches-per-day. Coaches see the next one and cross it off. Each team keeps
-- a list of players who aren't at this tournament (unticked in "Who's here"),
-- so their jobs are re-dealt.
-- Run: node scripts/run-sql.mjs migrations/20261009_work_duty_generic.sql

ALTER TABLE public.work_duty_matches ALTER COLUMN match_date DROP NOT NULL;
ALTER TABLE public.work_duty_settings ADD COLUMN IF NOT EXISTS absent TEXT[] NOT NULL DEFAULT '{}';
