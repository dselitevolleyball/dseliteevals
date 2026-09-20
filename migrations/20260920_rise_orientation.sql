-- Rise orientation + jersey try-ons, Mon 12 Oct 2026.
--
-- The four September nights were age-wide: every coach on an 11s team was due
-- at the 11s night. This one is for the three Rise teams only, so a night can
-- now name teams instead of ages. `ages` still works for the old rows; when
-- `teams` is non-empty it wins.
alter table orientation_nights add column if not exists teams text[] not null default '{}';

comment on column orientation_nights.teams is
  'Specific teams due at this night. Empty = use ages. A coach is due if any team she is on is listed.';

insert into orientation_nights (night_date, label, ages, teams, start_time, end_time, notes)
values ('2026-10-12', 'Rise orientation + jersey try-ons', '{}',
        '{"11 Rise 1","12 Rise 1","13 Rise 1"}', '11:00', '15:00',
        'Jersey try-ons from 11:30am, orientation and commitment meeting at 12pm. Mandatory for all Rise players. Also the make-up jersey try-on for any player who missed the August fittings.')
on conflict (night_date) do update
  set label = excluded.label, ages = excluded.ages, teams = excluded.teams,
      start_time = excluded.start_time, end_time = excluded.end_time,
      notes = excluded.notes, updated_at = now();

select id, night_date, label, ages, teams, start_time, end_time from orientation_nights order by night_date;
