-- Court rentals: the dates each upload covered (Oct 14 2026 review). An upload
-- replaces the range it was exported for, not just its first-to-last rental, so
-- a rental cancelled at the edge of the range drops out too; the screen's
-- "loaded through" date is the end of that range.
-- Run: node scripts/run-sql.mjs migrations/20261014b_dssc_court_rentals_window.sql
ALTER TABLE public.dssc_court_rentals ADD COLUMN IF NOT EXISTS window_from DATE;
ALTER TABLE public.dssc_court_rentals ADD COLUMN IF NOT EXISTS window_to DATE;
UPDATE public.dssc_court_rentals SET window_from = '2026-10-20', window_to = '2026-11-20' WHERE window_from IS NULL AND source = 'playbook-events-csv';
SELECT 'ok' AS done;
