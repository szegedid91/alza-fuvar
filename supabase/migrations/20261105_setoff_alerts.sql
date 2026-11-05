-- „Nem indult el a munkába” riasztás (2026-11-05)
-- Vezetőnként (manager / admin) és munkaterületenként beállítható szabályok: határidő (budapesti idő),
-- kikre vonatkozik, hangos vagy néma. A határidő percében az kap értesítést, akinek a szabálya szól:
-- az aznapra beosztott, de „Elindultam a munkába” jelzést nem adó (és be sem csekkolt) munkatársakról.

create table if not exists public.setoff_alert_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  deadline time not null,
  scope text not null default 'all' check (scope in ('all', 'xl', 'box1', 'box2')),
  loud boolean not null default true,
  enabled boolean not null default true,
  last_fired_on date,
  created_at timestamptz not null default now(),
  unique (user_id, workspace_id, deadline, scope)
);
comment on table public.setoff_alert_rules is 'Vezetői riasztás-szabályok: ki nem jelezte határidőig, hogy elindult a munkába.';

alter table public.setoff_alert_rules enable row level security;
revoke all on table public.setoff_alert_rules from anon, public;
grant select, insert, update, delete on table public.setoff_alert_rules to authenticated;

drop policy if exists sar_select on public.setoff_alert_rules;
create policy sar_select on public.setoff_alert_rules for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists sar_insert on public.setoff_alert_rules;
create policy sar_insert on public.setoff_alert_rules for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_manager_or_admin()) and public.can_access_workspace(workspace_id));
drop policy if exists sar_update on public.setoff_alert_rules;
create policy sar_update on public.setoff_alert_rules for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.is_manager_or_admin()) and public.can_access_workspace(workspace_id));
drop policy if exists sar_delete on public.setoff_alert_rules;
create policy sar_delete on public.setoff_alert_rules for delete to authenticated
  using (user_id = (select auth.uid()));

-- A „mikor szólt utoljára” mezőt a rendszer vezeti; a határidő / kör módosítása után aznap újra szólhat
create or replace function public.setoff_alert_rules_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- rendszerfolyamat (időzítő)
  if tg_op = 'INSERT' then
    new.last_fired_on := null;
    if (select count(*) from public.setoff_alert_rules where user_id = new.user_id and workspace_id = new.workspace_id) >= 8 then
      raise exception 'Legfeljebb 8 riasztás állítható be munkaterületenként.';
    end if;
    return new;
  end if;
  new.user_id := old.user_id;
  new.workspace_id := old.workspace_id;
  new.last_fired_on := case when new.deadline <> old.deadline or new.scope <> old.scope then null else old.last_fired_on end;
  return new;
end $$;
revoke execute on function public.setoff_alert_rules_guard() from public, anon, authenticated;
drop trigger if exists setoff_alert_rules_guard on public.setoff_alert_rules;
create trigger setoff_alert_rules_guard before insert or update on public.setoff_alert_rules
  for each row execute function public.setoff_alert_rules_guard();

-- Kik NEM jelezték még, hogy elindultak: az adott napra beosztott aktív munkatársak, akiknek aznap
-- nincs „Elindultam” jelzésük és becsekkolásuk sem (aki már becsekkolt, az ott van).
-- scope: all = mindenki; xl = nem Box-autó; box1 / box2 = Box-autó 1. / 2. köre
create or replace function public.setoff_missing(p_ws uuid, p_date date, p_scope text)
returns table (user_id uuid, full_name text, plate text, route text, round int)
language sql stable security definer set search_path = public as $$
  select distinct on (x.uid) x.uid, coalesce(nullif(p.full_name, ''), p.email, 'Munkatárs'), x.plate, x.code, x.round::int
    from (
      select u.uid, s.round, c.plate, rn.code, coalesce(cc.box_sheet, false) as is_box
        from public.shifts s
        left join public.cars c on c.id = s.car_id
        left join public.car_categories cc on cc.id = c.category_id
        left join public.route_names rn on rn.id = s.route_id
        cross join lateral unnest(array[s.driver_id, s.loader_id, s.trainee_id]) as u(uid)
       where s.workspace_id = p_ws and s.work_date = p_date and u.uid is not null
    ) x
    join public.profiles p on p.id = x.uid
   where p.status = 'active'
     and (p_scope = 'all'
          or (p_scope = 'xl' and not x.is_box)
          or (p_scope = 'box1' and x.is_box and x.round = 1)
          or (p_scope = 'box2' and x.is_box and x.round = 2))
     and not exists (select 1 from public.status_events e where e.user_id = x.uid and e.kind::text = 'set_off' and e.work_date = p_date)
     and not exists (select 1 from public.check_ins ci where ci.user_id = x.uid and ci.work_date = p_date)
   order by x.uid, x.round
$$;
revoke execute on function public.setoff_missing(uuid, date, text) from public, anon, authenticated;

-- Percenként fut: a most esedékes szabályokra (határidő óta legfeljebb 20 perc, aznap még nem szólt)
-- egy összesítő értesítést küld a szabály tulajdonosának. Néma szabálynál hang és rezgés nélkül.
create or replace function public.tick_setoff_alerts() returns void
language plpgsql security definer set search_path = public as $$
declare
  r record; v_secret text; v_n int; v_names text;
  v_local timestamp := now() at time zone 'Europe/Budapest';
  v_today date := (now() at time zone 'Europe/Budapest')::date;
begin
  select value into v_secret from public.internal_config where key = 'edge_shared_secret';
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
      select count(*), string_agg(q.label, ', ' order by q.label) filter (where q.rn <= 8)
        into v_n, v_names
        from (select m.full_name || case when m.plate is not null then ' (' || m.plate || coalesce(' · ' || m.route, '') || ')' else '' end as label,
                     row_number() over (order by m.full_name) as rn
                from public.setoff_missing(r.workspace_id, v_today, r.scope) m) q;
      if v_n > 0 then
        perform net.http_post(
          url := 'https://jmhqsfeqfghzxsyqjgjd.supabase.co/functions/v1/send-push',
          body := jsonb_build_object('user_ids', to_jsonb(array[r.user_id]),
            'title', '⏰ Nem indult el a munkába: ' || v_n || ' fő',
            'body', v_names || case when v_n > 8 then ' … és még ' || (v_n - 8) || ' fő' else '' end
                    || ' — ' || to_char(r.deadline, 'HH24:MI') || '-ig nem jelezte az indulást.',
            'url', '/attekintes', 'silent', not r.loud, 'alarm', r.loud, 'tag', 'setoff-' || r.id::text),
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-alza-secret', coalesce(v_secret, '')));
      end if;
    exception when others then null;
    end;
  end loop;
end $$;
revoke execute on function public.tick_setoff_alerts() from public, anon, authenticated;

select cron.schedule('setoff-alerts-1min', '* * * * *', 'select public.tick_setoff_alerts()');
