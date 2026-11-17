-- Vegyes autó: kategória nélküli autó, amely egyik nap Boxban, másik nap XL-ben dolgozik.
-- A nap módját (Box / XL) a vezető a beosztásban naponként adja meg, és a beosztás sorára kerül (shifts.is_box).
-- Kategóriás autónál minden marad, ahogy volt: a szerver a kategóriából állítja be, kézzel nem írható át.

create or replace function public.set_shift_is_box()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cat uuid; v_box boolean;
begin
  select c.category_id, cc.box_sheet into v_cat, v_box
    from public.cars c left join public.car_categories cc on cc.id = c.category_id where c.id = new.car_id;
  if v_cat is null then
    -- vegyes autó: a vezető beállítása él; 2. kör csak Box napon van
    new.is_box := coalesce(new.is_box, false) or new.round = 2;
  elsif tg_op = 'INSERT' or new.car_id is distinct from old.car_id or old.is_box is null then
    new.is_box := coalesce(v_box, false);
  elsif coalesce(current_setting('app.is_box_sync', true), '') <> '1' then
    new.is_box := old.is_box;
  end if;
  return new;
end $$;
revoke all on function public.set_shift_is_box() from public, anon, authenticated;

-- Ha egy autó kategóriáját törlik (vegyes lesz), a meglévő beosztások módja megmarad
create or replace function public.sync_future_shifts_is_box()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Europe/Budapest')::date;
begin
  if tg_table_name = 'cars' and new.category_id is null then return new; end if;
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

-- „Nem indult el” riasztás: a Box / XL szűrés a beosztás sorának jelölése szerint (vegyes autónál a kategória üres)
do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef('public.setoff_missing(uuid,date,text)'::regprocedure) into v_src;
  v_new := replace(v_src, 'coalesce(cc.box_sheet, false) as is_box', 'coalesce(s.is_box, cc.box_sheet, false) as is_box');
  if v_new = v_src then raise exception 'setoff_missing: a kategória-kifejezés nem található'; end if;
  execute v_new;
end $$;
