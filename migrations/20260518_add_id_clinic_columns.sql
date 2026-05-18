-- Migration: add National Team ID Clinic tracking columns
-- Date: 2026-05-18
-- Run this once in the Supabase SQL editor (https://supabase.com/dashboard).
-- Additive only - safe to run against the production players table.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS id_clinic_invited  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS id_clinic_attended BOOLEAN NOT NULL DEFAULT FALSE;
