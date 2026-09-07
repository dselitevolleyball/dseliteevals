-- Move 14 Ruby off December Dash (Buda, Dec 5) and onto Paniolo Power Play
-- (Fort Worth, Dec 5-6). Same reasoning as the Diamonds: a harder tournament
-- ahead of the West Coast Juniors NQ in Anaheim (Jan 9-11), where 14 Ruby is
-- already registered in the American division. 14 Ruby is NOT going to Fast
-- Warm Up, so for them Paniolo is the single step up before the qualifier.
--
-- NOTE: their December Dash entry was status 'locked' on an AES event
-- (advancedeventsystems.com/46756, registration deadline 2026-11-28). Removing
-- the row here only updates our schedule — the actual withdrawal has to be done
-- in AES, and any entry fee already committed may not be refundable.

insert into public.tournament_assignments (tournament_id, team_id, division, status, notes)
values (146, '14 Ruby', 'Club', 'planned',
        'Plays 14U. Moved off December Dash for this. Not attending Fast Warm Up — Paniolo is their one step up before the West Coast NQ.')
on conflict do nothing;

delete from public.tournament_assignments
where tournament_id = 235 and team_id = '14 Ruby';

select 'paniolo' as ev, team_id, division, status from public.tournament_assignments where tournament_id = 146
union all
select 'december dash', team_id, division, status from public.tournament_assignments where tournament_id = 235
order by ev, team_id;
