-- Terület-semleges raktárnév (2026-11-09)
-- Az app az Utód Zrt.-é, a területek a megbízók; egy új terület raktárának alapneve ne „Alza raktár” legyen.
alter table public.workspaces alter column depot_name set default 'Raktár';
