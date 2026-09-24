-- Migration: automatic Playbook registrations pull (every 4 hours).
-- Date: 2026-09-24  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260924_dssc_registrations_sync.sql
--
-- api/playbook-registrations.js signs in to Playbook as the HQ sync login,
-- fetches the registrations report's "Export All" and runs it through the
-- same importer the admin upload uses. Its last run is recorded here, on the
-- existing singleton sync row, so the admin board can show it next to the
-- calendar sync.

ALTER TABLE public.dssc_sync
  ADD COLUMN IF NOT EXISTS registrations_at      TIMESTAMPTZ,   -- last successful pull
  ADD COLUMN IF NOT EXISTS registrations_summary JSONB,         -- { added, matched, noSession, rows }
  ADD COLUMN IF NOT EXISTS registrations_error   TEXT,          -- last failure, cleared on success
  ADD COLUMN IF NOT EXISTS registrations_error_at TIMESTAMPTZ;

INSERT INTO public.dssc_sync (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
