-- Divorced / separated parents (Drew, Oct 12 2026: "a divorced toggle for all
-- of our players so we know when to send emails separately to parents instead
-- of together"). When true, personal emails go to each parent on their own,
-- greeting only that parent (shared/parent-mail.js parentMailings).
-- Run: node scripts/run-sql.mjs migrations/20261012_parents_separate.sql
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS parents_separate boolean NOT NULL DEFAULT false;
SELECT 'ok' AS done;
