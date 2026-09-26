-- Migration: CRM keys for Playbook's participant export.
-- Date: 2026-09-26  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260926_dssc_crm_playbook.sql
--
-- Playbook's participant export (Reports → Participants) is the one source
-- that ties every player to a guardian WITH a phone number. Its ids are kept
-- so the registrations report (user_pk + participant_name) and future exports
-- join cleanly.

ALTER TABLE public.dssc_contacts     ADD COLUMN IF NOT EXISTS playbook_user_pk TEXT;
ALTER TABLE public.dssc_participants ADD COLUMN IF NOT EXISTS playbook_student_pk TEXT;
ALTER TABLE public.dssc_participants ADD COLUMN IF NOT EXISTS phone TEXT;              -- the player's own mobile, when given
ALTER TABLE public.dssc_participants ADD COLUMN IF NOT EXISTS waiver_signed BOOLEAN;
ALTER TABLE public.dssc_participants ADD COLUMN IF NOT EXISTS allergies TEXT;
CREATE INDEX IF NOT EXISTS dssc_contacts_playbook_idx ON public.dssc_contacts(playbook_user_pk);
CREATE UNIQUE INDEX IF NOT EXISTS dssc_participants_playbook_uniq ON public.dssc_participants(playbook_student_pk) WHERE playbook_student_pk IS NOT NULL;
