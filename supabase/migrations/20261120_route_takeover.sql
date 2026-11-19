-- Járat átvétele és járatváltás menet közben.
-- Alapelv: a járat haladása (hol tart, mely boxok vannak kész) a JÁRATÉ, nem az autóé vagy az emberé —
-- aki a járatot viszi tovább (másik ember ugyanazon az autón, másik autó, vagy a vezető átírja a beosztást),
-- ugyanonnan folytatja.

-- Ki, mikor, kitől, hol tartva vette át (napló a vezetőnek, a bérhez és az adatlaphoz)
create table if not exists public.route_handovers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  work_date date not null,
  route_id uuid not null references public.route_names(id) on delete cascade,
  round smallint not null,
  from_user uuid references public.profiles(id) on delete set null,
  to_user uuid not null references public.profiles(id) on delete cascade,
  from_car uuid references public.cars(id) on delete set null,
  to_car uuid references public.cars(id) on delete set null,
  stop_index integer,
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists route_handovers_ws_date_idx on public.route_handovers (workspace_id, work_date);
create index if not exists route_handovers_users_idx on public.route_handovers (to_user, work_date);
alter table public.route_handovers enable row level security;
revoke all on table public.route_handovers from anon;
grant select on table public.route_handovers to authenticated;
drop policy if exists rh_select on public.route_handovers;
create policy rh_select on public.route_handovers for select
  using (public.can_access_workspace(workspace_id)
         and ((select public.is_manager_or_admin()) or to_user = (select auth.uid()) or from_user = (select auth.uid())));

-- A járat haladásának átvitele arra az autóra, amelyik most viszi (a legelőrébb tartó futás számít)
create or replace function public.move_route_progress(p_date date, p_route uuid, p_round integer, p_car uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_from uuid; v_run uuid;
begin
  if p_route is null or p_car is null then return; end if;
  if exists (select 1 from public.route_runs where work_date = p_date and route_id = p_route and round = p_round and car_id = p_car) then return; end if;
  select id, car_id into v_run, v_from from public.route_runs
   where work_date = p_date and route_id = p_route and round = p_round and car_id <> p_car
   order by current_index desc, updated_at desc limit 1;
  if v_run is null then return; end if;
  update public.route_runs set car_id = p_car where id = v_run;
  update public.route_stop_logs l set car_id = p_car
   where l.work_date = p_date and l.route_id = p_route and l.round = p_round and l.car_id = v_from
     and not exists (select 1 from public.route_stop_logs l2 where l2.work_date = l.work_date and l2.route_id = l.route_id
                      and l2.round = l.round and l2.car_id = p_car and l2.stop_index = l.stop_index);
end $$;
revoke all on function public.move_route_progress(date, uuid, integer, uuid) from public, anon, authenticated;

-- Ha egy (mai / tegnapi / holnapi) beosztás járata vagy autója változik — a vezető írja át a táblában, a futár autót
-- vált vagy járatot vesz át —, a haladás követi. Régebbi és távoli jövőbeli napokhoz nem nyúl (pl. hét másolása).
create or replace function public.shift_route_progress_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.route_id is null or new.work_date not between public.work_day_now() - 1 and public.work_day_now() + 1 then return new; end if;
  if tg_op = 'INSERT' or new.route_id is distinct from old.route_id or new.car_id is distinct from old.car_id or new.round is distinct from old.round then
    perform public.move_route_progress(new.work_date, new.route_id, new.round, new.car_id);
  end if;
  return new;
end $$;
revoke all on function public.shift_route_progress_follow() from public, anon, authenticated;
drop trigger if exists shifts_zz_progress_follow on public.shifts;
create trigger shifts_zz_progress_follow after insert or update of route_id, car_id, round on public.shifts
  for each row execute function public.shift_route_progress_follow();

-- A becsekkolt futár mai napja és autója (a nyitott becsekkolás szerint)
create or replace function public.my_open_checkin(out o_ws uuid, out o_car uuid, out o_day date)
language sql stable security definer set search_path = public as $$
  select ci.workspace_id, ci.car_id, ci.work_date from public.check_ins ci
   where ci.user_id = auth.uid() and ci.checked_out_at is null and ci.work_date >= public.work_day_now() - 1
   order by ci.checked_in_at desc limit 1
$$;
revoke all on function public.my_open_checkin() from public, anon, authenticated;

-- Mely járatokat lehet most átvenni: a mai, járattal rendelkező beosztások (a sajátjaim nélkül) és a gazda nélkül
-- maradt, már elkezdett járatok. A futár a többiek beosztását közvetlenül nem látja, ezért függvény adja vissza.
create or replace function public.takeover_candidates()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ws uuid; v_car uuid; v_day date; v_uid uuid := auth.uid(); v jsonb;
begin
  if v_uid is null or not public.is_active() then raise exception 'Nincs jogosultság'; end if;
  select o_ws, o_car, o_day into v_ws, v_car, v_day from public.my_open_checkin();
  if v_car is null then return jsonb_build_object('checked_in', false, 'routes', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(x order by (x->>'same_car')::boolean desc, x->>'code', (x->>'round')::int), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'route_id', r.id, 'code', r.code, 'round', q.round, 'car_id', q.car_id, 'plate', c.plate, 'same_car', q.car_id = v_car,
      'holder', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = q.holder),
      'current_index', coalesce(q.idx, 0),
      'total', (select count(*) from public.route_stops rs where rs.route_id = r.id)) as x
    from (
      select s.route_id, s.round, s.car_id, coalesce(s.driver_id, s.loader_id) as holder,
             (select max(rr.current_index) from public.route_runs rr where rr.work_date = v_day and rr.route_id = s.route_id and rr.round = s.round) as idx
        from public.shifts s
       where s.workspace_id = v_ws and s.work_date = v_day and s.route_id is not null
         and v_uid not in (coalesce(s.driver_id, '00000000-0000-0000-0000-000000000000'), coalesce(s.loader_id, '00000000-0000-0000-0000-000000000000'), coalesce(s.trainee_id, '00000000-0000-0000-0000-000000000000'))
      union all
      -- gazda nélküli, de már elkezdett járat (pl. a korábbi gazdája másik járatot vett át)
      select rr.route_id, rr.round, rr.car_id, null::uuid, rr.current_index
        from public.route_runs rr
       where rr.workspace_id = v_ws and rr.work_date = v_day
         and not exists (select 1 from public.shifts s where s.work_date = v_day and s.route_id = rr.route_id and s.round = rr.round)
    ) q
    join public.route_names r on r.id = q.route_id
    left join public.cars c on c.id = q.car_id
  ) t;
  return jsonb_build_object('checked_in', true, 'car_id', v_car, 'day', v_day, 'routes', v);
