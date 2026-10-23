-- The directors' marketing rules (Marketing -> Settings -> Rules), e.g. "Don't
-- combine sport programming and birthday parties": plain words every writer
-- follows, plus the lines a rule keeps apart, which the planner enforces.
--   [{ id, text, active, apart: [[lines], [lines]] | null }]   (shared/marketing-rules.js)
-- Additive and idempotent:  node scripts/run-sql.mjs migrations/20261027_marketing_rules.sql
ALTER TABLE public.mkt_settings ADD COLUMN IF NOT EXISTS rules jsonb NOT NULL DEFAULT '[]'::jsonb;
