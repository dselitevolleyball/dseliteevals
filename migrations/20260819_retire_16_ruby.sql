-- Retire 16 Ruby. Lucia Baker (295) and Isabella Shepard (409) moved to
-- 16 Diamond on 2026-08-19; the team no longer exists.
--
-- The players/teams/practice_teams/practice_assignments side was already clean.
-- These are the two leftovers: future Speed & Agility sessions and practice
-- slot moves still scheduled for a team that will never practice again. They
-- would otherwise keep showing up on the S&A calendar and the daily board.
--
-- NOT touched on purpose: coach_checkins id=216 (Kelli Hardge, 2026-08-09,
-- 2 hours, still unpaid). That is a payroll record, not a schedule row.

delete from sa_sessions        where team_name = '16 Ruby';  -- 5 rows
delete from practice_slot_moves where team_name = '16 Ruby'; -- 2 rows
