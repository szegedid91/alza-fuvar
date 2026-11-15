// A helyi mentési sor hiba-besorolása — tiszta függvények, hálózat nélkül.
// „Átmeneti” = később magától megjavul: a tétel a sorban marad, NEM számoljuk hibás próbálkozásnak
// (különben pár perc szerver-kimaradás után az egész sor végleg leparkolna és eltűnne a képernyőről).
import { errMsg } from './errors'

function httpStatusOf(e: unknown): number | null {
  const o = e as { httpStatus?: unknown; status?: unknown; statusCode?: unknown } | null
  for (const v of [o?.httpStatus, o?.status, o?.statusCode]) {
    const n = Number(v)
    if (v != null && v !== '' && Number.isFinite(n) && n >= 100) return n
  }
  return null
}

const lower = (e: unknown) => errMsg(e, 'ismeretlen hiba').toLowerCase()

// Az adatbázis saját időkorlátja NEM átmeneti hálózati hiba: az ismétlés ugyanúgy elhasalna — ezt számoljuk
const isStatementTimeout = (msg: string) => msg.includes('statement timeout') || msg.includes('canceling statement')

// Szerver oldali átmeneti hiba: 5xx (átjáró / túlterhelés), 429 (túl sok kérés), 408, lejárt belépési token
export function isTransientServerError(e: unknown): boolean {
  const msg = lower(e)
  if (isStatementTimeout(msg)) return false
  const st = httpStatusOf(e)
  if (st != null && (st >= 500 || st === 429 || st === 408 || st === 401)) return true
  return msg.includes('jwt expired')
}

// Valódi hálózati hiba (a fetch TypeError-jai ilyen szöveggel), vagy a saját időkorlátunk miatt megszakított kérés
export function isConnectionError(e: unknown, online: boolean): boolean {
  if (!online) return true
  const msg = lower(e)
  if (isStatementTimeout(msg)) return false
  return msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network request failed')
    || msg.includes('network timeout') || msg.includes('load failed') || msg.includes('the internet connection') || msg.includes('err_internet') || msg.includes('err_network')
    // lógó kapcsolat: a mentés saját időkorlátja szakította meg (AbortSignal.timeout)
    || msg.includes('aborterror') || msg.includes('timeouterror') || msg.includes('signal timed out') || msg.includes('operation was aborted') || msg.includes('signal is aborted')
}

// Újrapróbálható később, számolás nélkül
export function isRetryLater(e: unknown, online: boolean): boolean {
  return isConnectionError(e, online) || isTransientServerError(e)
}
