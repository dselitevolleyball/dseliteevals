-- Orientation nights, so coaches can clock in for them.
--
-- A coach's clock-in list is built from the practice schedule: her own team's
-- session, a practice she is covering, a float shift. Orientation is none of
-- those, so on 11 September twenty-eight coaches would have worked a five-hour
-- evening with no way to log it and no line on the Monday payroll.
--
-- A table rather than four dates in the code, because these move. The `ages`
-- array is what ties a night to the people expected at it: a coach is due at
-- an orientation if any team she is on starts with one of these numbers.
--
-- 5pm to 10pm is the payable window — 5:00 is when setup starts, and the
-- coaches who arrive at 5:30 edit their own hours down, the same way they can
-- on any other shift.

create table if not exists orientation_nights (
  id           bigserial primary key,
  night_date   date        not null unique,
  label        text        not null,
  ages         text[]      not null,
  start_time   time        not null default '17:00',
  end_time     time        not null default '22:00',
  cancelled    boolean     not null default false,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table orientation_nights enable row level security;

drop policy if exists orientation_nights_read on orientation_nights;
create policy orientation_nights_read on orientation_nights
  for select using (true);

drop policy if exists orientation_nights_write on orientation_nights;
create policy orientation_nights_write on orientation_nights
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

insert into orientation_nights (night_date, label, ages) values
  ('2026-09-11', '14s',        array['14']),
  ('2026-09-12', '15s and 16s', array['15','16']),
  ('2026-09-18', '13s',        array['13']),
  ('2026-09-25', '11s and 12s', array['11','12'])
on conflict (night_date) do nothing;
