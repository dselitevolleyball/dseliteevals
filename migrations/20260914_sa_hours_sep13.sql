-- Sunday Sep 13: coaches weren't offered their team's speed & agility hour on
-- the clock-in screen, so they logged only practice. The team was in the
-- building and the coach with them, so that hour is paid like practice.
--
-- One row per coach who worked their team's practice that day and has nothing
-- else logged in the S&A hour. Left out: 16 Diamond (cancelled), 14 Diamond
-- (both coaches out), Ella Hinkle (at 14 Emerald during 11 Diamond's S&A),
-- Jeremiah McElwee (no hours logged Sunday), and Britney Parker 2-3pm and
-- Jaalin Rosser 1-2pm (already paid that hour as a float).
insert into coach_checkins (coach_name, coach_email, check_date, team_name, slot, phase, hours, role, status, source, note, created_by)
select v.coach_name, v.coach_email, date '2026-09-13', v.team_name, v.slot, 'fall1', 1, 'scheduled', 'present', 'admin',
       'Speed & agility hour — paid with team', 'Drew Rose'
from (values
  ('Jason Baerwald',  null,                         '12 Ruby',     '1-2pm'),
  ('David Stanley',   null,                         '13 Sapphire', '2-3pm'),
  ('Breanna Coward',  'divoga24@gmail.com',         '13 Ruby',     '3-4pm'),
  ('Samantha Mabry',  'samanthagmabry@gmail.com',   '13 Ruby',     '3-4pm'),
  ('Brandon Blahnik', 'brandonblahnik@outlook.com', '11 Diamond',  '5-6pm'),
  ('Hunter Haley',    null,                         '15 Diamond',  '6-7pm'),
  ('Breanna Coward',  'divoga24@gmail.com',         '15 Diamond',  '6-7pm'),
  ('Chang Guo',       null,                         '15 Ruby',     '7-8pm'),
  ('Kelli R Hardge',  'krhardge@gmail.com',         '15 Ruby',     '7-8pm')
) as v(coach_name, coach_email, team_name, slot)
where not exists (
  select 1 from coach_checkins c
  where c.check_date = date '2026-09-13' and lower(c.coach_name) = lower(v.coach_name)
    and coalesce(c.team_name,'') = v.team_name and c.slot = v.slot
);
