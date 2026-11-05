-- AlzaBox-jegyzék napi automatikus frissítése (2026-11-05) — átmeneti megoldás, amíg nincs hivatalos API.
-- Az alza.hu csak böngészőből érhető el, ezért a listát egy ütemezett böngészős futás gyűjti be, és a
-- `box-sync` edge functionnek adja át; az itt lévő függvény végzi a felvitelt, és naplózza a futást.

alter table public.alza_boxes add column if not exists details_checked_at timestamptz;
comment on column public.alza_boxes.details_checked_at is 'Mikor kértük le utoljára a box részleteit (fotó, kód, „hol található” leírás) az alza.hu-ról.';
-- a már részletekkel rendelkező boxokat nem kell az első futáskor újra lekérni
update public.alza_boxes set details_checked_at = updated_at
 where details_checked_at is null and parcel_shop_id is not null and (photo_url is not null or description is not null);

create table if not exists public.box_sync_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  source text not null default 'auto',
  ok boolean not null default true,
  listed integer,
  added integer,
  details integer,
  deactivated integer,
  note text
);
comment on table public.box_sync_runs is 'Az AlzaBox-jegyzék automatikus frissítéseinek naplója.';
alter table public.box_sync_runs enable row level security;
revoke all on table public.box_sync_runs from anon, public;
grant select on table public.box_sync_runs to authenticated;
drop policy if exists bsr_select on public.box_sync_runs;
create policy bsr_select on public.box_sync_runs for select to authenticated using ((select public.is_manager_or_admin()));

-- A kézzel felvett boxok összefésülése az importált sorral — jogosultság-ellenőrzés nélküli belső változat
-- (az automatikus frissítés service role-lal hívja); a meglévő RPC ezt hívja az ellenőrzés után.
create or replace function public.merge_alza_box_duplicates_internal() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0;
begin
  for r in
    select m.id as manual_id, i.id as import_id
      from public.alza_boxes m
      join public.alza_boxes i on i.parcel_shop_id is not null and upper(i.code) = upper(m.code)
     where m.parcel_shop_id is null and m.code is not null
  loop
    -- saját megjegyzés átvitele, ha az importált soron nincs
    update public.alza_boxes i set notes = coalesce(i.notes, m.notes) from public.alza_boxes m where i.id = r.import_id and m.id = r.manual_id;
    update public.route_stops set box_id = r.import_id where box_id = r.manual_id
       and not exists (select 1 from public.route_stops x where x.route_id = route_stops.route_id and x.box_id = r.import_id);
    delete from public.route_stops where box_id = r.manual_id;
    delete from public.alza_boxes where id = r.manual_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.merge_alza_box_duplicates_internal() from public, anon, authenticated;

create or replace function public.merge_alza_box_duplicates() returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager_or_admin() then raise exception 'Csak menedzser vagy admin'; end if;
  return public.merge_alza_box_duplicates_internal();
end $$;

-- A begyűjtött lista felvitele. p_rows: [{psid, name, address, lat, lng, detail, code, photo, article, desc}]
--  - új box bekerül, a meglévő neve / címe / koordinátája frissül; a részletek (kód, fotó, leírás) csak
--    akkor íródnak, ha a sor hozta őket (üres érték nem töröl meglévőt); a saját megjegyzés érintetlen
--  - ami a listából hiányzik, inaktív lesz — de csak ha a lista hihetően teljes (legalább 100 box, és a
--    jelenleg aktívak legalább 80%-a), különben egy csonka lista a fél jegyzéket kikapcsolná
create or replace function public.import_alza_boxes(p_rows jsonb, p_source text default 'auto') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_listed int; v_added int; v_details int; v_deact int := 0; v_active int; v_note text := null;
begin
  drop table if exists _in; -- ugyanabban a tranzakcióban ismételt hívás
  create temp table _in on commit drop as
    select distinct on (r.psid) r.psid, left(btrim(r.name), 200) as name, nullif(left(btrim(coalesce(r.address, '')), 300), '') as address,
           case when r.lat between -90 and 90 then r.lat end as lat, case when r.lng between -180 and 180 then r.lng end as lng,
           coalesce(r.detail, false) as detail,
           nullif(upper(left(btrim(coalesce(r.code, '')), 20)), '') as code,
           case when r.photo ~* '^https?://' then left(r.photo, 500) end as photo,
           case when r.article ~* '^https?://' then left(r.article, 500) end as article,
           nullif(left(btrim(coalesce(r."desc", '')), 4000), '') as description
      from jsonb_to_recordset(p_rows) as r(psid int, name text, address text, lat double precision, lng double precision, detail boolean, code text, photo text, article text, "desc" text)
     where r.psid is not null and r.psid > 0 and btrim(coalesce(r.name, '')) <> ''
     order by r.psid;
  select count(*) into v_listed from _in;
  if v_listed = 0 then raise exception 'Üres lista — nincs mit felvinni'; end if;
  if v_listed > 5000 then raise exception 'Túl hosszú lista (%)', v_listed; end if;
  select count(*) into v_added from _in i where not exists (select 1 from public.alza_boxes a where a.parcel_shop_id = i.psid);
  select count(*) into v_details from _in where detail;
  select count(*) into v_active from public.alza_boxes where parcel_shop_id is not null and active;

  insert into public.alza_boxes as a (parcel_shop_id, name, address, lat, lng, code, photo_url, article_url, description, active, details_checked_at)
  select i.psid, i.name, i.address, i.lat, i.lng, i.code, i.photo, i.article, i.description, true, case when i.detail then now() end
    from _in i
  on conflict (parcel_shop_id) do update set
    name = excluded.name,
    address = coalesce(excluded.address, a.address),
    lat = coalesce(excluded.lat, a.lat),
    lng = coalesce(excluded.lng, a.lng),
    code = coalesce(excluded.code, a.code),
    photo_url = coalesce(excluded.photo_url, a.photo_url),
    article_url = coalesce(excluded.article_url, a.article_url),
    description = coalesce(excluded.description, a.description),
    details_checked_at = coalesce(excluded.details_checked_at, a.details_checked_at),
    active = true;

  perform public.merge_alza_box_duplicates_internal();

  if v_listed >= 100 and v_listed >= v_active * 0.8 then
    with gone as (
      update public.alza_boxes a set active = false
       where a.parcel_shop_id is not null and a.active and not exists (select 1 from _in i where i.psid = a.parcel_shop_id)
      returning 1)
    select count(*) into v_deact from gone;
  else
    v_note := 'A lista rövidebb a vártnál (' || v_listed || ' / ' || v_active || ' aktív) — megszűnt boxot most nem kapcsoltunk ki.';
  end if;

  insert into public.box_sync_runs (source, ok, listed, added, details, deactivated, note)
  values (left(coalesce(p_source, 'auto'), 40), true, v_listed, v_added, v_details, v_deact, v_note);
  return jsonb_build_object('listed', v_listed, 'added', v_added, 'details', v_details, 'deactivated', v_deact, 'note', v_note);
end $$;
revoke execute on function public.import_alza_boxes(jsonb, text) from public, anon, authenticated;
