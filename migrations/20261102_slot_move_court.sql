-- A team moved to another block for one date can be given a court for that
-- date (Drew, Oct 26 2026: "struggling to set courts ... like Court 4 for 15
-- Sapphire"). The Daily view's court picker saves here for a moved team; the
-- weekly practice_assignments.court stays as it is.
-- Run: node scripts/run-sql.mjs migrations/20261102_slot_move_court.sql
ALTER TABLE public.practice_slot_moves ADD COLUMN IF NOT EXISTS court int CHECK (court BETWEEN 1 AND 6);
SELECT 'ok' AS done;
