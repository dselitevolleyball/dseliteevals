-- 20260814 — A player who accepts a spot joins the roster by itself.
--
-- 20260728_player_roster.sql seeded roster_status once and nothing has set it
-- since, so every athlete who accepted AFTER that date is invisible on the
-- roster cards — the view filters on roster_status = 'active'. Garner Geeslin
-- and Ellie McMullen both accepted, both hold a team assignment, and neither
-- shows up for their coaches.
--
-- The rule is narrower than the original backfill on purpose. That one keyed on
-- team_assignment alone, because 14 players were already on teams with no offer
-- ever recorded. Going forward the acceptance IS the signal, so a player with an
-- offer still outstanding (Charlee Saunders, offered 8/10, no answer yet) does
-- not appear on a roster card before she has said yes.
--
-- Only ever fills a NULL. A player pulled off the roster mid-season — set to
-- 'inactive', 'left', anything — is never dragged back by a later edit to their
-- row, which is the whole reason roster_status is separate from offer_status.
--
-- Run: node scripts/run-sql.mjs migrations/20260814_roster_auto_add.sql
-- Additive and idempotent.

CREATE OR REPLACE FUNCTION public.players_autoroster()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.roster_status IS NULL
     AND COALESCE(NEW.team_assignment, '') <> ''
     AND NEW.offer_status = 'accepted'
  THEN
    NEW.roster_status := 'active';
    NEW.rostered_at   := COALESCE(NEW.rostered_at, NEW.offer_decision_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS players_autoroster_trg ON public.players;
CREATE TRIGGER players_autoroster_trg
  BEFORE INSERT OR UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.players_autoroster();

-- Catch up everyone the missing rule already stranded.
UPDATE public.players
   SET roster_status = 'active',
       rostered_at   = COALESCE(rostered_at, offer_decision_at, offer_made_at, updated_at, now())
 WHERE roster_status IS NULL
   AND COALESCE(team_assignment, '') <> ''
   AND offer_status = 'accepted';

COMMENT ON FUNCTION public.players_autoroster() IS
  'Accepting a spot on a team puts a player on the roster. Fills roster_status only when it is NULL, so a manual removal sticks.';
