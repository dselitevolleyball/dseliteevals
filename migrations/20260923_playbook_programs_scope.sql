-- The watch now reads Playbook's volleyball and Reach Performance pages only,
-- so basketball (and the general odds and ends) leave the table.
alter table public.playbook_programs add column if not exists category text;
delete from public.playbook_programs;
delete from public.playbook_program_runs;
