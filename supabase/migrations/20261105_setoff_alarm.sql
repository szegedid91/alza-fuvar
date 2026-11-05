-- „Nem indult el a munkába” — a HANGOS szabály valódi riasztás (2026-11-05)
-- A határidő percében riasztás indul, és 20 másodpercenként újra szól (hang + rezgés minden
-- alkalommal), amíg a vezető meg nem nyitja az appot — legfeljebb 30 percig. Ha közben mindenki
-- elindul, a riasztás magától leáll, és egy „rendben” értesítés váltja. A néma szabály marad egyetlen
-- hang nélküli értesítés.

create table if not exists public.setoff_alarms (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.setoff_alert_rules(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  work_date date not null,
  scope text not null,
  deadline time not null,
  fired_at timestamptz not null default now(),
  last_push_at timestamptz not null default now(),
  push_count integer not null default 1,
  missing jsonb not null default '[]'::jsonb,   -- [{id, name, plate, route, round}]
  seen_at timestamptz,        -- a vezető megnyitotta az appot → az ismétlés leáll
  dismissed_at timestamptz,   -- a vezető lezárta a riasztó-képernyőt
  ended_reason text check (ended_reason in ('resolved', 'expired')),
  unique (rule_id, work_date)
);
comment on table public.setoff_alarms is 'Futó / lezárt „nem indult el” riasztások (a hangos szabályokból).';
create index if not exists setoff_alarms_open_idx on public.setoff_alarms (user_id) where dismissed_at is null;
alter table public.setoff_alarms enable row level security;
revoke all on table public.setoff_alarms from anon, public;
grant select on table public.setoff_alarms to authenticated;
drop policy if exists sal_select on public.setoff_alarms;
create policy sal_select on public.setoff_alarms for select to authenticated using (user_id = (select auth.uid()));

-- Értesítés küldése egy vezetőnek (send-push, belső titokkal)
create or replace function public.setoff_push(p_user uuid, p_title text, p_body text, p_tag text, p_alarm boolean, p_silent boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
  select value into v_secret from public.internal_config where key = 'edge_shared_secret';
  perform net.http_post(
    url := 'https://jmhqsfeqfghzxsyqjgjd.supabase.co/functions/v1/send-push',
    body := jsonb_build_object('user_ids', to_jsonb(array[p_user]), 'title', p_title, 'body', p_body,
      'url', '/attekintes', 'silent', p_silent, 'alarm', p_alarm, 'tag', p_tag),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-alza-secret', coalesce(v_secret, '')));
end $$;
revoke execute on function public.setoff_push(uuid, text, text, text, boolean, boolean) from public, anon, authenticated;

-- A hiányzók listája szövegként (legfeljebb 8 név)
create or replace function public.setoff_missing_text(p_missing jsonb) returns text
language sql immutable set search_path = public as $$
  select coalesce(string_agg(x.label, ', ' order by x.ord) filter (where x.ord <= 8), '')
         || case when count(*) > 8 then ' … és még ' || (count(*) - 8) || ' fő' else '' end
    from (select (e.v->>'name') || case when e.v->>'plate' is not null then ' (' || (e.v->>'plate') || coalesce(' · ' || (e.v->>'route'), '') || ')' else '' end as label, e.ord
            from jsonb_array_elements(coalesce(p_missing, '[]'::jsonb)) with ordinality as e(v, ord)) x
$$;
revoke execute on function public.setoff_missing_text(jsonb) from public, anon, authenticated;

-- Percenként: a most esedékes szabályok. Hangos → riasztás indul (és ismétlődik); néma → egy értesítés.
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
          on conflict (rule_id, work_date) do update set missing = excluded.missing, fired_at = now(), last_push_at = now(), push_count = 1,
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

-- 20 másodpercenként: a még meg nem nyitott riasztások újraküldése
create or replace function public.tick_setoff_alarm_repeat() returns void
language plpgsql security definer set search_path = public as $$
declare a record; v_n int; v_missing jsonb;
begin
  for a in
    select al.id, al.rule_id, al.user_id, al.workspace_id, al.work_date, al.scope, al.deadline, al.fired_at, al.last_push_at,
           coalesce(ru.enabled and ru.loud, false) as rule_on
      from public.setoff_alarms al
      left join public.setoff_alert_rules ru on ru.id = al.rule_id
     where al.seen_at is null and al.dismissed_at is null and al.ended_reason is null
  loop
    begin
      if a.fired_at < now() - interval '30 minutes' or not a.rule_on then
        update public.setoff_alarms set ended_reason = 'expired' where id = a.id;
        continue;
      end if;
      if a.last_push_at > now() - interval '15 seconds' then continue; end if;
      select count(*), coalesce(jsonb_agg(jsonb_build_object('id', m.user_id, 'name', m.full_name, 'plate', m.plate, 'route', m.route, 'round', m.round) order by m.full_name), '[]'::jsonb)
        into v_n, v_missing
        from public.setoff_missing(a.workspace_id, a.work_date, a.scope) m;
      if v_n = 0 then
        -- közben mindenki elindult: a riasztás leáll, a riasztó értesítést egy megnyugtató váltja
        update public.setoff_alarms set ended_reason = 'resolved', missing = '[]'::jsonb where id = a.id;
        perform public.setoff_push(a.user_id, '✅ Rendben — mindenki elindult',
          'A ' || to_char(a.deadline, 'HH24:MI') || '-kor hiányzó munkatársak azóta jelezték az indulást.', 'setoff-' || a.rule_id::text, false, false);
      else
        update public.setoff_alarms set last_push_at = now(), push_count = push_count + 1, missing = v_missing where id = a.id;
        perform public.setoff_push(a.user_id, '🚨 RIASZTÁS — nem indult el: ' || v_n || ' fő',
          public.setoff_missing_text(v_missing) || ' — ' || to_char(a.deadline, 'HH24:MI') || '-ig nem jelezte az indulást. Nyisd meg az appot a leállításhoz.',
          'setoff-' || a.rule_id::text, true, false);
      end if;
    exception when others then null;
    end;
  end loop;
end $$;
revoke execute on function public.tick_setoff_alarm_repeat() from public, anon, authenticated;

-- A vezető megnyitotta az appot: az ismétlés leáll (a riasztó-képernyő még látszik)
create or replace function public.setoff_alarms_seen() returns integer
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update public.setoff_alarms set seen_at = now() where user_id = auth.uid() and seen_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.setoff_alarms_seen() from public, anon;
grant execute on function public.setoff_alarms_seen() to authenticated;

-- A vezető lezárta a riasztó-képernyőt
create or replace function public.setoff_alarms_dismiss() returns integer
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update public.setoff_alarms set dismissed_at = now(), seen_at = coalesce(seen_at, now()) where user_id = auth.uid() and dismissed_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.setoff_alarms_dismiss() from public, anon;
grant execute on function public.setoff_alarms_dismiss() to authenticated;

select cron.schedule('setoff-alarm-repeat', '20 seconds', 'select public.tick_setoff_alarm_repeat()');
