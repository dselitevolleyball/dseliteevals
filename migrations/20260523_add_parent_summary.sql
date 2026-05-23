-- Migration: persist the AI-generated parent summary on each player row
-- Date: 2026-05-23
-- Run this once in the Supabase SQL editor (https://supabase.com/dashboard).
-- Additive only — safe to run against the production players table.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS parent_summary            TEXT        NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS parent_summary_updated_at TIMESTAMPTZ;
