-- What each coach was last told about one practice day, so the Day Schedule
-- can list whose plan has changed since and text just those people.
--   kind 'baseline' = the plan as it stood when first recorded (Saturday's
--                     schedule run, or the first time the screen opened the day)
--   kind 'sent'     = an updated plan we texted them
-- The latest row per (plan_date, person_key) is what that coach knows.
create table if not exists day_plan_texts (
  id          bigserial primary key,
  plan_date   date not null,
  person_key  text not null,
  coach_name  text not null,
  phone       text,
  plan_text   text not null,
  kind        text not null default 'baseline' check (kind in ('baseline', 'sent')),
  sent_by     text,
  created_at  timestamptz not null default now()
);
create index if not exists day_plan_texts_date_idx on day_plan_texts (plan_date, person_key, created_at desc);
alter table day_plan_texts enable row level security;
-- No policies: only the service-role API (api/day-schedule.js) reads or writes it.
