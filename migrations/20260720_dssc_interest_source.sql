-- Migration: track HOW a coach entered the DSSC clinic pool — self opt-in vs a
-- director marking them (Drew going through the roster flagging coaches he knows
-- already coach for us). `available` stays the "in the pool / interested" flag.
-- Date: 2026-07-20  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260720_dssc_interest_source.sql

ALTER TABLE public.dssc_availability ADD COLUMN IF NOT EXISTS interest_source TEXT; -- null/'self' = coach opted in; else the director email who added them
