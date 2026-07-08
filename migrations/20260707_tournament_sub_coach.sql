-- 20260707 — Tournament assignment: sub coach + ignore-conflict override.
--
-- Lets you send a team to a tournament even when a shared coach is double-booked
-- (e.g. 13 Diamond + 14 Ruby at the same event) by recording a replacement coach
-- for that assignment. An assignment with ignore_conflict (or a sub_coach) is
-- treated as coach-covered and no longer flags as a conflict.
--
-- Run: node scripts/run-sql.mjs migrations/20260707_tournament_sub_coach.sql
-- Additive, non-destructive, idempotent.

ALTER TABLE public.tournament_assignments
  ADD COLUMN IF NOT EXISTS sub_coach       TEXT,
  ADD COLUMN IF NOT EXISTS ignore_conflict BOOLEAN NOT NULL DEFAULT FALSE;
