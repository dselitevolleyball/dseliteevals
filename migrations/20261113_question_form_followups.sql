-- Follow-ups on a question form (Drew, Oct 30 2026: "I want to be able to
-- respond to questions on the financial reports to send comments back to
-- Deroald"). Once the answers are in, Drew's copy (?r=) has a reply box under
-- each answer; "Send to Deroald" sends the ones he filled in, and Deroald's
-- link (?t=) asks him just those, one at a time, until he sends his replies
-- back. As many rounds as it takes. api/questions-form.js.
alter table public.question_forms
  -- { <question id>: [{ by: 'asker' | 'recipient', text, at }] }, in order, sent only
  add column if not exists replies jsonb not null default '{}'::jsonb,
  -- { asker: { <question id>: text }, recipient: { <question id>: text } }: typed, not sent yet
  add column if not exists drafts jsonb not null default '{}'::jsonb,
  -- null: no follow-ups yet · 'waiting': on the recipient · 'answered': back with the asker
  add column if not exists followup text check (followup in ('waiting', 'answered')),
  add column if not exists followup_round int not null default 0,
  add column if not exists followup_sent_at timestamptz,
  add column if not exists followup_answered_at timestamptz,
  -- The Tasks & Projects card for this round; his replies mark it done.
  add column if not exists followup_task_id bigint references public.dssc_project_tasks(id) on delete set null;
