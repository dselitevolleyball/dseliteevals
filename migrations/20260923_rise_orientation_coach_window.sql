-- Coach pay for the Rise orientation matches the event itself: 11:30am–1:00pm.
update orientation_nights set start_time = '11:30', end_time = '13:00', updated_at = now()
where night_date = '2026-10-11';
select label, night_date, start_time, end_time, teams from orientation_nights where night_date = '2026-10-11';
