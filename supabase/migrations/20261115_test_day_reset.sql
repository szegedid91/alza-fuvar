-- Gépi tesztmód: a TESZTFIÓK saját mai napjának újraindítása egy gombbal (a fejlesztői tesztpanelről).
-- Csak a két tesztfiók hívhatja, és csak a SAJÁT mai sorait törli — más felhasználó adatához nem nyúl.
-- Ha mára nincs beosztása, kap egyet (szabad autó + szabad járat, 1. kör), hogy a nap végigpróbálható legyen.
create or replace function public.test_day_reset(p_inspection boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_date date := (now() at time zone 'Europe/Budapest')::date;
  v_ws uuid := '2ba7e471-9850-46af-8cab-aa0b069eed06';
  v_pref_car uuid := '0735aebb-6eaf-44f8-8462-6e5d975998c4';
  v_car uuid; v_route uuid; v_created boolean := false;
  v_cars uuid[];
  n_sheets int; n_events int; n_checkins int; n_runs int; n_insp int := 0;
begin
  if v_uid is null or v_uid not in ('300c3aee-9121-4f1f-b630-33179be8d775'::uuid, '0e932757-418f-49fe-a9a1-dfe97556026d'::uuid) then
    raise exception 'TEST_ONLY: a tesztnap újraindítása csak a tesztfutár fiókjával érhető el';
  end if;

  -- a mai autóim (beosztásból és becsekkolásból): a járat-haladás autóhoz kötött
  select coalesce(array_agg(distinct x.car_id), '{}') into v_cars from (
    select car_id from shifts where work_date = v_date and v_uid in (driver_id, loader_id, trainee_id)
    union select car_id from check_ins where work_date = v_date and user_id = v_uid
  ) x;

  delete from box_issue_reports where created_by = v_uid and (created_at at time zone 'Europe/Budapest')::date = v_date;
  delete from box_sheets where user_id = v_uid and work_date = v_date;
  get diagnostics n_sheets = row_count;
  delete from status_events where user_id = v_uid and work_date = v_date;
  get diagnostics n_events = row_count;
  delete from route_stop_logs where work_date = v_date and user_id = v_uid;
  -- a járat-haladást csak akkor nullázzuk, ha az autón ma rajtam kívül senki nincs beosztva
  delete from route_runs rr where rr.work_date = v_date and rr.car_id = any(v_cars)
    and not exists (select 1 from shifts s where s.work_date = v_date and s.car_id = rr.car_id
                     and (coalesce(s.driver_id, v_uid) <> v_uid or coalesce(s.loader_id, v_uid) <> v_uid or coalesce(s.trainee_id, v_uid) <> v_uid));
  get diagnostics n_runs = row_count;
  delete from cleanings where user_id = v_uid and work_date = v_date;
  if p_inspection then
    delete from car_inspections where user_id = v_uid and work_date = v_date;
    get diagnostics n_insp = row_count;
  end if;
  delete from check_ins where user_id = v_uid and work_date = v_date;
  get diagnostics n_checkins = row_count;

  -- beosztás mára, ha nincs: előbb a szokásos tesztautó, különben bármelyik ma szabad Box-autó
  if not exists (select 1 from shifts where work_date = v_date and v_uid in (driver_id, loader_id, trainee_id)) then
    select c.id into v_car from cars c
     where c.id = v_pref_car and c.active and not exists (select 1 from shifts x where x.work_date = v_date and x.car_id = c.id);
    if v_car is null then
      select c.id into v_car from cars c join car_categories cc on cc.id = c.category_id
       where c.workspace_id = v_ws and c.active and cc.box_sheet
         and not exists (select 1 from shifts x where x.work_date = v_date and x.car_id = c.id)
       order by c.plate limit 1;
    end if;
    if v_car is null then
      raise exception 'Ma nincs szabad autó a tesztnaphoz — a Beosztásban adj autót a tesztfutárnak';
    end if;
    select r.id into v_route from route_names r
     where r.workspace_id = v_ws and exists (select 1 from route_stops rs where rs.route_id = r.id)
       and not exists (select 1 from shifts x where x.work_date = v_date and x.route_id = r.id and x.round = 1)
     order by r.sort_order, r.code limit 1;
    insert into shifts (workspace_id, work_date, car_id, driver_id, round, route_id, created_by)
    values (v_ws, v_date, v_car, v_uid, 1, v_route, v_uid);
    v_created := true;
  end if;

  return jsonb_build_object('date', v_date, 'sheets', n_sheets, 'events', n_events, 'checkins', n_checkins, 'runs', n_runs,
    'inspections', n_insp, 'shift_created', v_created,
    'shifts', (select coalesce(jsonb_agg(jsonb_build_object('round', s.round, 'route', r.code, 'plate', c.plate) order by s.round), '[]'::jsonb)
                 from shifts s join cars c on c.id = s.car_id left join route_names r on r.id = s.route_id
                where s.work_date = v_date and v_uid in (s.driver_id, s.loader_id, s.trainee_id)));
end $$;

revoke all on function public.test_day_reset(boolean) from public, anon;
grant execute on function public.test_day_reset(boolean) to authenticated;
