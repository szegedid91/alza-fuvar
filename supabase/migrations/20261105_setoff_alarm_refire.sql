-- „Nem indult el” riasztás — ugyanaz a szabály aznap újra elsül (2026-11-05)
-- Ha a vezető aznap átírja a szabály határidejét vagy körét, a szabály újra szólhat. A riasztás sora
-- (szabály + nap) ilyenkor újrahasznosul — de eddig a régi határidő és kör maradt benne (az ismétlődő
-- értesítések a régi időpontot írták), és a hívásszámláló sem nullázódott. Most minden mező frissül.

create or replace function public.tick_setoff_alerts() returns void
language plpgsql security definer set search_path = public as $$
declare
  r record; v_n int; v_missing jsonb;
  v_local timestamp := now() at time zone 'Europe/Budapest';
  v_today date := (now() at time zone 'Europe/Budapest')::date;
begin
  for r in
    select a.id, a.user_id, a.workspace_id, a.deadline, a.scope, a.loud
      from public.setoff_alert_rules a
      join public.profiles p on p.id = a.user_id
     where a.enabled
       and (a.last_fired_on is null or a.last_fired_on < v_today)
       and v_local >= v_today + a.deadline
       and v_local < v_today + a.deadline + interval '20 minutes'
       and p.status = 'active' and p.role in ('manager', 'admin')
       and (p.role = 'admin' or p.workspace_id = a.workspace_id
            or exists (select 1 from public.manager_workspaces m where m.manager_id = a.user_id and m.workspace_id = a.workspace_id))
  loop
    begin
      update public.setoff_alert_rules set last_fired_on = v_today where id = r.id;
      select count(*), coalesce(jsonb_agg(jsonb_build_object('id', m.user_id, 'name', m.full_name, 'plate', m.plate, 'route', m.route, 'round', m.round) order by m.full_name), '[]'::jsonb)
        into v_n, v_missing
        from public.setoff_missing(r.workspace_id, v_today, r.scope) m;
      if v_n > 0 then
        if r.loud then
          insert into public.setoff_alarms (rule_id, user_id, workspace_id, work_date, scope, deadline, missing)
          values (r.id, r.user_id, r.workspace_id, v_today, r.scope, r.deadline, v_missing)
          on conflict (rule_id, work_date) do update set
            user_id = excluded.user_id, workspace_id = excluded.workspace_id,
            scope = excluded.scope, deadline = excluded.deadline, missing = excluded.missing,
            fired_at = now(), last_push_at = now(), push_count = 1,
            call_count = 0, last_call_at = null, call_token = null,
            seen_at = null, dismissed_at = null, ended_reason = null;
          perform public.setoff_push(r.user_id, '🚨 RIASZTÁS — nem indult el: ' || v_n || ' fő',
            public.setoff_missing_text(v_missing) || ' — ' || to_char(r.deadline, 'HH24:MI') || '-ig nem jelezte az indulást. Nyisd meg az appot a leállításhoz.',
            'setoff-' || r.id::text, true, false);
        else
          perform public.setoff_push(r.user_id, '⏰ Nem indult el a munkába: ' || v_n || ' fő',
            public.setoff_missing_text(v_missing) || ' — ' || to_char(r.deadline, 'HH24:MI') || '-ig nem jelezte az indulást.',
            'setoff-' || r.id::text, false, true);
        end if;
      end if;
    exception when others then null;
    end;
  end loop;
end $$;
revoke execute on function public.tick_setoff_alerts() from public, anon, authenticated;
