-- Takarítás fotói (2026-11-10)
-- A nap végén (elszámolás után, több kör nélkül) a futár jelzi, takarított-e; ha igen, fotót kérünk róla.
create table if not exists public.cleaning_photos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cleaning_id uuid not null references public.cleanings(id) on delete cascade,
  storage_path text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.cleaning_photos is 'A takarításról készült fotók (a nap végén: ha takarított, fotót kérünk róla).';
create index if not exists cleaning_photos_cleaning on public.cleaning_photos (cleaning_id);
alter table public.cleaning_photos enable row level security;
drop policy if exists clp_select on public.cleaning_photos;
create policy clp_select on public.cleaning_photos for select using (public.can_access_workspace(workspace_id));
drop policy if exists clp_insert on public.cleaning_photos;
create policy clp_insert on public.cleaning_photos for insert
  with check (public.can_access_workspace(workspace_id) and created_by = (select auth.uid()) and (select public.is_active())
    and exists (select 1 from public.cleanings c where c.id = cleaning_id and c.workspace_id = cleaning_photos.workspace_id));
drop policy if exists clp_delete on public.cleaning_photos;
create policy clp_delete on public.cleaning_photos for delete
  using (public.can_access_workspace(workspace_id) and (created_by = (select auth.uid()) or (select public.is_manager_or_admin())));
revoke all on public.cleaning_photos from anon;
grant select, insert, delete on public.cleaning_photos to authenticated;
