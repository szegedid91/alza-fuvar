-- Box-lap: csomagszintű eltérések és box-hiba bejelentés (2026-11-12)
-- 1) box_stop_items: egy megállóhoz tartozó, csomagonként rögzített eltérés (sérült, ismeretlen,
--    nincs vonalkód, rossz ládába címkézve, máshová berakva, reklamációs visszavét, ADMIN csomag),
--    csomagkóddal, fotóval, „visszaviszem a raktárba” jelöléssel.
-- 2) box_issue_reports: box-hiba bejelentés a lapról (nem nyílik, szkenner, emergency, nem enged újat,
--    biztonsági esemény, egyéb) fotóval; a biztonsági eseményről a vezetők azonnal pusht kapnak;
--    az admin boxonként látja, mi ismétlődik.
create table if not exists public.box_stop_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  stop_id uuid not null references public.box_sheet_stops(id) on delete cascade,
  kind text not null check (kind in ('damaged', 'unknown', 'no_barcode', 'mislabelled_crate', 'placed_elsewhere', 'complaint_pickup', 'admin', 'other')),
  package_code text,
  note text,
  return_to_depot boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists box_stop_items_stop on public.box_stop_items (stop_id);
create table if not exists public.box_stop_item_photos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  item_id uuid not null references public.box_stop_items(id) on delete cascade,
  storage_path text,
  created_at timestamptz not null default now()
);
create index if not exists box_stop_item_photos_item on public.box_stop_item_photos (item_id);

create table if not exists public.box_issue_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  box_id uuid references public.alza_boxes(id) on delete set null,
  box_code text,
  stop_id uuid references public.box_sheet_stops(id) on delete set null,
  kind text not null check (kind in ('not_opening', 'scanner', 'emergency', 'no_new', 'security', 'other')),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);
create index if not exists box_issue_reports_box on public.box_issue_reports (box_id, created_at desc);
create index if not exists box_issue_reports_ws on public.box_issue_reports (workspace_id, created_at desc);
create table if not exists public.box_issue_photos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  report_id uuid not null references public.box_issue_reports(id) on delete cascade,
  storage_path text,
  created_at timestamptz not null default now()
);
create index if not exists box_issue_photos_report on public.box_issue_photos (report_id);

-- RLS: a lap tulajdonosa és a vezetők írják / látják (a megálló lapja szerint)
alter table public.box_stop_items enable row level security;
alter table public.box_stop_item_photos enable row level security;
alter table public.box_issue_reports enable row level security;
alter table public.box_issue_photos enable row level security;
drop policy if exists bsi_all on public.box_stop_items;
create policy bsi_all on public.box_stop_items for all
  using (public.can_access_workspace(workspace_id) and exists (select 1 from public.box_sheet_stops st join public.box_sheets sh on sh.id = st.sheet_id where st.id = stop_id and (sh.user_id = (select auth.uid()) or (select public.is_manager_or_admin()))))
  with check (public.can_access_workspace(workspace_id) and exists (select 1 from public.box_sheet_stops st join public.box_sheets sh on sh.id = st.sheet_id where st.id = stop_id and (sh.user_id = (select auth.uid()) or (select public.is_manager_or_admin()))));
drop policy if exists bsip_all on public.box_stop_item_photos;
create policy bsip_all on public.box_stop_item_photos for all
  using (public.can_access_workspace(workspace_id) and exists (select 1 from public.box_stop_items i join public.box_sheet_stops st on st.id = i.stop_id join public.box_sheets sh on sh.id = st.sheet_id where i.id = item_id and (sh.user_id = (select auth.uid()) or (select public.is_manager_or_admin()))))
  with check (public.can_access_workspace(workspace_id) and exists (select 1 from public.box_stop_items i join public.box_sheet_stops st on st.id = i.stop_id join public.box_sheets sh on sh.id = st.sheet_id where i.id = item_id and (sh.user_id = (select auth.uid()) or (select public.is_manager_or_admin()))));
