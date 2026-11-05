-- „Nem indult el” riasztás — telefonhívás a vezetőnek (2026-11-05)
-- A hangos szabályhoz kérhető hívás is: ha a riasztást 1 percen belül nem nyitják meg, a rendszer
-- felhívja a vezetőt (felolvassa, kik hiányoznak; az 1-es gombbal leállítható), és 5 percenként
-- még kétszer próbálkozik. A hívást az `alarm-call` edge function indítja a telefonos szolgáltatón át.

alter table public.setoff_alert_rules add column if not exists call boolean not null default false;
comment on column public.setoff_alert_rules.call is 'Hangos szabálynál: telefonhívás is menjen a vezetőnek, ha nem nyitja meg a riasztást.';

alter table public.setoff_alarms add column if not exists call_count integer not null default 0;
alter table public.setoff_alarms add column if not exists last_call_at timestamptz;
alter table public.setoff_alarms add column if not exists call_token text;

-- Hívásnapló (költség és visszaélés követése; a próbahívások korlátozása is ebből számol)
create table if not exists public.alarm_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  alarm_id uuid references public.setoff_alarms(id) on delete set null,
  kind text not null check (kind in ('alarm', 'test')),
  to_masked text,
  status text not null,
  sid text,
  error text,
  created_at timestamptz not null default now()
);
comment on table public.alarm_calls is 'A riasztás-hívások naplója (kinek, mikor, sikerült-e elindítani).';
create index if not exists alarm_calls_user_idx on public.alarm_calls (user_id, created_at desc);
alter table public.alarm_calls enable row level security;
revoke all on table public.alarm_calls from anon, public;
grant select on table public.alarm_calls to authenticated;
drop policy if exists acl_select on public.alarm_calls;
create policy acl_select on public.alarm_calls for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- 20 másodpercenként: a még meg nem nyitott riasztások — újraküldés és (ha kérték) telefonhívás
create or replace function public.tick_setoff_alarm_repeat() returns void
language plpgsql security definer set search_path = public as $$
declare a record; v_n int; v_missing jsonb; v_secret text;
begin
  for a in
    select al.id, al.rule_id, al.user_id, al.workspace_id, al.work_date, al.scope, al.deadline, al.fired_at, al.last_push_at,
           al.call_count, al.last_call_at,
           coalesce(ru.enabled and ru.loud, false) as rule_on, coalesce(ru.call, false) as rule_call
      from public.setoff_alarms al
      left join public.setoff_alert_rules ru on ru.id = al.rule_id
     where al.seen_at is null and al.dismissed_at is null and al.ended_reason is null
  loop
    begin
      if a.fired_at < now() - interval '30 minutes' or not a.rule_on then
        update public.setoff_alarms set ended_reason = 'expired' where id = a.id;
        continue;
      end if;
      select count(*), coalesce(jsonb_agg(jsonb_build_object('id', m.user_id, 'name', m.full_name, 'plate', m.plate, 'route', m.route, 'round', m.round) order by m.full_name), '[]'::jsonb)
        into v_n, v_missing
        from public.setoff_missing(a.workspace_id, a.work_date, a.scope) m;
      if v_n = 0 then
        -- közben mindenki elindult: a riasztás leáll, a riasztó értesítést egy megnyugtató váltja
        update public.setoff_alarms set ended_reason = 'resolved', missing = '[]'::jsonb where id = a.id;
        perform public.setoff_push(a.user_id, '✅ Rendben — mindenki elindult',
          'A ' || to_char(a.deadline, 'HH24:MI') || '-kor hiányzó munkatársak azóta jelezték az indulást.', 'setoff-' || a.rule_id::text, false, false);
        continue;
      end if;

      -- telefonhívás: az első a riasztás után 1 perccel, aztán 5 percenként, összesen legfeljebb 3
      if a.rule_call and ((a.call_count = 0 and a.fired_at <= now() - interval '60 seconds')
                          or (a.call_count between 1 and 2 and a.last_call_at <= now() - interval '5 minutes')) then
        update public.setoff_alarms
           set call_count = call_count + 1, last_call_at = now(), missing = v_missing,
               call_token = coalesce(call_token, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
         where id = a.id;
        select value into v_secret from public.internal_config where key = 'edge_shared_secret';
        perform net.http_post(
          url := 'https://jmhqsfeqfghzxsyqjgjd.supabase.co/functions/v1/alarm-call',
          body := jsonb_build_object('action', 'alarm', 'alarm_id', a.id),
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-alza-secret', coalesce(v_secret, '')));
      end if;

      if a.last_push_at <= now() - interval '15 seconds' then
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
