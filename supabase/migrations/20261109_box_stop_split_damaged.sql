-- Box-lap megálló: az „ÉK / NHB / törölt” összevont mező három külön mezőre bomlik (2026-11-09)
-- invalid_code = ÉK (Érvénytelen kód a kijelzőn), do_not_place = NHB (Ne helyezd be), cancelled = törölt csomag.
-- A régi összevont `damaged` oszlop megmarad a korábbi sorok miatt (az app már nem írja; az összesítők
-- a régi értéket a három új mezővel együtt számolják).
alter table public.box_sheet_stops
  add column if not exists invalid_code integer not null default 0,
  add column if not exists do_not_place integer not null default 0,
  add column if not exists cancelled integer not null default 0;
comment on column public.box_sheet_stops.invalid_code is 'ÉK – Érvénytelen kód a kijelzőn (db)';
comment on column public.box_sheet_stops.do_not_place is 'NHB – Ne helyezd be (kijelző) (db)';
comment on column public.box_sheet_stops.cancelled is 'Törölt csomag (db)';
comment on column public.box_sheet_stops.damaged is 'RÉGI összevont ÉK/NHB/törölt (db) — 2026-11-09 óta a három külön mező használatos';
