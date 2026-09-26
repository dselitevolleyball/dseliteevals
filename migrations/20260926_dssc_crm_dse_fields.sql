-- Migration: DS Elite position and team level on CRM players.
-- Date: 2026-09-26  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260926_dssc_crm_dse_fields.sql
ALTER TABLE public.dssc_participants
  ADD COLUMN IF NOT EXISTS position   TEXT,   -- DS Elite primary position (Setter, Pin, Middle, DS, Libero, Other)
  ADD COLUMN IF NOT EXISTS position2  TEXT,
  ADD COLUMN IF NOT EXISTS dse_team   TEXT,   -- e.g. "12 Diamond"
  ADD COLUMN IF NOT EXISTS dse_level  TEXT;   -- rise | regional | national
CREATE INDEX IF NOT EXISTS dssc_participants_dse_level_idx ON public.dssc_participants(dse_level);
