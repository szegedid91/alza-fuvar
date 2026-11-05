-- Audit 2. fázis — adatbázis-oldali javítások (AUDIT.md: SEC-02, 05, 06, 07, 08, 09, 10, 12, 13, 25; LOG-15, 16, 18, 46)
-- Alkalmazva 2026-11-05-én a Supabase projektre (jmhqsfeqfghzxsyqjgjd), egy lépésben (a migráció-futtató egy tranzakcióban viszi).

-- ---------------------------------------------------------------------------
-- SEC-12 + SEC-05: manager nem módosíthat managert; az email az auth-fiókhoz kötött
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new; -- service role / rendszerfolyamat (meghívó beváltása, helyőrző)
  end if;
  -- SEC-05: a profil emailje az auth-fiók emailje — kliensről nem írható át
  if new.email is distinct from old.email and not public.is_admin() then
    raise exception 'Az email-cím nem módosítható itt';
  end if;
  if (new.role is distinct from old.role
      or new.status is distinct from old.status
      or new.workspace_id is distinct from old.workspace_id
      or new.pay_type is distinct from old.pay_type
      or new.pay_amount is distinct from old.pay_amount
      or new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at) then
    if not public.is_manager_or_admin() then
      raise exception 'Nincs jogosultság a profil érzékeny mezőinek módosításához';
    end if;
    if not public.is_admin() then
      -- SEC-12: vezető (manager/admin) profilját csak admin módosíthatja
      if old.role in ('admin'::user_role, 'manager'::user_role) then
        raise exception 'Vezető profilját csak admin módosíthatja';
      end if;
      if new.role = 'admin'::user_role then
        raise exception 'Admin szerepet csak admin adhat';
      end if;
      if new.pay_type is distinct from old.pay_type
         or new.pay_amount is distinct from old.pay_amount then
        raise exception 'Bért csak admin állíthat';
      end if;
      if new.workspace_id is distinct from old.workspace_id
         and new.workspace_id is not null
         and new.workspace_id not in (select public.user_workspace_ids()) then
        raise exception 'Csak a saját munkaterületedre oszthatsz be felhasználót';
      end if;
    end if;
  end if;
  return new;
end $$;

create or replace function public.set_user_role(target_id uuid, p_role user_role) returns void
language plpgsql security definer set search_path = public as $$
declare v_target public.profiles;
begin
  if not public.is_manager_or_admin() then raise exception 'Nincs jogosultság'; end if;
  select * into v_target from public.profiles where id = target_id;
  if v_target.id is null then raise exception 'A felhasználó nem található'; end if;
  if target_id = auth.uid() then raise exception 'A saját szerepedet nem módosíthatod'; end if;
  if not public.is_admin() then
    if v_target.workspace_id is null or v_target.workspace_id not in (select public.user_workspace_ids()) then raise exception 'Csak a saját munkaterületed tagjának szerepét módosíthatod'; end if;
    -- SEC-12: manager csak munkatárs (crew) szerepét állíthatja, és nem adhat admin szerepet
    if v_target.role in ('admin', 'manager') or p_role = 'admin' then raise exception 'Vezető szerepét csak admin módosíthatja'; end if;
  end if;
  update public.profiles set role = p_role where id = target_id;
end $$;

create or replace function public.set_user_status(target_id uuid, p_status user_status) returns void
language plpgsql security definer set search_path = public as $$
declare v_target public.profiles;
begin
  if not public.is_manager_or_admin() then raise exception 'Nincs jogosultság'; end if;
  select * into v_target from public.profiles where id = target_id;
  if v_target.id is null then raise exception 'A felhasználó nem található'; end if;
  if target_id = auth.uid() then raise exception 'A saját állapotodat nem módosíthatod'; end if;
  if not public.is_admin() then
    if v_target.workspace_id is null or v_target.workspace_id not in (select public.user_workspace_ids()) then raise exception 'Nincs jogosultság ehhez a felhasználóhoz'; end if;
    -- SEC-12: vezető állapotát csak admin módosíthatja
    if v_target.role in ('admin', 'manager') then raise exception 'Vezető állapotát csak admin módosíthatja'; end if;
  end if;
  update public.profiles set status = p_status where id = target_id;
end $$;

