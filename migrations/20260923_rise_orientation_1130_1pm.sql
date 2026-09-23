-- Rise orientation runs 11:30am–1:00pm (was 11:30–3:00). Coaches are paid
-- 11:00–1:30: half an hour to set up, half an hour to clear.
update team_events set duration_min = 90, updated_at = now()
where event_date = '2026-10-11' and title ilike 'Orientation%';

update orientation_nights set end_time = '13:30', updated_at = now()
where night_date = '2026-10-11';

select team_name, start_time, duration_min from team_events where event_date = '2026-10-11' and title ilike 'Orientation%';
select label, start_time, end_time from orientation_nights where night_date = '2026-10-11';
