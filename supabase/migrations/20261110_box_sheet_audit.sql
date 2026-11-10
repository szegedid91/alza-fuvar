-- Box-lap utólagos módosításainak naplója (2026-11-10)
-- A nap végén a lapot a futár visszanézheti és javíthatja; minden ilyen módosítás naplózódik:
-- ki, mikor, mit miről mire (a saját lapon is — eddig a tulajdonos módosítása nem került a naplóba,
-- a megállók módosítása pedig egyáltalán nem). A bejegyzés jelzi, utólagos-e:
--   megálló: 15 perccel a leadás (done_at) után; lap: lezárás után vagy a munkanapot követő napon.
create or replace function public.audit_box_sheet_edit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_late boolean; v_box text; v_sheet uuid; v_date date; v_owner uuid; v_old jsonb; v_new jsonb;
begin
  if tg_table_name = 'box_sheet_stops' then
    v_sheet := coalesce(old.sheet_id, new.sheet_id);
    select work_date, user_id into v_date, v_owner from public.box_sheets where id = v_sheet;
    v_late := now() > coalesce(old.done_at, old.created_at) + interval '15 minutes';
    v_box := coalesce(old.box_code, old.box_name);
  else
    v_sheet := old.id; v_date := old.work_date; v_owner := old.user_id;
    v_late := old.submitted_at is not null or (now() at time zone 'Europe/Budapest')::date > old.work_date;
  end if;
  v_old := to_jsonb(old) - 'updated_at';
  v_new := case when tg_op = 'DELETE' then null else to_jsonb(new) - 'updated_at' end;
  if tg_op = 'UPDATE' and v_old = v_new then return new; end if;
  insert into public.audit_log (workspace_id, actor_id, action, entity, entity_id, detail)
  values (coalesce(old.workspace_id, new.workspace_id), auth.uid(), tg_op, tg_table_name, old.id,
    jsonb_build_object('old', v_old, 'new', v_new, 'late', v_late, 'sheet_id', v_sheet, 'work_date', v_date, 'owner_id', v_owner, 'box_code', v_box));
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke execute on function public.audit_box_sheet_edit() from public, anon, authenticated;

drop trigger if exists audit_box_sheets on public.box_sheets;
create trigger audit_box_sheets after update or delete on public.box_sheets for each row execute function public.audit_box_sheet_edit();
drop trigger if exists audit_box_sheet_stops on public.box_sheet_stops;
create trigger audit_box_sheet_stops after update or delete on public.box_sheet_stops for each row execute function public.audit_box_sheet_edit();
create index if not exists audit_log_box_sheet_late on public.audit_log (workspace_id, created_at desc) where entity in ('box_sheets', 'box_sheet_stops');
