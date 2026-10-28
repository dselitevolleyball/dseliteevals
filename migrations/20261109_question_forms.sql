-- One-person question forms (Drew, Oct 28 2026: "a form to send to Deroald
-- where he has to respond to each question 1 by 1, and let me know when it's
-- completed"). api/questions-form.js shows one question at a time from a
-- private link, saves each answer as it goes, and Slacks `notify_email` when
-- the person submits. results_token opens the answers for Drew.
create table if not exists public.question_forms (
  id            bigint generated always as identity primary key,
  token         uuid not null default gen_random_uuid() unique,
  results_token uuid not null default gen_random_uuid() unique,
  brand         text not null default 'dssc' check (brand in ('dssc', 'dse')),
  title         text not null,
  intro         text,
  recipient_name  text not null,
  recipient_email text,
  notify_email  text not null default 'drew@drippingsportsclub.com',
  -- [{ id, section?, title, context: [paragraph], bullets?: [text], table?: { head: [..], rows: [[..]] }, ask }]
  questions     jsonb not null default '[]'::jsonb,
  answers       jsonb not null default '{}'::jsonb,   -- { <question id>: { text, at } }
  status        text not null default 'sent' check (status in ('sent', 'started', 'completed')),
  created_by    text,
  created_at    timestamptz not null default now(),
  opened_at     timestamptz,
  completed_at  timestamptz,
  notified_at   timestamptz
);
alter table public.question_forms enable row level security;   -- service role only
-- The Tasks & Projects card for answering it; sending the form marks it done.
alter table public.question_forms add column if not exists task_id bigint references public.dssc_project_tasks(id) on delete set null;
