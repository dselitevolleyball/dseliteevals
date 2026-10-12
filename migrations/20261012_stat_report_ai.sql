-- Claude-written "Coach's take" on each testing report (Drew, 12 Oct 2026:
-- "use Claude to customize the report more based on the team they are on,
-- their position, etc."). Written by api/stat-report-ai.js, editable in Testing
-- Reports before it goes out; an edited take is never overwritten by a re-run
-- unless someone asks for a fresh one.
--
-- Run: node scripts/run-sql.mjs migrations/20261012_stat_report_ai.sql
alter table public.stat_report_drafts add column if not exists ai_take        text;
alter table public.stat_report_drafts add column if not exists ai_take_at     timestamptz;
alter table public.stat_report_drafts add column if not exists ai_take_model  text;
alter table public.stat_report_drafts add column if not exists ai_take_edited boolean not null default false;
select 'ok' as done;
