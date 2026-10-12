-- Testing reports show the date a player's baseline was measured instead of
-- the word "Tryouts" (Drew, Oct 12 2026: "include the date of the baseline
-- instead of tryouts"). players.stat_baseline_date = the day her tryout
-- numbers (stand_reach / approach_touch / jump_touch / sprint_10y) were taken;
-- null when she has none. Admins can correct it in Testing Reports.
--
-- Backfill rule, from the evidence (checked 12 Oct against all 200 players with
-- tryout numbers):
--   1. change_log: the first Central-time day, on/after the first tryout session
--      (Jun 25), that any of the four fields was set to a value. The numbers are
--      typed in live at the measuring station, so this is the measuring day.
--      Covers 200/200 — 198 land on their own division's session (U11 Jun 25,
--      U14 Jun 26, U12/U13 Jun 27, U15 Jun 30, U16 Jul 8); Jade Johnson (U13) was
--      measured at the Jul 8 session and Hadley Spencer at the Rise tryout (Sep 19).
--      Days before Jun 25 are skipped: Jun 17/21 were Drew trying the new fields
--      (reach 7"/49"/52", jump touch 1052) and every one was overwritten at tryouts.
--      Later days are corrections (Lucy Plotkin's 10-yard 1770 -> 1.77 on Jun 27,
--      the O'ren Smith merge on Jul 1), not new measurements, so the first day wins.
--   2. Else the tryouts session for her usav_div (covers no one today; a
--      safety net for numbers that arrive without an audit row).
--   eval_dates are NOT a source: no measurement was logged at the May–June
--   evaluation sessions, so they would put the baseline weeks too early.
-- Fills only blanks, so re-running never overwrites an admin's correction.
-- Run: node scripts/run-sql.mjs migrations/20261012_stat_baseline_date.sql

alter table public.players add column if not exists stat_baseline_date date;

with sets as (
  select c.player_id, (c.created_at at time zone 'America/Chicago')::date as d
  from public.change_log c
  cross join unnest(array['stand_reach', 'approach_touch', 'jump_touch', 'sprint_10y']) as f
  where c.table_name = 'players' and c.player_id is not null
    and case c.action
          when 'update' then nullif(c.field_changes -> f ->> 'new', '') is not null
          when 'insert' then nullif(c.field_changes ->> f, '') is not null
          else false end
),
measured as (
  select s.player_id, min(s.d) as d from sets s
  where s.d >= (select min(start_at)::date from public.tryouts)
  group by s.player_id
),
session as (select division, min(start_at)::date as d from public.tryouts group by division)
update public.players p
set stat_baseline_date = coalesce(m.d, s.d)
from public.players p2
left join measured m on m.player_id = p2.id
left join session s on s.division = p2.usav_div
where p.id = p2.id
  and p.stat_baseline_date is null
  and coalesce(p.stand_reach, p.approach_touch, p.jump_touch, p.sprint_10y) is not null
  and coalesce(m.d, s.d) is not null;

select stat_baseline_date, count(*) as players
from public.players
where coalesce(stand_reach, approach_touch, jump_touch, sprint_10y) is not null
group by 1 order by 1;
