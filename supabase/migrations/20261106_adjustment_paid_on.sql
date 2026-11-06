-- Előleg: a kifizetés napja külön mező (2026-11-06)
-- Az előleg dátuma a KIFIZETÉS napját jelzi (ez áll az átvételi bizonylaton), miközben a tétel
-- egy korábbi hónap napjaira is szólhat. A work_date továbbra is az elszámolás hónapját adja
-- (bérszámítás, havi zárás, fizetett napok szabálya) — ehhez nem nyúlunk.
-- NULL = a kifizetés napja megegyezik a work_date-tel (a korábbi tételek).

alter table public.adjustments add column if not exists paid_on date;
comment on column public.adjustments.paid_on is
  'Előlegnél a készpénz kifizetésének napja (az átvételi bizonylat kelte). NULL = megegyezik a work_date-tel. Az elszámolás hónapját a work_date adja.';
