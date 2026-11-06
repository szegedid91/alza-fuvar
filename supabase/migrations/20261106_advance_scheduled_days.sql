-- Előleg: a fizetett nap lehet BEOSZTOTT nap is, nem csak becsekkolt (2026-11-06)
-- Az Előleg / levonás oldalon választható, hogy a napok becsekkolás vagy beosztás szerint
-- látszanak. Eddig a szabály csak becsekkolt napot engedett megjelölni; mostantól olyan nap is
-- megjelölhető, amelyre a munkatárs be volt osztva (sofőr / rakodó / betanuló) ezen a
-- munkaterületen, ha a nap nem jövőbeli. A többi ellenőrzés (csak előleg, azonos hónap,
-- egy nap csak egyszer, zárolás) változatlan.

create or replace function public.guard_adjustment_covered_dates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bad date;
  v_today date := (now() at time zone 'Europe/Budapest')::date;
begin
  if new.covered_dates is null or cardinality(new.covered_dates) = 0 then
    new.covered_dates := null;
    return new;
  end if;

  if new.type <> 'advance' then
    raise exception 'Fizetett nap csak előleghez jelölhető.' using errcode = 'check_violation';
  end if;

  -- rendezve, ismétlődés nélkül
  new.covered_dates := array(select distinct d from unnest(new.covered_dates) d where d is not null order by d);

  if tg_op = 'UPDATE'
     and new.covered_dates is not distinct from old.covered_dates
     and new.user_id = old.user_id and new.workspace_id = old.workspace_id
     and new.work_date = old.work_date and new.type = old.type then
    return new;
  end if;

  -- a bér havonta számolódik: a megjelölt napok az előleg hónapjába essenek
  select d into v_bad from unnest(new.covered_dates) d
   where to_char(d, 'YYYY-MM') <> to_char(new.work_date, 'YYYY-MM') limit 1;
  if found then
    raise exception 'A megjelölt nap (%) nem az előleg hónapjába esik.', v_bad using errcode = 'check_violation';
  end if;

  -- két vezető egyszerre ne fizethesse ki ugyanazt a napot
  perform pg_advisory_xact_lock(hashtextextended('adj_cov:' || new.user_id::text, 0));

  -- csak ledolgozott (becsekkolt) VAGY beosztott, nem jövőbeli nap fizethető ki
  select d into v_bad from unnest(new.covered_dates) d
   where not exists (select 1 from check_ins c
                      where c.user_id = new.user_id and c.workspace_id = new.workspace_id and c.work_date = d)
     and not (d <= v_today and exists (select 1 from shifts s
                      where s.workspace_id = new.workspace_id and s.work_date = d
                        and new.user_id in (s.driver_id, s.loader_id, s.trainee_id)))
   limit 1;
  if found then
    raise exception 'A megjelölt napon (%) a munkatárs nem csekkolt be, és beosztva sem volt ezen a munkaterületen.', v_bad using errcode = 'check_violation';
  end if;

  -- egy nap csak egyszer fizethető ki előlegként
  select d into v_bad from unnest(new.covered_dates) d
   where exists (select 1 from adjustments a
                  where a.user_id = new.user_id and a.type = 'advance' and a.id <> new.id
                    and a.covered_dates @> array[d])
   limit 1;
  if found then
    raise exception 'Ez a nap (%) már ki van fizetve egy korábbi előleggel.', v_bad using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_adjustment_covered_dates() from public, anon, authenticated;
