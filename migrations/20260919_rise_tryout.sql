-- Rise tryout (Sat 19 Sep 2026). "Tryout attended" is already true for the
-- June tryouts, so it can't pick out today's group; this flag does. Set for the
-- 36 players who were given a pinny today; staff tick it on the player card
-- for any walk-up.
alter table public.players add column if not exists rise_tryout boolean not null default false;

update public.players set rise_tryout = true where id in (
  353, 428, 430, 426, 423, 244, 433, 37, 255, 325, 254, 333, 3, 435, 436, 261, 33, 266,
  15, 38, 432, 32, 437, 289, 421, 427, 305, 429, 424, 434, 324, 11, 438, 439, 431, 422
);

select count(*) filter (where rise_tryout) as rise_tryout_players from public.players;
