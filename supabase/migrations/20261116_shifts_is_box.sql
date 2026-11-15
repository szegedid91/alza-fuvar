-- Bérszámítás: a beosztás sora megjegyzi, hogy az a nap Box-autón volt-e (is_box).
-- Eddig a bér az autó MAI kategóriájából számolt: ha egy autót Boxból XL-be soroltak, a korábbi hónapok
-- bére is átszámolódott (lezárt hónapban is). Mostantól a múlt nem változik; az átsorolás a mai naptól él.

alter table public.shifts add column if not exists is_box boolean;

-- Feltöltés a mostani állapot szerint (a napló- és zárolás-triggerek nélkül: ez nem tartalmi módosítás)
alter table public.shifts disable trigger user;
update public.shifts s
   set is_box = coalesce((select cc.box_sheet from public.cars c left join public.car_categories cc on cc.id = c.category_id where c.id = s.car_id), false)
 where s.is_box is null;
alter table public.shifts enable trigger user;

-- Új beosztásnál és autócserénél a szerver állítja be; kézzel nem írható át
create or replace function public.set_shift_is_box()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.car_id is distinct from old.car_id or old.is_box is null then
    new.is_box := coalesce((select cc.box_sheet from public.cars c left join public.car_categories cc on cc.id = c.category_id where c.id = new.car_id), false);
  elsif coalesce(current_setting('app.is_box_sync', true), '') <> '1' then
    new.is_box := old.is_box;
  end if;
  return new;
end $$;
revoke all on function public.set_shift_is_box() from public, anon, authenticated;

drop trigger if exists shifts_set_is_box on public.shifts;
create trigger shifts_set_is_box before insert or update on public.shifts
  for each row execute function public.set_shift_is_box();

-- Autó átsorolása / a kategória Box-jelölésének váltása: a MAI és a jövőbeli beosztások követik, a múlt nem.
-- (Zárolt hónap sorait nem érinti.)
create or replace function public.sync_future_shifts_is_box()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Europe/Budapest')::date;
begin
  perform set_config('app.is_box_sync', '1', true);
  if tg_table_name = 'cars' then
    update public.shifts s
       set is_box = coalesce((select cc.box_sheet from public.car_categories cc where cc.id = new.category_id), false)
     where s.car_id = new.id and s.work_date >= v_today
       and not exists (select 1 from public.payroll_locks pl where pl.workspace_id = s.workspace_id and pl.ym = to_char(s.work_date, 'YYYY-MM'));
  else
    update public.shifts s
       set is_box = coalesce(new.box_sheet, false)
      from public.cars c
     where c.id = s.car_id and c.category_id = new.id and s.work_date >= v_today
       and not exists (select 1 from public.payroll_locks pl where pl.workspace_id = s.workspace_id and pl.ym = to_char(s.work_date, 'YYYY-MM'));
  end if;
  perform set_config('app.is_box_sync', '', true);
  return new;
end $$;
revoke all on function public.sync_future_shifts_is_box() from public, anon, authenticated;

drop trigger if exists cars_sync_is_box on public.cars;
create trigger cars_sync_is_box after update of category_id on public.cars
  for each row when (old.category_id is distinct from new.category_id) execute function public.sync_future_shifts_is_box();

drop trigger if exists car_categories_sync_is_box on public.car_categories;
create trigger car_categories_sync_is_box after update of box_sheet on public.car_categories
  for each row when (old.box_sheet is distinct from new.box_sheet) execute function public.sync_future_shifts_is_box();
