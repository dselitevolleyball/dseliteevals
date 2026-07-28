-- 20260728 — Season-scope the player database.
--
-- Players who made a team become the club roster, separate from the tryout
-- pool they came from, so the tryout views can be archived as "2026-27 Tryouts"
-- without taking the roster with them.
--
-- One row per PERSON, not per season. change_log, sms_threads and
-- player_favorites all foreign-key players.id, so copying a player into a new
-- row each season would orphan their history. Season-specific data hangs off
-- the player instead.
--
-- Run: node scripts/run-sql.mjs migrations/20260728_player_roster.sql
-- Additive, idempotent.

-- Which season a player's CURRENT tryout/roster record belongs to. Existing
-- rows are the 2026-27 cycle.
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS season text DEFAULT '2026-27';
UPDATE public.players SET season = '2026-27' WHERE season IS NULL;

-- Roster state, independent of the tryout offer flow. offer_status answers
-- "did they take the spot"; roster_status answers "are they on the club now",
-- which keeps mid-season departures from looking like declined offers.
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS roster_status text;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS rostered_at timestamptz;

-- Seed the roster: holding a spot on a team IS being on the roster.
--
-- Deliberately keyed on team_assignment rather than offer_status. 14 players
-- (mostly Rise) sit on a team with no offer status ever recorded — the offer
-- step was skipped, not refused — and gating on offer_status would silently
-- drop them. No player with a terminal status (declined / opted_out /
-- not_invited) holds a team assignment, so this cannot pull in a leaver.
UPDATE public.players
   SET roster_status = 'active',
       rostered_at   = COALESCE(rostered_at, offer_decision_at, offer_made_at, updated_at, now())
 WHERE roster_status IS NULL
   AND COALESCE(team_assignment, '') <> ''
   AND COALESCE(offer_status, '') NOT IN ('declined', 'opted_out', 'not_invited');

CREATE INDEX IF NOT EXISTS players_season_idx        ON public.players (season);
CREATE INDEX IF NOT EXISTS players_roster_status_idx ON public.players (roster_status);
