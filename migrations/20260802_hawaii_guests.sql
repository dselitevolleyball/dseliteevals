-- 20260802 — Let a player be added to a Hawaii team by hand.
--
-- The Hawaii roster was derived purely from players.team_assignment being one
-- of the three Diamond teams. Drew needs to bring an extra player along on each
-- team (a call-up off Ruby/Sapphire, a sibling, a guest), without touching her
-- real team assignment — she still practices and plays with her own team.
--
-- hawaii_team records that hand-added attachment. NULL (the default) means the
-- player is on the trip because of her team_assignment, which is every existing
-- row; non-NULL names the Hawaii team she was added to.
--
-- Note for the UI: a row with hawaii_team set must NOT be deleted when her
-- status goes back to 'not_asked' — the row is the only thing putting her on
-- the trip. Only the explicit "remove" action deletes it.
--
-- Run: node scripts/run-sql.mjs migrations/20260802_hawaii_guests.sql
-- Additive and idempotent.

ALTER TABLE public.hawaii_interest ADD COLUMN IF NOT EXISTS hawaii_team TEXT;

CREATE INDEX IF NOT EXISTS hawaii_interest_team_idx
  ON public.hawaii_interest (hawaii_team) WHERE hawaii_team IS NOT NULL;
