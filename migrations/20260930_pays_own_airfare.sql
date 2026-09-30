-- 20260930 — Standing travel arrangements per coach.
--
-- Kristen Alexandrov: the club pays her whole hotel (her own room, no 50%
-- payroll share) and she pays her whole airfare (no reimbursement). The hotel
-- half already has a standing flag (coach_roster.own_room_club_paid); the
-- airfare half gets one here, so every trip — including ones not planned yet —
-- follows it without being set trip by trip.
--
-- Run: node scripts/run-sql.mjs migrations/20260930_pays_own_airfare.sql

alter table public.coach_roster add column if not exists pays_own_airfare boolean not null default false;
comment on column public.coach_roster.pays_own_airfare is
  'Standing arrangement: this coach buys her own flights and is not reimbursed. Her airfare counts as $0 to the club.';

update public.coach_roster set own_room_club_paid = true, pays_own_airfare = true
 where first_name = 'Kristen' and last_name = 'Alexandrov';

select first_name, last_name, own_room_club_paid, pays_own_airfare from public.coach_roster where pays_own_airfare or own_room_club_paid;
