-- Járatterv-verziók: minden betöltéskor (replace_route_stops) pillanatkép a járat boxairól és idejeiről.
-- Az admin a „Járat-változások” oldalon látja, mi változott feltöltésről feltöltésre (diagramokkal).
create table if not exists public.route_plan_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  route_id uuid references public.route_names(id) on delete set null,
  code text not null,
  source text,
  imported_at timestamptz not null default now(),
  imported_by uuid references public.profiles(id) on delete set null,
  planned_start time,
  planned_end time,
  stops jsonb not null default '[]'::jsonb
);
create index if not exists route_plan_versions_ws on public.route_plan_versions (workspace_id, imported_at desc);
alter table public.route_plan_versions enable row level security;
drop policy if exists rpv_select on public.route_plan_versions;
create policy rpv_select on public.route_plan_versions for select
  using (public.can_access_workspace(workspace_id) and (select public.is_manager_or_admin()));
revoke all on public.route_plan_versions from anon;
grant select on public.route_plan_versions to authenticated;

-- A pillanatkép a betöltő függvény végén készül (security definer — a kliens nem ír a táblába)
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
  -- a mai futás a box szerint folytatódik (a megálló-azonosítók cserélődtek)
  update public.route_runs rr set current_stop_id = s.id
    from public.route_stops s
   where rr.route_id = p_route_id and rr.work_date = (now() at time zone 'Europe/Budapest')::date and s.route_id = p_route_id and s.box_id = rr.current_box_id;
  -- pillanatkép a verzió-történethez
  insert into public.route_plan_versions (workspace_id, route_id, code, source, imported_at, imported_by, planned_start, planned_end, stops)
  select v_ws, p_route_id, v_code, p_source, now(), auth.uid(), p_planned_start, p_planned_end,
         coalesce((select jsonb_agg(jsonb_build_object('box_id', s.box_id, 'code', b.code, 'name', b.name, 'eta', s.eta, 'etd', s.etd, 'deadline', s.deadline) order by s.sort_order)
                   from public.route_stops s left join public.alza_boxes b on b.id = s.box_id where s.route_id = p_route_id), '[]'::jsonb);
end $function$;

-- Visszatöltés a naplóból: a korábbi betöltések (óránként csoportosítva, járatonként) — csak egyszer, ha még üres
insert into public.route_plan_versions (workspace_id, route_id, code, source, imported_at, imported_by, planned_start, planned_end, stops)
select ins.workspace_id, ins.route_id, rn.code,
       coalesce(meta.source, 'első betöltés'),
       ins.imported_at, (select p.id from public.profiles p where p.id = coalesce(meta.actor, ins.actor)), meta.planned_start::time, meta.planned_end::time, ins.stops
from (
  select a.workspace_id, (a.detail->'new'->>'route_id')::uuid route_id, date_trunc('hour', a.created_at) h,
         max(a.created_at) imported_at, max(a.actor_id::text)::uuid actor,
         jsonb_agg(jsonb_build_object('box_id', a.detail->'new'->>'box_id', 'code', b.code, 'name', b.name,
                   'eta', a.detail->'new'->>'eta', 'etd', a.detail->'new'->>'etd', 'deadline', a.detail->'new'->>'deadline')
                   order by (a.detail->'new'->>'sort_order')::int) stops
  from public.audit_log a left join public.alza_boxes b on b.id = (a.detail->'new'->>'box_id')::uuid
  where a.entity = 'route_stops' and a.action = 'INSERT'
  group by 1, 2, 3
  having count(*) >= 5
) ins
join public.route_names rn on rn.id = ins.route_id
left join lateral (
  select a.detail->'new'->>'plan_source' source, a.detail->'new'->>'planned_start' planned_start, a.detail->'new'->>'planned_end' planned_end, a.actor_id actor
  from public.audit_log a where a.entity = 'route_names' and a.entity_id = ins.route_id and date_trunc('hour', a.created_at) = ins.h
  order by a.created_at desc limit 1
) meta on true
where not exists (select 1 from public.route_plan_versions v where v.route_id = ins.route_id and date_trunc('hour', v.imported_at) = ins.h);
