-- Court rentals: one row per upload (Oct 14 2026 review). The dates an upload
-- covered and when its file was exported from Playbook. For those dates the
-- export is the source of truth: a reservation with no time that HQ already
-- knew about when the file was exported is in the file, so its "time?" tag is
-- dropped; one booked after the export keeps it until the next upload. An
-- upload with no rentals in it (everything cancelled) still records its dates.
-- Run: node scripts/run-sql.mjs migrations/20261014c_dssc_court_rental_uploads.sql
CREATE TABLE IF NOT EXISTS public.dssc_court_rental_uploads (
  id           BIGSERIAL PRIMARY KEY,
  batch        TEXT NOT NULL,
  window_from  DATE NOT NULL,
  window_to    DATE NOT NULL,
  exported_at  TIMESTAMPTZ NOT NULL,
  imported_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_by  TEXT,
  added        INT NOT NULL DEFAULT 0,
  replaced     INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS dssc_court_rental_uploads_window_idx ON public.dssc_court_rental_uploads (window_from, window_to);
ALTER TABLE public.dssc_court_rental_uploads ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.dssc_court_rental_uploads TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.dssc_court_rental_uploads_id_seq TO service_role;
-- The first upload (events.csv, saved from Playbook Oct 14 10:12am Central).
INSERT INTO public.dssc_court_rental_uploads (batch, window_from, window_to, exported_at, imported_at, imported_by, added, replaced)
SELECT batch, MIN(date), MAX(date), '2026-10-14T15:12:00Z', MIN(imported_at), MIN(imported_by), COUNT(*), 0
FROM public.dssc_court_rentals
WHERE source = 'playbook-events-csv' AND batch IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.dssc_court_rental_uploads u WHERE u.batch = dssc_court_rentals.batch)
GROUP BY batch;
SELECT 'ok' AS done;
