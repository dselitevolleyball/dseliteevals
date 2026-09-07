-- Paniolo Power Play (Fort Worth, Dec 5-6 2026) — enrich the existing record and
-- put 14 Diamond and 15 Diamond on it.
--
-- The event was already in the table twice: id 146 (SportWrench:Other, Jun 1) and
-- id 383 (SportWrench:Sync, Jul 23). Neither had assignments. We keep 146 because
-- it carries the venue, age range and format, and fold 383's source_url into it.
-- 383 is left in place for Drew to decide on rather than deleted here.
--
-- Details from paniolopowerplay.com, read 2026-09-04:
--   Dec 5-6 2026, Game On Sports Complex & All Saints' Episcopal School, Fort Worth
--   Divisions 12U / 14U / 16U / 18U — there is no 15U, so 15 Diamond plays up to 16U
--   Entry $300 early (through 8/31/2026), $400 from 9/1 — we are past the early date
--   No mandatory stay-to-play; first 45 out-of-state teams get $150 off (does not apply to us)

update public.tournaments set
  venue                 = 'Game On Sports Complex & All Saints'' Episcopal School',
  format                = 'Two Day Format',
  divisions             = array['12U','14U','16U','18U'],
  cost                  = 400,
  registration_deadline = date '2026-08-31',
  registration_opens    = date '2026-09-01',
  source_url            = 'https://paniolopowerplay.com/',
  is_qualifier          = false,
  stay_to_play          = false,
  airfare_required      = false,
  notes                 = 'Early-season competition ahead of the qualifier run. No 15U bracket — 15 Diamond plays up into 16U. Entry $400/team at regular pricing (early bird closed 8/31). Fort Worth is roughly a 3.5-4 hour drive; no mandatory housing.',
  updated_at            = now()
where id = 146;

insert into public.tournament_assignments (tournament_id, team_id, division, status, notes)
values
  (146, '14 Diamond', 'Club', 'planned', 'Plays 14U.'),
  (146, '15 Diamond', 'Club', 'planned', 'No 15U bracket — plays up into 16U.')
on conflict do nothing;

select ta.team_id, t.name, t.start_date, t.end_date, t.location, t.venue,
       ta.division, ta.status, t.cost, ta.notes
from public.tournament_assignments ta
join public.tournaments t on t.id = ta.tournament_id
where ta.tournament_id = 146
order by ta.team_id;
