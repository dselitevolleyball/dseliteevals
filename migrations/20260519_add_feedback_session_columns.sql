-- Migration: add Parent Feedback Session tracking columns
-- Date: 2026-05-19
-- Run this once in the Supabase SQL editor (https://supabase.com/dashboard).
-- Additive only - safe to run against the production players table.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS feedback_session_complete BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS parent_feedback_notes     TEXT    NOT NULL DEFAULT '';
