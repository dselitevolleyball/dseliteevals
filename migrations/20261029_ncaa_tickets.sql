-- NCAA Championship group tickets (Drew, Oct 23 2026): who in DS Elite wants
-- $52 group tickets for the NCAA women's volleyball championship match at the
-- Alamodome (Sun Dec 20, 2:30pm, 300 level), and who already has tickets.
--
-- One row per family. The form (/ncaa?t=players.global_token, api/ncaa-form.js)
-- saves on the player whose link was used and deletes her siblings' rows, so
-- tickets are never counted twice. Option keys live in shared/ncaa-tickets.js.
--   answer   yes | have | maybe | no
--   tickets  group tickets wanted ($52 each), for "yes" and optionally "have"
--   party    for "have": how many of them already have their own tickets
-- Run: node scripts/run-sql.mjs migrations/20261029_ncaa_tickets.sql

CREATE TABLE IF NOT EXISTS public.ncaa_tickets (
  player_id        integer     PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  answer           text        NOT NULL CHECK (answer IN ('yes', 'have', 'maybe', 'no')),
  tickets          integer     CHECK (tickets BETWEEN 0 AND 30),
  party            integer     CHECK (party BETWEEN 0 AND 30),
  respondent_name  text,
  notes            text,
  submitted_ip     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ncaa_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ncaa_tickets_read ON public.ncaa_tickets;
CREATE POLICY ncaa_tickets_read ON public.ncaa_tickets FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.ncaa_tickets TO authenticated;
GRANT ALL ON public.ncaa_tickets TO service_role;
SELECT 'ok' AS done;
