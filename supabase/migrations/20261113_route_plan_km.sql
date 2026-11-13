-- Közúti km az Alza tervfájljából: megállónként „az előzőtől” (Vzdálenost z předchozí), járatonként összes
-- (Celková vzdálenost) és a visszaút a raktárba. A pillanatkép is őrzi. Ugyanannak a fájlnak az
-- újratöltése nem csinál új verziót, hanem a meglévőt frissíti (pl. a km utólagos pótlásához).
alter table public.route_stops add column if not exists dist_prev_km numeric;
alter table public.route_names add column if not exists plan_km numeric, add column if not exists plan_back_km numeric;
alter table public.route_plan_versions add column if not exists plan_km numeric, add column if not exists back_km numeric;

drop function if exists public.replace_route_stops(uuid, jsonb, time, time, text);
create or replace function public.replace_route_stops(p_route_id uuid, p_stops jsonb, p_planned_start time without time zone default null, p_planned_end time without time zone default null, p_source text default null, p_plan_km numeric default null, p_back_km numeric default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_ws uuid; r jsonb; i int := 0; v_code text; v_stops jsonb; v_prev_id uuid;
begin
  select workspace_id, code into v_ws, v_code from public.route_names where id = p_route_id;
  if v_ws is null then raise exception 'A járat nem található'; end if;
  if not public.is_manager_or_admin() or not public.can_access_workspace(v_ws) then raise exception 'Nincs jogosultság'; end if;
  delete from public.route_stops where route_id = p_route_id;
  for r in select * from jsonb_array_elements(p_stops) loop
    i := i + 1;
    insert into public.route_stops (workspace_id, route_id, box_id, sort_order, eta, etd, deadline, dist_prev_km)
    values (v_ws, p_route_id, (r->>'box_id')::uuid, i, nullif(r->>'eta', '')::time, nullif(r->>'etd', '')::time, nullif(r->>'deadline', '')::time, nullif(r->>'dist_km', '')::numeric);
  end loop;
  update public.route_names set planned_start = p_planned_start, planned_end = p_planned_end, plan_imported_at = now(), plan_source = p_source, is_relief = false,
         plan_km = p_plan_km, plan_back_km = p_back_km
   where id = p_route_id;
  update public.route_runs rr set current_stop_id = s.id
    from public.route_stops s
   where rr.route_id = p_route_id and rr.work_date = (now() at time zone 'Europe/Budapest')::date and s.route_id = p_route_id and s.box_id = rr.current_box_id;
  select coalesce(jsonb_agg(jsonb_build_object('box_id', s.box_id, 'code', b.code, 'name', b.name, 'lat', b.lat, 'lng', b.lng, 'eta', s.eta, 'etd', s.etd, 'deadline', s.deadline, 'dist_km', s.dist_prev_km) order by s.sort_order), '[]'::jsonb)
    into v_stops
    from public.route_stops s left join public.alza_boxes b on b.id = s.box_id where s.route_id = p_route_id;
  -- ugyanaz a fájl, ugyanazok a boxok ugyanabban a sorrendben → a legutóbbi pillanatkép frissül
  select v.id into v_prev_id from public.route_plan_versions v
   where v.route_id = p_route_id and v.source is not distinct from p_source
     and (select jsonb_agg(x->>'box_id') from jsonb_array_elements(v.stops) x) = (select jsonb_agg(x->>'box_id') from jsonb_array_elements(v_stops) x)
   order by v.imported_at desc limit 1;
  if v_prev_id is not null then
    update public.route_plan_versions set stops = v_stops, planned_start = p_planned_start, planned_end = p_planned_end, plan_km = p_plan_km, back_km = p_back_km where id = v_prev_id;
  else
    insert into public.route_plan_versions (workspace_id, route_id, code, source, imported_at, imported_by, planned_start, planned_end, stops, plan_km, back_km)
    values (v_ws, p_route_id, v_code, p_source, now(), auth.uid(), p_planned_start, p_planned_end, v_stops, p_plan_km, p_back_km);
  end if;
end $function$;
