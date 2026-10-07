-- 2027 USAV Girls Junior National Championships (usavolleyball.org, announced
-- dates). Venues not yet listed in the app.
insert into public.tournaments (name, start_date, end_date, location, age_low, age_high, gender, is_qualifier, stay_over, aau, source, format, divisions, entries, wish_list)
select v.name, v.s::date, v.e::date, v.loc, v.lo, v.hi, 'Female', false, true, false, 'manual', 'Four Day Format', '{}'::text[], '{}'::text[], '{}'::text[]
from (values
  ('USAV Girls Junior Nationals 11s-13s', '2027-06-18', '2027-06-21', 'Chicago, IL',   11, 13),
  ('USAV Girls Junior Nationals 14s-15s', '2027-06-27', '2027-06-30', 'Las Vegas, NV', 14, 15),
  ('USAV Girls Junior Nationals 16s-17s', '2027-07-02', '2027-07-05', 'Las Vegas, NV', 16, 17)
) as v(name, s, e, loc, lo, hi)
where not exists (select 1 from public.tournaments t where t.name = v.name);
select json_agg(x) from (select id, name, start_date, end_date, location from public.tournaments where name like 'USAV Girls Junior Nationals%' order by start_date) x;
