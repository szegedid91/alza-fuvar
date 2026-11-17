-- XL sikerdíj: ha egy XL autó napi sikeres címeinek száma a beállított küszöb FELETT van,
-- az autó sofőrje és rakodója aznap fix plusz összeget kap (mindketten ugyanannyit).
-- A küszöb és az összeg a napidíjak mellett él (hónaptól érvényes, mint a többi díj);
-- a napi sikeres címek száma autónként külön táblában (kézzel írható, később táblázatból tölthető).

alter table public.workspaces
  add column if not exists xl_bonus_over integer not null default 0,
  add column if not exists xl_bonus_amount numeric not null default 0;
alter table public.workspace_rate_history
  add column if not exists xl_bonus_over integer not null default 0,
  add column if not exists xl_bonus_amount numeric not null default 0;

create table if not exists public.xl_day_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  work_date date not null,
  car_id uuid not null references public.cars(id) on delete cascade,
  success_count integer not null check (success_count >= 0 and success_count <= 999),
  source text not null default 'manual',
  -- a megbízó táblázatából: a járat kódja (UX22…) és a megjegyzés (pl. „+1 cím”) — tájékoztatásul
  route_code text,
  note text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (car_id, work_date)
);
create index if not exists xl_day_results_ws_date_idx on public.xl_day_results (workspace_id, work_date);

alter table public.xl_day_results enable row level security;
revoke all on table public.xl_day_results from anon;
grant select, insert, update, delete on table public.xl_day_results to authenticated;

drop policy if exists xdr_select on public.xl_day_results;
create policy xdr_select on public.xl_day_results for select
  using ((select public.is_manager_or_admin()) and public.can_access_workspace(workspace_id));
drop policy if exists xdr_insert on public.xl_day_results;
create policy xdr_insert on public.xl_day_results for insert
  with check ((select public.is_manager_or_admin()) and public.can_access_workspace(workspace_id));
drop policy if exists xdr_update on public.xl_day_results;
create policy xdr_update on public.xl_day_results for update
  using ((select public.is_manager_or_admin()) and public.can_access_workspace(workspace_id))
  with check ((select public.is_manager_or_admin()) and public.can_access_workspace(workspace_id));
drop policy if exists xdr_delete on public.xl_day_results;
create policy xdr_delete on public.xl_day_results for delete
  using ((select public.is_manager_or_admin()) and public.can_access_workspace(workspace_id));

-- ki és mikor írta át utoljára; a munkaterület az autóé (kliensről nem hamisítható)
create or replace function public.xl_day_results_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from public.cars where id = new.car_id;
  if v_ws is null or v_ws <> new.workspace_id then raise exception 'Az autó nem ehhez a munkaterülethez tartozik'; end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
revoke all on function public.xl_day_results_stamp() from public, anon, authenticated;
drop trigger if exists xl_day_results_stamp on public.xl_day_results;
create trigger xl_day_results_stamp before insert or update on public.xl_day_results
  for each row execute function public.xl_day_results_stamp();

-- zárolt hónapban nem írható (a bért befolyásolja)
drop trigger if exists lock_xl_day_results on public.xl_day_results;
create trigger lock_xl_day_results before insert or delete or update on public.xl_day_results
  for each row execute function public.enforce_month_lock();

-- A napidíj-beállítás két új értékkel. Ha a hívó nem adja meg (régi kliens), az addig érvényes érték öröklődik.
drop function if exists public.set_workspace_rate_from(uuid, date, numeric, numeric, numeric, numeric, numeric, numeric);
create or replace function public.set_workspace_rate_from(
  p_workspace_id uuid, p_valid_from date, p_driver_rate numeric, p_loader_rate numeric,
  p_trainee_rate numeric default 0, p_box_rate numeric default 0, p_box_trainee_rate numeric default 0, p_box_round2_rate numeric default 0,
  p_xl_bonus_over integer default null, p_xl_bonus_amount numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_from date := date_trunc('month', p_valid_from)::date; v_locked text; v_over integer; v_amount numeric;
begin
  if not public.is_admin() then raise exception 'Napidíjat csak admin állíthat'; end if;
  if not public.can_access_workspace(p_workspace_id) then raise exception 'Nincs jogosultság ehhez a munkaterülethez'; end if;
  if p_driver_rate < 0 or p_loader_rate < 0 or coalesce(p_trainee_rate, 0) < 0 or coalesce(p_box_rate, 0) < 0
     or coalesce(p_box_trainee_rate, 0) < 0 or coalesce(p_box_round2_rate, 0) < 0 then
    raise exception 'A napidíj nem lehet negatív';
  end if;
  select h.xl_bonus_over, h.xl_bonus_amount into v_over, v_amount from public.workspace_rate_history h
   where h.workspace_id = p_workspace_id and h.valid_from <= v_from order by h.valid_from desc limit 1;
  v_over := coalesce(p_xl_bonus_over, v_over, 0);
  v_amount := coalesce(p_xl_bonus_amount, v_amount, 0);
  if v_over < 0 or v_amount < 0 then raise exception 'A sikerdíj küszöbe és összege nem lehet negatív'; end if;
  select string_agg(ym, ', ' order by ym) into v_locked
    from public.payroll_locks where workspace_id = p_workspace_id and ym >= to_char(v_from, 'YYYY-MM');
  if v_locked is not null then
    raise exception 'ZAROLT_HONAP: % — előbb oldd fel a zárolást, vagy válassz későbbi hónapot', v_locked;
  end if;
  insert into public.workspace_rate_history (workspace_id, valid_from, driver_day_rate, loader_day_rate, trainee_day_rate, box_day_rate, box_trainee_day_rate, box_round2_day_rate, xl_bonus_over, xl_bonus_amount, created_by)
  values (p_workspace_id, v_from, p_driver_rate, p_loader_rate, coalesce(p_trainee_rate, 0), coalesce(p_box_rate, 0), coalesce(p_box_trainee_rate, 0), coalesce(p_box_round2_rate, 0), v_over, v_amount, auth.uid())
  on conflict (workspace_id, valid_from)
  do update set driver_day_rate = excluded.driver_day_rate, loader_day_rate = excluded.loader_day_rate,
                trainee_day_rate = excluded.trainee_day_rate, box_day_rate = excluded.box_day_rate,
                box_trainee_day_rate = excluded.box_trainee_day_rate, box_round2_day_rate = excluded.box_round2_day_rate,
                xl_bonus_over = excluded.xl_bonus_over, xl_bonus_amount = excluded.xl_bonus_amount,
                created_by = excluded.created_by, created_at = now();
  update public.workspaces w
     set driver_day_rate = r.driver_day_rate, loader_day_rate = r.loader_day_rate, trainee_day_rate = r.trainee_day_rate,
         box_day_rate = r.box_day_rate, box_trainee_day_rate = r.box_trainee_day_rate, box_round2_day_rate = r.box_round2_day_rate,
         xl_bonus_over = r.xl_bonus_over, xl_bonus_amount = r.xl_bonus_amount
    from (select driver_day_rate, loader_day_rate, trainee_day_rate, box_day_rate, box_trainee_day_rate, box_round2_day_rate, xl_bonus_over, xl_bonus_amount
            from public.workspace_rate_history
           where workspace_id = p_workspace_id and valid_from <= (now() at time zone 'Europe/Budapest')::date
           order by valid_from desc limit 1) r
   where w.id = p_workspace_id;
end $$;
revoke all on function public.set_workspace_rate_from(uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, integer, numeric) from public, anon;
grant execute on function public.set_workspace_rate_from(uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, integer, numeric) to authenticated;
