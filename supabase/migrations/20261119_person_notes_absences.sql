-- Adatlap: vezetői jegyzetek (megjegyzés, dicséret, figyelmeztetés, megbízói panasz) és távollétek (szabadság, betegség).
-- Csak a vezetők látják és írják (a munkatárs nem) — a saját munkaterületükön.

create table if not exists public.person_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('note', 'praise', 'warning', 'complaint')),
  note_date date not null default ((now() at time zone 'Europe/Budapest')::date),
  text text not null check (char_length(btrim(text)) between 1 and 2000),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists person_notes_user_idx on public.person_notes (user_id, note_date desc);
create index if not exists person_notes_ws_date_idx on public.person_notes (workspace_id, note_date);

create table if not exists public.absences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('leave', 'sick', 'other')),
  from_date date not null,
  to_date date not null,
  note text check (note is null or char_length(note) <= 500),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (to_date >= from_date and to_date - from_date <= 366)
);
create index if not exists absences_user_idx on public.absences (user_id, from_date);
create index if not exists absences_ws_date_idx on public.absences (workspace_id, from_date, to_date);

do $$
declare t text;
begin
  foreach t in array array['person_notes', 'absences'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    -- az érintett személy is a munkaterület tagja legyen (ne lehessen idegen emberhez jegyzetet fűzni)
    execute format($p$create policy %I on public.%I for all
      using ((select public.is_manager_or_admin()) and public.can_access_workspace(workspace_id))
      with check ((select public.is_manager_or_admin()) and public.can_access_workspace(workspace_id)
                  and exists (select 1 from public.profiles p where p.id = user_id and p.workspace_id = %I.workspace_id))$p$, t || '_all', t, t);
  end loop;
end $$;
