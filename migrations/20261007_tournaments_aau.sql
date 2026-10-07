-- AAU events use their own division set (Open, Premier, Elite, Select, Ascend,
-- Club, Aspire, Spirit, Classic) on the tournament Divisions & Ages grid.
alter table public.tournaments add column if not exists aau boolean not null default false;
update public.tournaments set aau = true where source = 'AAU' and aau = false;
