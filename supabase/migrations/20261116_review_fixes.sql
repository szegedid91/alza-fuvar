-- Az átnézés (2026-11-16) adatbázis-oldali javításai.

-- 1) Munkaidő autóváltásnál (A → B → A): a visszaüléskor a becsekkolás kezdete új szakaszt kap, és a nap első
--    kezdése elveszett (05:00–14:00 helyett 09:00–14:00 látszott). Az EREDETI kezdést külön oszlop őrzi.
alter table public.check_ins add column if not exists first_checked_in_at timestamptz;
alter table public.check_ins disable trigger user;
update public.check_ins set first_checked_in_at = checked_in_at where first_checked_in_at is null;
alter table public.check_ins enable trigger user;

create or replace function public.keep_first_check_in()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.first_checked_in_at := new.checked_in_at;
  else new.first_checked_in_at := coalesce(old.first_checked_in_at, old.checked_in_at);
  end if;
  return new;
end $$;
-- a név szerint a többi (guard) trigger UTÁN fut: beszúrásnál már a végleges kezdési időt látja
drop trigger if exists check_ins_zz_first_start on public.check_ins;
create trigger check_ins_zz_first_start before insert or update on public.check_ins
  for each row execute function public.keep_first_check_in();

-- 2) Napi számláló atomi léptetése (a kép-kiolvasó napi kerete párhuzamos kérésekkel megkerülhető volt)
create or replace function public.bump_daily_counter(p_key text, p_limit int)
returns boolean language plpgsql security definer set search_path = public as $$
declare v int;
begin
  insert into public.internal_config (key, value) values (p_key, '1')
  on conflict (key) do update set value = ((public.internal_config.value)::int + 1)::text
    where (public.internal_config.value)::int < p_limit
  returning (value)::int into v;
  return v is not null;
end $$;
revoke all on function public.bump_daily_counter(text, int) from public, anon, authenticated;

-- 3) Értesítés-áradat ellen: a futár box-megjegyzése és box-hiba jelentése minden vezetőnek értesítést küld —
--    10 percenként legfeljebb 20, illetve 10 darab (a vezetőkre nem vonatkozik)
create or replace function public.crew_insert_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_n int; v_max int := tg_argv[0]::int;
begin
  if auth.uid() is null or public.is_manager_or_admin() then return new; end if;
  execute format('select count(*) from public.%I where created_by = $1 and created_at > now() - interval ''10 minutes''', tg_table_name)
    into v_n using auth.uid();
  if v_n >= v_max then
    raise exception 'Túl sok bejelentés rövid idő alatt — várj pár percet, vagy szólj a vezetőnek.';
  end if;
  return new;
end $$;
revoke all on function public.crew_insert_rate_limit() from public, anon, authenticated;
drop trigger if exists box_notes_rate_limit on public.box_notes;
create trigger box_notes_rate_limit before insert on public.box_notes
  for each row execute function public.crew_insert_rate_limit('20');
drop trigger if exists box_issue_reports_rate_limit on public.box_issue_reports;
create trigger box_issue_reports_rate_limit before insert on public.box_issue_reports
  for each row execute function public.crew_insert_rate_limit('10');

-- 4) Gyorsítás: indexek a percenként lekérdezett táblákra
create index if not exists status_events_user_date_idx on public.status_events (user_id, work_date);
create index if not exists route_runs_ws_date_idx on public.route_runs (workspace_id, work_date);
create index if not exists box_sheets_car_date_idx on public.box_sheets (car_id, work_date);

-- 5) Gyorsítás: a soronként kiértékelődő auth.uid() egyszer fusson (a szabály tartalma nem változik)
alter policy fb_insert on public.feedback
  with check (public.can_access_workspace(workspace_id) and user_id = (select auth.uid()));
alter policy fb_select on public.feedback
  using (public.can_access_workspace(workspace_id) and (user_id = (select auth.uid()) or (select public.is_manager_or_admin())));
alter policy bssp_insert on public.box_sheet_stop_photos
  with check (public.can_access_workspace(workspace_id) and exists (
    select 1 from public.box_sheet_stops st join public.box_sheets sh on sh.id = st.sheet_id
     where st.id = box_sheet_stop_photos.stop_id and (sh.user_id = (select auth.uid()) or (select public.is_manager_or_admin()))));
alter policy bssp_update on public.box_sheet_stop_photos
  using (public.can_access_workspace(workspace_id) and exists (
    select 1 from public.box_sheet_stops st join public.box_sheets sh on sh.id = st.sheet_id
     where st.id = box_sheet_stop_photos.stop_id and (sh.user_id = (select auth.uid()) or (select public.is_manager_or_admin()))));
alter policy bssp_delete on public.box_sheet_stop_photos
  using (public.can_access_workspace(workspace_id) and exists (
    select 1 from public.box_sheet_stops st join public.box_sheets sh on sh.id = st.sheet_id
     where st.id = box_sheet_stop_photos.stop_id and (sh.user_id = (select auth.uid()) or (select public.is_manager_or_admin()))));

-- 6) Járatterv betöltése EGY tranzakcióban: ha egy járat hibázik, a többi sem változik (eddig járatonként ment,
--    és félbeszakadva fél terv élt). A jogosultságot a járatonkénti függvény ellenőrzi.
create or replace function public.replace_route_plan(p_routes jsonb, p_source text)
returns int language plpgsql set search_path = public as $$
declare r jsonb; n int := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_routes, '[]'::jsonb)) loop
    perform public.replace_route_stops(
      (r->>'route_id')::uuid, coalesce(r->'stops', '[]'::jsonb),
      nullif(r->>'planned_start', '')::time, nullif(r->>'planned_end', '')::time, p_source,
      nullif(r->>'plan_km', '')::numeric, nullif(r->>'back_km', '')::numeric);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.replace_route_plan(jsonb, text) from public, anon;
grant execute on function public.replace_route_plan(jsonb, text) to authenticated;

-- 7) Meglévő függvények célzott módosítása (ha a keresett részlet nincs meg, a migráció hibával megáll)
do $$
declare v_src text; v_new text;
begin
  -- a) menedzser is elutasíthat FÜGGŐ regisztrációt (annak még nincs munkaterülete) — eddig csak admin tudta
  select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_user_status';
  v_new := replace(v_src,
    'if v_target.workspace_id is null or v_target.workspace_id not in (select public.user_workspace_ids()) then',
    'if not (v_target.status = ''pending'' and p_status = ''disabled'') and (v_target.workspace_id is null or v_target.workspace_id not in (select public.user_workspace_ids())) then');
  if v_new = v_src then raise exception 'set_user_status: a feltétel nem található'; end if;
  execute v_new;

  -- b) „Nem indult el” riasztás: a hiányzókat a MUNKANAP beosztása szerint nézi (este 18:00 után a következő
  --    napét — így az esti 1. körre is állítható határidő); a határidő órája és a napi egyszeri tüzelés marad
  select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tick_setoff_alerts';
  v_new := replace(v_src, 'public.setoff_missing(r.workspace_id, v_today, r.scope)', 'public.setoff_missing(r.workspace_id, public.work_day_now(), r.scope)');
  if v_new = v_src then raise exception 'tick_setoff_alerts: a hívás nem található'; end if;
  execute v_new;

  -- c) tesztnap újraindítása: letiltott tesztfiókkal nem működik
  select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'test_day_reset';
  v_new := replace(v_src, 'if v_uid is null or v_uid not in (', 'if v_uid is null or not public.is_active() or v_uid not in (');
  if v_new = v_src then raise exception 'test_day_reset: a feltétel nem található'; end if;
  execute v_new;
end $$;