drop policy if exists bir_select on public.box_issue_reports;
create policy bir_select on public.box_issue_reports for select using (public.can_access_workspace(workspace_id));
drop policy if exists bir_insert on public.box_issue_reports;
create policy bir_insert on public.box_issue_reports for insert with check (public.can_access_workspace(workspace_id) and created_by = (select auth.uid()) and (select public.is_active()));
drop policy if exists bir_update on public.box_issue_reports;
create policy bir_update on public.box_issue_reports for update using (public.can_access_workspace(workspace_id) and (select public.is_manager_or_admin())) with check (public.can_access_workspace(workspace_id) and (select public.is_manager_or_admin()));
drop policy if exists bip_select on public.box_issue_photos;
create policy bip_select on public.box_issue_photos for select using (public.can_access_workspace(workspace_id));
drop policy if exists bip_insert on public.box_issue_photos;
create policy bip_insert on public.box_issue_photos for insert with check (public.can_access_workspace(workspace_id) and exists (select 1 from public.box_issue_reports r where r.id = report_id and (r.created_by = (select auth.uid()) or (select public.is_manager_or_admin()))));
revoke all on public.box_stop_items, public.box_stop_item_photos, public.box_issue_reports, public.box_issue_photos from anon;
grant select, insert, update, delete on public.box_stop_items, public.box_stop_item_photos to authenticated;
grant select, insert, update on public.box_issue_reports to authenticated;
grant select, insert on public.box_issue_photos to authenticated;

-- Napló: a csomagszintű eltérések változásai is naplózódnak (ki, mikor, mit)
drop trigger if exists audit_box_stop_items on public.box_stop_items;
create trigger audit_box_stop_items after insert or update or delete on public.box_stop_items for each row execute function public.audit_trigger();
drop trigger if exists audit_box_issue_reports on public.box_issue_reports;
create trigger audit_box_issue_reports after insert or update on public.box_issue_reports for each row execute function public.audit_trigger();

-- Biztonsági esemény → a vezetők azonnal pusht kapnak (a többi hiba a listában gyűlik)
create or replace function public.box_issue_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text; m record; v_title text; v_body text;
begin
  if new.kind <> 'security' then return new; end if;
  select coalesce(full_name, email, 'Munkatárs') into v_name from public.profiles where id = new.created_by;
  v_title := 'Biztonsági esemény a boxnál';
  v_body := coalesce(new.box_code, 'box') || ' — ' || v_name || coalesce(': ' || new.note, '');
  for m in
    select p.id from public.profiles p
     where p.status = 'active' and p.role in ('manager', 'admin') and p.id is distinct from new.created_by
       and (p.role = 'admin' or p.workspace_id = new.workspace_id
            or exists (select 1 from public.manager_workspaces mw where mw.manager_id = p.id and mw.workspace_id = new.workspace_id))
  loop
    perform public.notify_push(m.id, v_title, v_body, '/boxok', 'box-security');
  end loop;
  return new;
end $$;
revoke execute on function public.box_issue_notify() from public, anon, authenticated;
drop trigger if exists box_issue_notify on public.box_issue_reports;
create trigger box_issue_notify after insert on public.box_issue_reports for each row execute function public.box_issue_notify();

-- A kliens helyi sora upsert-tel játssza vissza a beszúrásokat (idempotens) — ehhez update jog is kell
grant update on public.box_issue_photos to authenticated;
drop policy if exists bip_update on public.box_issue_photos;
create policy bip_update on public.box_issue_photos for update
  using (public.can_access_workspace(workspace_id) and exists (select 1 from public.box_issue_reports r where r.id = report_id and (r.created_by = (select auth.uid()) or (select public.is_manager_or_admin()))))
  with check (public.can_access_workspace(workspace_id) and exists (select 1 from public.box_issue_reports r where r.id = report_id and (r.created_by = (select auth.uid()) or (select public.is_manager_or_admin()))));
drop policy if exists bir_update on public.box_issue_reports;
create policy bir_update on public.box_issue_reports for update
  using (public.can_access_workspace(workspace_id) and ((select public.is_manager_or_admin()) or (created_by = (select auth.uid()) and resolved_at is null)))
  with check (public.can_access_workspace(workspace_id) and ((select public.is_manager_or_admin()) or (created_by = (select auth.uid()) and resolved_at is null)));