-- ---------------------------------------------------------------------------
-- SEC-06: mentesítő járat — minden átkerülő megálló a saját munkaterületből
-- ---------------------------------------------------------------------------
create or replace function public.create_relief_route(p_code text, p_stops jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_ws uuid; v_id uuid; r jsonb; i int := 0; v_route uuid; v_n int;
begin
  if not public.is_manager_or_admin() then raise exception 'Nincs jogosultság'; end if;
  select s.workspace_id into v_ws from public.route_stops s where s.id = (p_stops->0->>'stop_id')::uuid;
  if v_ws is null or not public.can_access_workspace(v_ws) then raise exception 'Nincs jogosultság'; end if;
  -- SEC-06: MINDEN megálló ugyanebből a munkaterületből (idegen azonosító → hiba)
  if exists (
    select 1 from jsonb_array_elements(p_stops) x
    left join public.route_stops s on s.id = (x->>'stop_id')::uuid
    where s.id is null or s.workspace_id <> v_ws
  ) then raise exception 'Ismeretlen vagy idegen megálló a listában'; end if;
  insert into public.route_names (workspace_id, code, sort_order, is_relief)
  values (v_ws, upper(p_code), (select coalesce(max(sort_order), 0) + 1 from public.route_names where workspace_id = v_ws), true)
  returning id into v_id;
  for r in select * from jsonb_array_elements(p_stops) loop
    i := i + 1;
    insert into public.route_stops (workspace_id, route_id, box_id, sort_order, moved_from_route_id, moved_from_order, eta, etd, deadline)
    select v_ws, v_id, s.box_id, i, coalesce(s.moved_from_route_id, s.route_id), coalesce(s.moved_from_order, s.sort_order), s.eta, s.etd, s.deadline
      from public.route_stops s where s.id = (r->>'stop_id')::uuid;
    delete from public.route_stops where id = (r->>'stop_id')::uuid;
  end loop;
  -- újrasorszámozás az érintett járatokon — csak a saját munkaterület járatain
  for v_route in select distinct (x->>'from_route_id')::uuid from jsonb_array_elements(p_stops) x
                  where exists (select 1 from public.route_names rn where rn.id = (x->>'from_route_id')::uuid and rn.workspace_id = v_ws) loop
    v_n := 0;
    update public.route_stops s set sort_order = t.rn
      from (select id, row_number() over (order by sort_order, created_at) as rn from public.route_stops where route_id = v_route) t
     where s.id = t.id and s.sort_order <> t.rn;
  end loop;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- SEC-07: cserekérés csak a saját beosztásra, a tényleges társsal, a beosztás munkaterületén
-- ---------------------------------------------------------------------------
create or replace function public.swap_request_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_last timestamptz; v_mins int; v_shift public.shifts; v_today date; v_other uuid;
begin
  select * into v_shift from public.shifts where id = new.shift_id;
  if v_shift.id is null then
    raise exception 'A beosztás nem található.';
  end if;
  -- SEC-07: tagság + munkaterület + társ
  if new.requested_by is distinct from v_shift.driver_id and new.requested_by is distinct from v_shift.loader_id then
    raise exception 'Csak a beosztás sofőrje vagy rakodója kérhet cserét.';
  end if;
  if new.workspace_id <> v_shift.workspace_id then
    raise exception 'A cserekérés munkaterülete nem egyezik a beosztáséval.';
  end if;
  v_other := case when v_shift.driver_id = new.requested_by then v_shift.loader_id else v_shift.driver_id end;
  if new.partner_id is distinct from v_other then
    raise exception 'A társ csak a beosztás másik tagja lehet.';
  end if;

  v_today := (now() at time zone 'Europe/Budapest')::date;
  if v_shift.work_date < v_today then
    raise exception 'Múltbeli beosztásra nem lehet cserét kérni.';
  end if;
  if v_shift.work_date > v_today + 7 then
    raise exception 'Cserét legfeljebb egy héttel előre lehet kérni.';
  end if;

  select max(created_at) into v_last from public.swap_requests where requested_by = new.requested_by;
  if v_last is not null and v_last > now() - interval '30 minutes' then
    v_mins := greatest(1, ceil(extract(epoch from (v_last + interval '30 minutes' - now())) / 60));
    raise exception 'Cserekérést 30 percenként lehet küldeni — próbáld újra kb. % perc múlva.', v_mins;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- SEC-08: megálló-leadás naplója csak a beosztott brigádtól (vagy vezetőtől)
-- ---------------------------------------------------------------------------
drop policy if exists rsl_insert on public.route_stop_logs;
create policy rsl_insert on public.route_stop_logs for insert to authenticated
with check (
  public.can_access_workspace(workspace_id) and user_id = (select auth.uid()) and (select public.is_active())
  and ((select public.is_manager_or_admin()) or exists (
    select 1 from public.shifts s
     where s.work_date = route_stop_logs.work_date and s.route_id = route_stop_logs.route_id
       and s.round = route_stop_logs.round and s.car_id = route_stop_logs.car_id
       and (select auth.uid()) in (s.driver_id, s.loader_id, s.trainee_id)))
);

-- ---------------------------------------------------------------------------
-- SEC-09: Box-lap fejléc — a nap/autó/tulajdonos nem írható át munkatárs által; hónap-zár a fejlécre is
-- ---------------------------------------------------------------------------
create or replace function public.guard_box_sheet_edit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_manager_or_admin() then return new; end if;
  if new.user_id <> old.user_id or new.workspace_id <> old.workspace_id
     or new.work_date <> old.work_date or new.car_id is distinct from old.car_id then
    raise exception 'A Box-lap napja, autója és tulajdonosa nem módosítható';
  end if;
  return new;
end $$;
revoke execute on function public.guard_box_sheet_edit() from public, anon;
drop trigger if exists box_sheets_guard_edit on public.box_sheets;
create trigger box_sheets_guard_edit before update on public.box_sheets for each row execute function public.guard_box_sheet_edit();
drop trigger if exists lock_box_sheets on public.box_sheets;
create trigger lock_box_sheets before insert or delete or update on public.box_sheets for each row execute function public.enforce_month_lock();

-- ---------------------------------------------------------------------------
-- SEC-10: trigger-függvények és belső RPC-k ne legyenek hívhatók az API-ból (anon / public)
-- ---------------------------------------------------------------------------
revoke execute on function public.client_errors_rate_limit() from public, anon;
revoke execute on function public.help_sessions_rate_limit() from public, anon;
revoke execute on function public.guard_check_in_edit() from public, anon;
revoke execute on function public.mark_inspection_complete() from public, anon;
revoke execute on function public.notify_help_session() from public, anon;
revoke execute on function public.create_relief_route(text, jsonb) from public, anon;
revoke execute on function public.dissolve_relief_route(uuid) from public, anon;
revoke execute on function public.replace_route_stops(uuid, jsonb, time, time, text) from public, anon;
revoke execute on function public.set_user_role(uuid, user_role) from public, anon;
-- (a többi trigger-függvény és a storage_workspace_ok már most sem hívható anon/public által;
--  a storage_workspace_ok-ot a fotótár policy-jai hívják, az authenticated joga MARAD)
-- a jövőben a postgres által létrehozott függvények se kapjanak automatikusan PUBLIC EXECUTE-ot
-- (az authenticated / service_role a séma alapértelmezett jogaiból továbbra is megkapja)
alter default privileges for role postgres revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- SEC-13: fotó-megőrzés tartománya (0 nap = minden fotó törlődne)
-- ---------------------------------------------------------------------------
alter table public.workspaces drop constraint if exists workspaces_photo_retention_days_check;
alter table public.workspaces add constraint workspaces_photo_retention_days_check check (photo_retention_days between 7 and 3650);

-- ---------------------------------------------------------------------------
-- LOG-15 + LOG-16: becsekkolás ideje — offline rögzítés megőrzése (max. 12 órával korábbi),
-- a nap újranyitása nem írja át az eredeti kezdést (autócsere utáni visszaülésnél továbbra is új szakasz indul)
-- ---------------------------------------------------------------------------
create or replace function public.guard_check_in_edit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' and old.checked_out_at is not null and new.checked_out_at is null then
    if exists (select 1 from public.check_ins c
                where c.user_id = old.user_id and c.work_date = old.work_date and c.id <> old.id
                  and c.checked_in_at > old.checked_in_at) then
      new.checked_in_at := now(); -- visszaülés autócsere után (A→B→A): új szakasz kezdődik
    else
      new.checked_in_at := old.checked_in_at; -- LOG-16: a nap újranyitása megtartja az eredeti kezdést
    end if;
  end if;
  if public.is_manager_or_admin() then return new; end if;
  if tg_op = 'INSERT' then
    -- LOG-15: az offline sorból később beérkező becsekkolás a VALÓDI idejével mentődik (legfeljebb 12 órával
    -- korábbi); jövőbeli vagy hiányzó idő helyett a mostani
    if new.checked_in_at is null or new.checked_in_at > now() + interval '5 minutes' or new.checked_in_at < now() - interval '12 hours' then new.checked_in_at := now(); end if;
    new.checked_out_at := null; new.out_gps_lat := null; new.out_gps_lng := null;
    new.inspection_alert_sent_at := null; new.inspection_crew_reminders := 0; new.inspection_crew_reminded_at := null;
    new.inspection_waived_at := null; new.inspection_waived_by := null; new.inspection_waive_note := null;
    return new;
  end if;
  if new.user_id <> old.user_id or new.workspace_id <> old.workspace_id or new.car_id <> old.car_id or new.work_date <> old.work_date then
    raise exception 'A becsekkolás autója, napja és tulajdonosa nem módosítható';
  end if;
  if new.inspection_alert_sent_at is distinct from old.inspection_alert_sent_at or new.inspection_crew_reminders <> old.inspection_crew_reminders
     or new.inspection_crew_reminded_at is distinct from old.inspection_crew_reminded_at then
    raise exception 'A rendszer-mezőket a futár nem módosíthatja';
  end if;
  -- a kezdés idejét a futár nem írhatja át (újranyitáskor a fenti szabály állítja be)
  if new.checked_in_at is distinct from old.checked_in_at and not (old.checked_out_at is not null and new.checked_out_at is null) then
    raise exception 'A becsekkolás ideje nem módosítható';
  end if;
  if new.checked_out_at is not null and new.checked_out_at is distinct from old.checked_out_at
     and (new.checked_out_at < new.checked_in_at or new.checked_out_at > now() + interval '5 minutes' or old.checked_out_at is not null) then
    raise exception 'A kijelentkezés ideje csak egyszer, a mostani időponttal rögzíthető';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- LOG-18: betanuló jelenléte az autón — a munkatárs nem látja a társ beosztás-sorát, ezért RPC
-- ---------------------------------------------------------------------------
create or replace function public.trainee_scheduled(p_car_id uuid, p_date date) returns boolean
language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.shifts s join public.cars c on c.id = s.car_id
     where s.car_id = p_car_id and s.work_date = p_date and s.trainee_id is not null
       and (select public.is_active()) and public.can_access_workspace(c.workspace_id)
  )
