-- Link a coach to her own kids in the club.
--
-- Why: coach travel is computed from "this coach staffs a team, that team has
-- an overnight tournament, is there a coach_travel row?" That misses the case
-- where the coach's own daughter is at the same tournament on a different
-- team. Drew coaches 14 Diamond; Juliet plays 15 Diamond. When both teams are
-- at one event he is making one trip as a coach and a parent at once, and the
-- room and car math is not the same as a coach travelling alone.
--
-- A link table rather than a column on coach_roster because coaches have more
-- than one kid here: Jeremiah McElwee has two, Lindsey Shumway has two.

create table if not exists public.coach_children (
  id             bigint generated always as identity primary key,
  coach_roster_id bigint not null references public.coach_roster(id) on delete cascade,
  player_id      integer not null references public.players(id) on delete cascade,
  travels_as_family boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  unique (coach_roster_id, player_id)
);

comment on table public.coach_children is
  'A coach''s own children playing in the club. Used so travel and room planning knows when a coach is at a tournament as a parent as well as staff.';
comment on column public.coach_children.travels_as_family is
  'True when the coach travels with her own family for events her child attends, so the club should not assume a separate room or seat. Set false where the club still books her as staff.';

alter table public.coach_children enable row level security;
drop policy if exists coach_children_read on public.coach_children;
create policy coach_children_read on public.coach_children for select using (true);
drop policy if exists coach_children_write on public.coach_children;
create policy coach_children_write on public.coach_children for all using (true) with check (true);

-- Seed from the name matches already in the data. Every one of these shares a
-- surname with the player, so they are families rather than name collisions.
insert into public.coach_children (coach_roster_id, player_id, notes)
select cr.id, p.id, 'Seeded 2026-09-07 from parent_name / parent2_name match.'
from public.coach_roster cr
join public.players p
  on lower(btrim(p.parent_name))  = lower(btrim(cr.first_name||' '||cr.last_name))
  or lower(btrim(p.parent2_name)) = lower(btrim(cr.first_name||' '||cr.last_name))
where coalesce(btrim(cr.first_name),'') <> ''
  and coalesce(btrim(p.team_assignment),'') <> ''
  and coalesce(btrim(p.offer_status),'') not in ('declined','not_invited','opted_out')
on conflict (coach_roster_id, player_id) do nothing;

select btrim(cr.first_name||' '||cr.last_name) as coach,
       btrim(p.first_name||' '||p.last_name) as child,
       p.team_assignment as child_team,
       cc.travels_as_family
from public.coach_children cc
join public.coach_roster cr on cr.id = cc.coach_roster_id
join public.players p on p.id = cc.player_id
order by coach, child;
