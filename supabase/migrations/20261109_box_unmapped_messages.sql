-- Box-lap kiolvasás: a kijelző egyik mezőhöz sem tartozó üzenetei (2026-11-09)
-- A képkiolvasó az ilyen üzenetet a megálló megjegyzésébe írja, és ide is naplózza, hogy az admin
-- lássa, melyik üzenet hányszor fordul elő — ebből derül ki, hogy kell-e rá külön mező a Box-lapon.
create table if not exists public.box_unmapped_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  stop_id uuid references public.box_sheet_stops(id) on delete set null,
  box_code text,
  text text not null,
  text_key text not null, -- kisbetűs, szóközökre normalizált kulcs a csoportosításhoz
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);
comment on table public.box_unmapped_messages is 'A Box-lap képkiolvasásakor talált, mezőhöz nem sorolható kijelző-üzenetek (admin: kell-e új mező).';
create index if not exists box_unmapped_messages_ws_key on public.box_unmapped_messages (workspace_id, text_key) where resolved_at is null;

alter table public.box_unmapped_messages enable row level security;
drop policy if exists bum_select on public.box_unmapped_messages;
create policy bum_select on public.box_unmapped_messages for select
  using (public.can_access_workspace(workspace_id) and (created_by = (select auth.uid()) or (select public.is_manager_or_admin())));
drop policy if exists bum_insert on public.box_unmapped_messages;
create policy bum_insert on public.box_unmapped_messages for insert
  with check (public.can_access_workspace(workspace_id) and created_by = (select auth.uid()) and (select public.is_active()));
drop policy if exists bum_update on public.box_unmapped_messages;
create policy bum_update on public.box_unmapped_messages for update
  using (public.can_access_workspace(workspace_id) and (select public.is_admin()))
  with check (public.can_access_workspace(workspace_id) and (select public.is_admin()));
revoke all on public.box_unmapped_messages from anon;
grant select, insert, update on public.box_unmapped_messages to authenticated;
