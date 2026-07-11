-- Migration: playbook tiers — golden standards vs coach contributions.
-- Date: 2026-07-11
--
-- tier        'standard'     = golden / immutable (admin-controlled, affirmed)
--             'contribution' = a coach-submitted idea/cue/technique/system,
--                              visible to everyone; admins can elevate it to a
--                              standard.
-- entry_type  the kind of entry: Technique | Cue | System | Idea | Drill note …
-- author_*    who contributed it (for coach ideas).
--
-- Run: node scripts/run-sql.mjs migrations/20260711_playbook_tiers.sql
-- Additive, non-destructive, idempotent. Existing seeded rows become 'standard'.

ALTER TABLE public.playbook_entries
  ADD COLUMN IF NOT EXISTS tier         TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS entry_type   TEXT,
  ADD COLUMN IF NOT EXISTS author_name  TEXT,
  ADD COLUMN IF NOT EXISTS author_email TEXT;

CREATE INDEX IF NOT EXISTS playbook_entries_tier_idx ON public.playbook_entries(tier);
