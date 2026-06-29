-- 20260629 — Per-team targeting for the Updates feed.
--
-- Adds one column to updates:
--   team_name  TEXT  — NULL/empty = club-wide (everyone); set = only that
--                      team's coaches (and admins) see it on Home.
--
-- Requires the `updates` table from 20260629_checklist_meta_updates.sql.
-- Run once in the Supabase SQL editor. Additive, non-destructive, idempotent.

ALTER TABLE public.updates
  ADD COLUMN IF NOT EXISTS team_name TEXT;
