-- Court rentals with their times (Drew, Oct 14 2026). Playbook's staff-side
-- Events export (events.csv) lists every Rented Session with its date, start,
-- end, sub location (court) and renter - the times the public calendar and the
-- registrations report never carry. An admin uploads the export on Court
-- Availability (or: node scripts/import-court-rentals.mjs <csv>); each upload
-- replaces this source's rows for the dates the file covers.
--   courts   V1-V6 (Warehouse 1-4, Flex 5-6); empty = Playbook didn't say
--   internal DS Elite / DSSC's own bookings (Drew's Sunday blocks, DSEV rentals)
--   label    what the screen shows: "DS Storm", "Aces", "Private lesson (Hunter)"
-- Read only through the server (service role); no browser access.
-- Run: node scripts/run-sql.mjs migrations/20261014_dssc_court_rentals.sql
CREATE TABLE IF NOT EXISTS public.dssc_court_rentals (
  id            BIGSERIAL PRIMARY KEY,
  date          DATE NOT NULL,
  start_time    TEXT NOT NULL,            -- "17:00"
  end_time      TEXT NOT NULL,            -- "20:00"
  courts        TEXT[] NOT NULL DEFAULT '{}',
  label         TEXT NOT NULL,
  renter        TEXT,                     -- the person on the booking
  item          TEXT,                     -- what they booked ("DS Storm", "Volleyball Court 2 session")
  internal      BOOLEAN NOT NULL DEFAULT FALSE,
  location      TEXT,
  sub_location  TEXT,
  program       TEXT,
  note          TEXT,
  source        TEXT NOT NULL DEFAULT 'playbook-events-csv',
  batch         TEXT,
  imported_by   TEXT,
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dssc_court_rentals_date_idx ON public.dssc_court_rentals (date);
ALTER TABLE public.dssc_court_rentals ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.dssc_court_rentals TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.dssc_court_rentals_id_seq TO service_role;
SELECT 'ok' AS done;
