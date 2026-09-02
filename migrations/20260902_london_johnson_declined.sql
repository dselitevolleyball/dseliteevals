-- London Johnson (id 356, 15 Emerald, #10) has left the club.
--
-- Mirrors exactly what the app's own "Decline offer" action does — clear the
-- team and roster position, set offer_status, stamp the decision — so her
-- record looks like every other departure rather than a hand-edited special
-- case. `status` is the display twin of `offer_status` and is kept in step,
-- the way src/App.jsx:11608 keeps it on every other write.
--
-- Also cleared:
--   jersey_number  — #10 goes back to the pool on 15 Emerald, and a number
--                    left on a departed player is how a duplicate gets issued
--   roster_status  — matches 35 of the 41 existing declines
--
-- Her mother Kristan had volunteered as a team parent for 15 Emerald. You
-- can't be team parent for a team your daughter has left, so that signup goes.
-- The team keeps two others (Megan Annen, Jennifer Lateur), so nothing breaks.
--
-- DELIBERATELY KEPT:
--   player_gear_orders — a completed order, jersey M and shoe 10. That is a
--     purchase record and possibly money already spent; it is not mine to
--     destroy. She drops off the gear board with her team cleared.
--   school_team_reports — Westlake Freshman. Harmless, and falls out of the
--     per-team school rosters on its own.
--   change_log — 71 rows of her history. The point of history is that it
--     survives the person leaving.

begin;

update players set
  team_assignment   = '',
  roster_pos        = '',
  offer_status      = 'declined',
  status            = 'Declined',
  offer_decision_at = now(),
  jersey_number     = null,
  roster_status     = null,
  notes = coalesce(notes, '') ||
    E'\n\n[2026-09-02] Left the club. Was 15 Emerald #10. Team, jersey number and roster status cleared; gear order kept as a purchase record.'
where id = 356;

delete from team_volunteers where id = 22;

commit;
