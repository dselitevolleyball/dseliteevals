-- DS Elite Social: fun ideas (Drew, Oct 29 2026: "a fun ideas social post for
-- DS Elite - holidays, upcoming tournaments, schedules of tournaments when
-- they are posted, birthdays of coaches, memes and viral posts").
-- api/_lib/dse-social-ideas.js fills this from the club's own data (coach
-- birthdays, tournaments, posted schedules, holidays) and from Claude (memes,
-- trends, engagement posts). "Make it a post" renders the graphic and drafts a
-- dse_social_posts row (kind 'idea') that goes through the usual approval.
create table if not exists public.dse_social_ideas (
  id          bigint generated always as identity primary key,
  key         text unique,                       -- dedupe for data ideas: bday:<roster id>:<year>, tourney:<id>, sched:<tournament id>, holiday:<slug>:<year>
  kind        text not null check (kind in ('birthday', 'tournament', 'schedule', 'holiday', 'meme', 'trend', 'engagement', 'throwback')),
  post_on     date,
  title       text not null,
  pitch       text,
  caption     text,
  hashtags    text[] not null default '{}',
  card        jsonb not null default '{}'::jsonb,   -- the graphic: { style, tag, headline, sub, lines, top, bottom, photo }
  data        jsonb not null default '{}'::jsonb,   -- what it came from (coach, tournament, teams...)
  sources     jsonb,
  status      text not null default 'new' check (status in ('new', 'drafted', 'dismissed')),
  post_id     bigint references public.dse_social_posts(id) on delete set null,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists dse_social_ideas_open on public.dse_social_ideas (status, post_on);
alter table public.dse_social_ideas enable row level security;   -- service role only (HQ's /api/dse-social)

alter table public.dse_social_posts drop constraint if exists dse_social_posts_kind_check;
alter table public.dse_social_posts add constraint dse_social_posts_kind_check check (kind in ('photos', 'coach_intro', 'idea'));

alter table public.dse_social_settings add column if not exists auto_ideas boolean not null default true;   -- birthdays, game weeks and posted schedules become drafts on their own
alter table public.dse_social_settings add column if not exists ideas_synced_at timestamptz;
alter table public.dse_social_settings add column if not exists ideas_brainstormed_at timestamptz;