$$;
revoke execute on function public.trainee_scheduled(uuid, date) from public, anon;
grant execute on function public.trainee_scheduled(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- LOG-46: járat-késés riasztás megszüntetése (döntés: egyik körben sem kell)
-- ---------------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'route-late-alerts-5min';
drop function if exists public.tick_route_late_alerts();
drop table if exists public.route_late_alerts;

-- ---------------------------------------------------------------------------
-- SEC-02: a segítségkérő broadcast csatorna privát — csak a munkaterület tagjai csatlakozhatnak
-- (a kliens `private: true`-val nyitja a `help:{session_id}` csatornát)
-- ---------------------------------------------------------------------------
-- (a realtime.messages táblán az RLS alapból be van kapcsolva; a tábla a supabase_realtime_admin-é)
drop policy if exists help_channel_read on realtime.messages;
create policy help_channel_read on realtime.messages for select to authenticated
using (
  realtime.topic() like 'help:%' and exists (
    select 1 from public.help_sessions h
     where 'help:' || h.id::text = realtime.topic() and public.can_access_workspace(h.workspace_id)
       and (h.user_id = (select auth.uid()) or (select public.is_manager_or_admin()))
  )
);
drop policy if exists help_channel_write on realtime.messages;
create policy help_channel_write on realtime.messages for insert to authenticated
with check (
  realtime.topic() like 'help:%' and exists (
    select 1 from public.help_sessions h
     where 'help:' || h.id::text = realtime.topic() and public.can_access_workspace(h.workspace_id)
       and (h.user_id = (select auth.uid()) or (select public.is_manager_or_admin()))
  )
);

-- ---------------------------------------------------------------------------
-- SEC-25: a képolvasás napi számlálóinak takarítása (a mai nap előttiek)
-- ---------------------------------------------------------------------------
select cron.schedule('read-box-photo-counters-cleanup', '20 4 * * *',
  $$delete from public.internal_config where key like 'rbp:%' and split_part(key, ':', 3) < to_char((now() at time zone 'Europe/Budapest')::date, 'YYYY-MM-DD')$$);

