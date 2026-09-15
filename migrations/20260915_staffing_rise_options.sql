-- Staffing board: Rise coaching options Drew is weighing (planning only —
-- nothing here changes practice_teams).
--   Rob Roberts  → head coach 11 Rise 1 and/or 14 Rise 1
--   Lindsey Shumway → maybe move to head 12 Rise 1 (if Rob leaves it)
--   Valerie Reyna → assistant on a Rise team, or head a second 12 Rise team

insert into staffing_needs (team_name, role, priority, status, notes) values
  ('11 Rise 1', 'head',      'normal', 'considering', 'Lindsey Shumway heads it today. Considering Rob Roberts as head, with Lindsey moving to 12 Rise.'),
  ('11 Rise 1', 'assistant', 'normal', 'considering', 'Rob Roberts assists today — opens if he moves up to head.'),
  ('12 Rise 1', 'head',      'normal', 'considering', 'Rob Roberts heads it today. If Rob moves to 11/14 Rise, Lindsey Shumway maybe.'),
  ('12 Rise 2', 'head',      'normal', 'open',        'Possible second 12s Rise team (12 Rise 1 has 13 players). Not a practice team yet.'),
  ('14 Rise 1', 'head',      'high',   'open',        'No coaches at all right now.'),
  ('14 Rise 1', 'assistant', 'high',   'open',        'No coaches at all right now.');

insert into staffing_candidates (name, contact, status, on_roster, wants, notes) values
  ('Rob Roberts',     'adrielroberts97@gmail.com · 202-487-1439', 'considering', true, 'Head coach a Rise team', 'Heads 12 Rise 1 and assists 11 Rise 1 today. Could head 11 Rise and 14 Rise.'),
  ('Lindsey Shumway', 'lrshumway@gmail.com · 361-522-8733',       'considering', true, 'Head coach a Rise team', 'Heads 11 Rise 1 today. Maybe move to 12 Rise.'),
  ('Valerie Reyna',   'missvaleriereyna@gmail.com · 737-317-0044','available',   true, 'Assist a Rise team, or head a second 12s Rise team', 'Not Victoria Reyna (12 Rise 1 assistant).')
on conflict ((lower(btrim(name)))) do nothing;

insert into staffing_matches (need_id, candidate_id, fit, status, notes)
select n.id, c.id, m.fit, 'idea', ''
from (values
  ('11 Rise 1', 'head',      'Rob Roberts',     'strong'),
  ('14 Rise 1', 'head',      'Rob Roberts',     'strong'),
  ('12 Rise 1', 'head',      'Lindsey Shumway', 'maybe'),
  ('12 Rise 2', 'head',      'Valerie Reyna',   'maybe'),
  ('11 Rise 1', 'assistant', 'Valerie Reyna',   'maybe'),
  ('13 Rise 1', 'assistant', 'Valerie Reyna',   'maybe'),
  ('14 Rise 1', 'assistant', 'Valerie Reyna',   'maybe')
) as m(team_name, role, cand, fit)
join lateral (select id from staffing_needs n where n.team_name = m.team_name and n.role = m.role and n.status in ('open','considering') order by id limit 1) n on true
join staffing_candidates c on lower(btrim(c.name)) = lower(m.cand)
on conflict (need_id, candidate_id) do nothing;