end $$;
revoke all on function public.takeover_candidates() from public, anon;
grant execute on function public.takeover_candidates() to authenticated;

-- Járat átvétele: a hívó (becsekkolt futár) viszi tovább a járatot a saját mostani autóján, onnan, ahol tart.
create or replace function public.take_over_route(p_route_id uuid, p_round integer, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_ws uuid; v_car uuid; v_day date;
  v_s public.shifts; v_mine public.shifts; v_code text; v_who text; v_from_user uuid; v_from_car uuid; v_from_name text;
  v_idx integer; v_left text; v_secret text; v_users uuid[]; v_plate text;
begin
  if v_uid is null or not public.is_active() then raise exception 'Nincs jogosultság'; end if;
  select o_ws, o_car, o_day into v_ws, v_car, v_day from public.my_open_checkin();
  if v_car is null then raise exception 'Előbb csekkolj be egy autóra, utána vehetsz át járatot.'; end if;
  if p_round not in (1, 2) then raise exception 'Érvénytelen kör'; end if;
  select code into v_code from public.route_names where id = p_route_id and workspace_id = v_ws;
  if v_code is null then raise exception 'Ismeretlen járat'; end if;
  select plate into v_plate from public.cars where id = v_car;
  select coalesce(nullif(full_name, ''), email, 'Munkatárs') into v_who from public.profiles where id = v_uid;

  -- ki viszi most (egy járatot egy körben egy autó vihet)
  select * into v_s from public.shifts where work_date = v_day and route_id = p_route_id and round = p_round limit 1;
  if v_s.id is not null and v_uid in (v_s.driver_id, v_s.loader_id, v_s.trainee_id) then
    raise exception 'Ez a járat már a tiéd.';
  end if;
  v_from_user := coalesce(v_s.driver_id, v_s.loader_id);
  v_from_car := coalesce(v_s.car_id, (select rr.car_id from public.route_runs rr where rr.work_date = v_day and rr.route_id = p_route_id and rr.round = p_round order by rr.current_index desc limit 1));

  if v_s.id is not null and v_s.car_id = v_car then
    -- ugyanaz az autó: a hívó lesz a sofőr, az eddigi lekerül a járatról
    update public.shifts set driver_id = v_uid,
           loader_id = case when loader_id = v_from_user then null else loader_id end
     where id = v_s.id;
  else
    select * into v_mine from public.shifts where work_date = v_day and car_id = v_car and round = p_round limit 1;
    if v_mine.id is not null and v_uid not in (coalesce(v_mine.driver_id, '00000000-0000-0000-0000-000000000000'), coalesce(v_mine.loader_id, '00000000-0000-0000-0000-000000000000'), coalesce(v_mine.trainee_id, '00000000-0000-0000-0000-000000000000')) then
      raise exception 'A(z) % autón ebben a körben már más van beosztva — szólj a vezetőnek.', v_plate;
    end if;
    -- az eddigi gazda elengedi a járatot (különben a „egy járat egy autó” szabály megakasztaná)
    if v_s.id is not null then update public.shifts set route_id = null where id = v_s.id; end if;
    if v_mine.id is not null then
      if v_mine.route_id is not null and v_mine.route_id <> p_route_id then
        select code into v_left from public.route_names where id = v_mine.route_id;
        -- egy autó egy körben egy járatot vihet: ha a sajátját már BEFEJEZTE, a beosztása őrzi, hogy ő vitte —
        -- azt nem írjuk felül egy másik járattal (a vezető tudja rendezni: másik kör vagy mentesítő járat)
        if exists (select 1 from public.route_runs rr where rr.work_date = v_day and rr.route_id = v_mine.route_id and rr.round = p_round and rr.car_id = v_car
                     and rr.current_index >= (select count(*) from public.route_stops rs where rs.route_id = v_mine.route_id)
                     and (select count(*) from public.route_stops rs where rs.route_id = v_mine.route_id) > 0) then
          raise exception 'Ebben a körben már befejezted a(z) % járatot, ezért másikat nem vehetsz a nevedre. Szólj a vezetőnek — ő át tudja írni a beosztást.', v_left;
        end if;
      end if;
      update public.shifts set route_id = p_route_id where id = v_mine.id; -- a haladást a beosztás-trigger hozza át
    else
      insert into public.shifts (workspace_id, work_date, car_id, round, driver_id, route_id, created_by)
      values (v_ws, v_day, v_car, p_round, v_uid, p_route_id, v_uid);
    end if;
  end if;
  perform public.move_route_progress(v_day, p_route_id, p_round, v_car);
  select current_index into v_idx from public.route_runs where work_date = v_day and route_id = p_route_id and round = p_round and car_id = v_car;

  insert into public.route_handovers (workspace_id, work_date, route_id, round, from_user, to_user, from_car, to_car, stop_index, reason)
  values (v_ws, v_day, p_route_id, p_round, v_from_user, v_uid, v_from_car, v_car, v_idx, nullif(btrim(left(coalesce(p_reason, ''), 200)), ''));

  -- az átvevő már úton van: a „Kiindultam” megvan, azonnal töltheti a következő boxot (a megjegyzés jelzi, hogy ez
  -- nem valódi indulás — a pontossági kimutatás kihagyja)
  if not exists (select 1 from public.status_events e where e.user_id = v_uid and e.work_date = v_day and e.kind::text = 'departed'
                   and e.at > now() - interval '18 hours' and not exists (select 1 from public.status_events d where d.user_id = v_uid and d.work_date = v_day and d.kind::text = 'done' and d.at > e.at)) then
    insert into public.status_events (workspace_id, user_id, car_id, work_date, kind, at, note)
    values (v_ws, v_uid, v_car, v_day, 'departed', now(), 'Átvett járat: ' || v_code);
  end if;

  select coalesce(nullif(full_name, ''), email) into v_from_name from public.profiles where id = v_from_user;
  begin
    select value into v_secret from public.internal_config where key = 'edge_shared_secret';
    v_users := array_remove(public.workspace_leaders(v_ws), v_uid);
    if v_users is not null and array_length(v_users, 1) > 0 then
      perform net.http_post(
        url := 'https://jmhqsfeqfghzxsyqjgjd.supabase.co/functions/v1/send-push',
        body := jsonb_build_object('user_ids', to_jsonb(v_users),
          'title', '🔁 Járat átvéve: ' || v_code || ' (' || p_round || '. kör)',
          'body', left(v_who || ' viszi tovább' || coalesce(' ' || v_from_name || ' helyett', '') || ' a(z) ' || v_plate || ' autón, a(z) ' || (coalesce(v_idx, 0) + 1) || '. boxtól'
                  || coalesce('. Gazda nélkül maradt: ' || v_left || ' járat', '') || coalesce(' — ' || nullif(btrim(p_reason), ''), ''), 200),
          'url', '/attekintes'),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-alza-secret', coalesce(v_secret, '')));
    end if;
  exception when others then null; -- az értesítés hibája ne akassza meg az átvételt
  end;
  return jsonb_build_object('code', v_code, 'round', p_round, 'current_index', coalesce(v_idx, 0), 'from', v_from_name, 'left', v_left);
end $$;
revoke all on function public.take_over_route(uuid, integer, text) from public, anon;
grant execute on function public.take_over_route(uuid, integer, text) to authenticated;
