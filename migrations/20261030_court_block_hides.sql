-- Hidden court blocks (Drew, Oct 23 2026: "I want to be able to delete or hide
-- blocks" on the Court Availability chart). A hide takes a Playbook booking,
-- an uploaded rental, or DS Elite's held courts off the chart - on one date or
-- every week on that weekday from a date on. Hides live in HQ, so they survive
-- the next rentals upload and the hourly Playbook pull; "Show again" deletes
-- the row. Applied by shared/courts.js applyHides (staff chart and members'
-- open-gym page alike).
--   kind     'booking' (a class, hold or rental: matched on label, time, court)
--            'dse'     (DS Elite's held courts: matched on time and court)
--   date     one date, or the first date of an every-week hide
--   weekly   true = every week on date's weekday, from date on
--   start_h, end_h  Central wall clock hours (17.5 = 5:30pm)
-- Run: node scripts/run-sql.mjs migrations/20261030_court_block_hides.sql

CREATE TABLE IF NOT EXISTS public.court_block_hides (
  id          bigserial   PRIMARY KEY,
  kind        text        NOT NULL CHECK (kind IN ('booking', 'dse')),
  label       text,
  start_h     numeric     NOT NULL,
  end_h       numeric     NOT NULL,
  courts      text[]      NOT NULL,
  date        date        NOT NULL,
  weekly      boolean     NOT NULL DEFAULT false,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS court_block_hides_date_idx ON public.court_block_hides (date);
ALTER TABLE public.court_block_hides ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.court_block_hides TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.court_block_hides_id_seq TO service_role;
SELECT 'ok' AS done;
