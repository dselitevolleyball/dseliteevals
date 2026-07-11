-- Migration: club motto on the playbook meta (Team Over Self).
-- Date: 2026-07-11
-- Run: node scripts/run-sql.mjs migrations/20260711_motto.sql
-- Additive, idempotent.

ALTER TABLE public.playbook_meta
  ADD COLUMN IF NOT EXISTS motto TEXT NOT NULL DEFAULT 'Team Over Self';

UPDATE public.playbook_meta SET motto = 'Team Over Self' WHERE id = 1 AND (motto IS NULL OR motto = '');
