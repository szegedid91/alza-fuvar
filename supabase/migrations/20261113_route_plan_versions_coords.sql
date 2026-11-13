-- A pillanatkép a boxok koordinátáját is tárolja (lat/lng), hogy a km akkor is számolható legyen,
-- ha a box később kikerül a jegyzékből vagy más azonosítót kap.
create or replace function public.replace_route_stops(p_route_id uuid, p_stops jsonb, p_planned_start time without time zone default null, p_planned_end time without time zone default null, p_source text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_ws uuid; r jsonb; i int := 0; v_code text;
begin
  select workspace_id, code into v_ws, v_code from public.route_names where id = p_route_id;
  if v_ws is null then raise exception 'A járat nem található'; end if;
  if not public.is_manager_or_admin() or not public.can_access_workspace(v_ws) then raise exception 'Nincs jogosultság'; end if;
  delete from public.route_stops where route_id = p_route_id;
  for r in select * from jsonb_array_elements(p_stops) loop
    i := i + 1;
    insert into public.route_stops (workspace_id, route_id, box_id, sort_order, eta, etd, deadline)
    values (v_ws, p_route_id, (r->>'box_id')::uuid, i, nullif(r->>'eta', '')::time, nullif(r->>'etd', '')::time, nullif(r->>'deadline', '')::time);
  end loop;
  update public.route_names set planned_start = p_planned_start, planned_end = p_planned_end, plan_imported_at = now(), plan_source = p_source, is_relief = false
   where id = p_route_id;
  update public.route_runs rr set current_stop_id = s.id
    from public.route_stops s
   where rr.route_id = p_route_id and rr.work_date = (now() at time zone 'Europe/Budapest')::date and s.route_id = p_route_id and s.box_id = rr.current_box_id;
  insert into public.route_plan_versions (workspace_id, route_id, code, source, imported_at, imported_by, planned_start, planned_end, stops)
  select v_ws, p_route_id, v_code, p_source, now(), auth.uid(), p_planned_start, p_planned_end,
         coalesce((select jsonb_agg(jsonb_build_object('box_id', s.box_id, 'code', b.code, 'name', b.name, 'lat', b.lat, 'lng', b.lng, 'eta', s.eta, 'etd', s.etd, 'deadline', s.deadline) order by s.sort_order)
                   from public.route_stops s left join public.alza_boxes b on b.id = s.box_id where s.route_id = p_route_id), '[]'::jsonb);
end $function$;

-- A meglévő pillanatképekbe a még meglévő boxok koordinátája utólag bekerül
update public.route_plan_versions v set stops = (
  select jsonb_agg(
    case when b.id is not null then st || jsonb_build_object('lat', b.lat, 'lng', b.lng, 'code', coalesce(st->>'code', b.code), 'name', coalesce(st->>'name', b.name)) else st end
    order by ord)
  from jsonb_array_elements(v.stops) with ordinality as e(st, ord)
  left join public.alza_boxes b on b.id = (st->>'box_id')::uuid
) where jsonb_array_length(v.stops) > 0;
