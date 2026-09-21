-- Rise orientation moves from Mon 12 Oct to Sun 11 Oct 2026 (same times).
update orientation_nights set night_date = '2026-10-11', updated_at = now() where night_date = '2026-10-12';
update team_events set event_date = '2026-10-11', updated_at = now()
where event_date = '2026-10-12' and title ilike 'Orientation%';
select 'night' as what, night_date::text as d, label from orientation_nights where label ilike 'Rise%'
union all select 'event', event_date::text, team_name from team_events where title ilike 'Orientation + jersey%';
