-- 20260621 — Per-tournament division+age entries.
--
-- Adds one column:
--   entries  TEXT[]  — selected "age tier" combos for a tournament, e.g.
--                      {'17 American','17 Open','16 Liberty'}. Replaces the
--                      flat `divisions` tier list as the club's selection UI.
--
-- Each token is "<age> <division tier>" (age has no "U" prefix). The old
-- `divisions` column is left in place (still populated by importers) but is
-- no longer edited or shown in the app.
--
-- Run once in the Supabase SQL editor. Additive, non-destructive, idempotent.

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS entries TEXT[] NOT NULL DEFAULT '{}';
