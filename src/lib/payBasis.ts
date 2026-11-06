// Miből számolunk bért és előleget: a becsekkolt napokból vagy a beosztás napjaiból.
// A választás közös a Bérszámítás és az Előleg / levonás oldalon (ezen a készüléken megjegyezve).
import type { AdvanceBasis } from './payroll'

const KEY = 'alza-pay-basis'

export function readPayBasis(): AdvanceBasis {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'schedule' || v === 'checkin') return v
    // korábbi, oldalankénti beállítások átvétele
    if (localStorage.getItem('alza-payroll-basis') === 'planned' || localStorage.getItem('alza-advance-basis') === 'schedule') return 'schedule'
  } catch { /* privát mód: alapértelmezés */ }
  return 'checkin'
}

export function savePayBasis(b: AdvanceBasis): void {
  try { localStorage.setItem(KEY, b) } catch { /* privát mód: csak erre a megnyitásra szól */ }
}
