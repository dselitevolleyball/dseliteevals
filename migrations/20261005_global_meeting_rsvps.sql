-- RSVPs for the Global Challenge (Europe) interest meeting, Sun 11 Oct 2026
-- 3:30pm, DSSC Warehouse + Zoom. One row per player (family), via /meet?t=
-- (players.global_token).
create table if not exists global_meeting_rsvps (
  player_id   bigint primary key references players(id) on delete cascade,
  response    text not null check (response in ('in_person', 'zoom', 'cant')),
  attendees   int,
  note        text,
  responder   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table global_meeting_rsvps enable row level security;
do $$ begin
  create policy global_meeting_rsvps_read on global_meeting_rsvps for select to authenticated using (true);
exception when duplicate_object then null; end $$;
