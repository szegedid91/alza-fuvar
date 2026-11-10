-- AlzaBox megjegyzések a munkatársaktól, vezetői jóváhagyással (2026-11-10)
-- A box kártyáján (járat-kártya „Box” gomb, AlzaBox kereső) bárki hozzáfűzhet egy megjegyzést
-- („a hátsó bejáratnál”, „kapukód 1234”). Amíg a vezető jóvá nem hagyja, csak a beküldő és a vezetők
-- látják; jóváhagyás után mindenki a munkaterületen.
create table if not exists public.box_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  box_id uuid not null references public.alza_boxes(id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 2 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz
);
comment on table public.box_notes is 'Munkatársi megjegyzések egy AlzaBoxhoz; pending → a vezető hagyja jóvá (approved) vagy utasítja el (rejected).';
create index if not exists box_notes_box_status on public.box_notes (box_id, status);
create index if not exists box_notes_ws_pending on public.box_notes (workspace_id) where status = 'pending';

alter table public.box_notes enable row level security;
drop policy if exists bn_select on public.box_notes;
create policy bn_select on public.box_notes for select
  using (public.can_access_workspace(workspace_id) and (status = 'approved' or created_by = (select auth.uid()) or (select public.is_manager_or_admin())));
drop policy if exists bn_insert on public.box_notes;
create policy bn_insert on public.box_notes for insert
  with check (public.can_access_workspace(workspace_id) and created_by = (select auth.uid()) and (select public.is_active()) and status = 'pending');
drop policy if exists bn_update on public.box_notes;
create policy bn_update on public.box_notes for update
  using (public.can_access_workspace(workspace_id) and (select public.is_manager_or_admin()))
  with check (public.can_access_workspace(workspace_id) and (select public.is_manager_or_admin()));
drop policy if exists bn_delete on public.box_notes;
create policy bn_delete on public.box_notes for delete
  using (public.can_access_workspace(workspace_id) and ((created_by = (select auth.uid()) and status = 'pending') or (select public.is_manager_or_admin())));
revoke all on public.box_notes from anon;
grant select, insert, update, delete on public.box_notes to authenticated;

-- Push egy felhasználónak tetszőleges útvonallal (a setoff_push az Áttekintésre mutat)
create or replace function public.notify_push(p_user uuid, p_title text, p_body text, p_url text, p_tag text)
returns void language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
  select value into v_secret from public.internal_config where key = 'edge_shared_secret';
  perform net.http_post(
    url := 'https://jmhqsfeqfghzxsyqjgjd.supabase.co/functions/v1/send-push',
    body := jsonb_build_object('user_ids', to_jsonb(array[p_user]), 'title', p_title, 'body', left(p_body, 400), 'url', p_url, 'tag', p_tag),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-alza-secret', coalesce(v_secret, '')));
end $$;
revoke execute on function public.notify_push(uuid, text, text, text, text) from public, anon, authenticated;

-- Új megjegyzés → a munkaterület vezetői (és az adminok) pusht kapnak, hogy jóváhagyják
create or replace function public.box_note_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text; v_box text; m record;
begin
  select coalesce(full_name, email, 'Munkatárs') into v_name from public.profiles where id = new.created_by;
  select coalesce(code || ' · ', '') || coalesce(name, '') into v_box from public.alza_boxes where id = new.box_id;
  for m in
    select p.id from public.profiles p
     where p.status = 'active' and p.role in ('manager', 'admin') and p.id <> new.created_by
       and (p.role = 'admin' or p.workspace_id = new.workspace_id
            or exists (select 1 from public.manager_workspaces mw where mw.manager_id = p.id and mw.workspace_id = new.workspace_id))
  loop
    perform public.notify_push(m.id, 'Box-megjegyzés vár jóváhagyásra', v_name || ' — ' || v_box || ': ' || new.text, '/boxok', 'box-note');
  end loop;
  return new;
end $$;
revoke execute on function public.box_note_notify() from public, anon, authenticated;
drop trigger if exists box_note_notify on public.box_notes;
create trigger box_note_notify after insert on public.box_notes for each row execute function public.box_note_notify();
