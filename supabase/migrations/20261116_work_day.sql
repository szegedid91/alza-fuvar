-- MUNKANAP a szerveren: az este induló 1. kör és a másnap reggeli 2. kör a REGGEL napjához tartozik
-- (hétfő este + kedd reggel = keddi beosztás). A munkanap este 18:00-kor vált a következő napra.
-- A kliens ettől kezdve este 18:00 után a HOLNAPI napra csekkol be és jelez — ehhez a szerver szabályai is igazodnak.

create or replace function public.work_day_now()
returns date language sql stable set search_path = public as $$
  select ((now() at time zone 'Europe/Budapest') + interval '6 hours')::date
$$;
grant execute on function public.work_day_now() to authenticated;

-- 1) Becsekkolás: a futár a naptári holnapra is becsekkolhat (este, az 1. körre) — eddig csak tegnap / ma
alter policy ci_insert on public.check_ins
  with check (
    public.can_access_workspace(workspace_id) and user_id = (select auth.uid()) and (select public.is_active())
    and ((select public.is_manager_or_admin())
         or (work_date >= ((now() at time zone 'Europe/Budapest')::date - 1) and work_date <= ((now() at time zone 'Europe/Budapest')::date + 1)))
  );

-- 2) Saját jelzés visszavonása: a mai és a (már megkezdett) holnapi munkanapra
alter policy se_delete on public.status_events
  using (
    public.can_access_workspace(workspace_id)
    and ((user_id = (select auth.uid())
          and work_date >= (now() at time zone 'Europe/Budapest')::date and work_date <= ((now() at time zone 'Europe/Budapest')::date + 1))
         or (select public.is_manager_or_admin()))
  );

-- 3) A naptári napra kötött függvények a munkanapra váltanak. A meglévő törzset módosítjuk célzottan
--    (nem írjuk újra kézzel): ha a keresett részlet nincs meg, a migráció hibával megáll.
do $$
declare
  v_src text; v_new text;
  v_cal constant text := '(now() at time zone ''Europe/Budapest'')::date';
begin
  -- a) autócsere: a beosztás követi a futárt — annak a napnak a beosztása, amire az új autóra becsekkolt
  select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'follow_shift_to_car';
  v_new := replace(v_src, 'sh.work_date = ' || v_cal,
    'sh.work_date = coalesce((select ci.work_date from public.check_ins ci where ci.user_id = v_uid and ci.car_id = p_car_id and ci.checked_out_at is null order by ci.checked_in_at desc limit 1), public.work_day_now())');
  if v_new = v_src then raise exception 'follow_shift_to_car: a dátum-feltétel nem található'; end if;
  execute v_new;

  -- b) ellenőrzés-emlékeztetők: a mai ÉS a már megkezdett holnapi munkanap
  select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tick_inspection_reminders';
  v_new := replace(v_src, 'and work_date = ' || v_cal, 'and work_date >= ' || v_cal);
  if v_new = v_src then raise exception 'tick_inspection_reminders: a dátum-feltétel nem található'; end if;
  execute v_new;

  -- c) „fotó nélkül csekkolt be” figyelmeztetés: ugyanígy
  select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tick_photo_missing_alerts';
  v_new := replace(v_src, 'where c.work_date = ' || v_cal, 'where c.work_date >= ' || v_cal);
  v_new := replace(v_new, 'ir.work_date = ' || v_cal, 'ir.work_date >= ' || v_cal);
  if v_new = v_src then raise exception 'tick_photo_missing_alerts: a dátum-feltétel nem található'; end if;
  execute v_new;

  -- d) tesztnap újraindítása: a munkanapra
  select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'test_day_reset';
  v_new := replace(v_src, 'v_date date := ' || v_cal || ';', 'v_date date := public.work_day_now();');
  if v_new = v_src then raise exception 'test_day_reset: a dátum-sor nem található'; end if;
  execute v_new;
end $$;
