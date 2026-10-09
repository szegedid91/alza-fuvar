// Fejlesztői gyors-belépés — minden szerepkörhöz egy gomb a bejelentkező oldalon.
//
// FONTOS: a kódban SEMMILYEN hitelesítő adat (jelszó, email) nincs. A fiókok a
// .env.local-ból jönnek, ami nincs verziókövetve — így éles buildbe nem is
// kerülhetnek bele: a CI-ben nincs ilyen változó, ezért ott a panel és a
// fiókok teljesen eltűnnek a kódból.
//
// Formátum (EGY sorban, a .env.local-ban):
//   VITE_DEV_ACCOUNTS=[{"label":"Munkatárs 1","email":"...","password":"...","sub":"crew","icon":"🧑‍🔧"}]
//
// A napi sofőr/rakodó szerep NEM itt dől el: a munkatársak egységes "crew"
// szerepűek, a napi szerepet a menedzser beosztása (shift) határozza meg.
// Ezért kell két munkatárs-fiók: a páros (sofőr + rakodó) teszteléséhez.

export interface DevAccount {
  key: string
  label: string
  sub: string
  icon: string
  email: string
  password: string
}

// Csak helyi futtatásnál: dev szerver VAGY localhost-on megnyitott preview build.
// Az éles domainen akkor sem jelenik meg, ha valaki véletlenül beállítaná.
const isLocalHost =
  typeof window !== 'undefined' &&
  (['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname) ||
    window.location.hostname.endsWith('.localhost'))

const LOCAL_ONLY = import.meta.env.DEV || isLocalHost

function parseAccounts(): DevAccount[] {
  const raw = (import.meta.env.VITE_DEV_ACCOUNTS as string | undefined)?.trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as Partial<DevAccount>[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((a): a is Partial<DevAccount> & { email: string; password: string } =>
        !!a && typeof a.email === 'string' && !!a.email && typeof a.password === 'string' && !!a.password)
      .map((a, i) => ({
        key: a.key ?? `dev${i}`,
        label: a.label ?? a.email.split('@')[0],
        sub: a.sub ?? '',
        icon: a.icon ?? '👤',
        email: a.email,
        password: a.password,
      }))
  } catch {
    // Hibás JSON: inkább ne legyen panel, mint hogy fél adattal próbálkozzon
    console.error('VITE_DEV_ACCOUNTS: érvénytelen JSON — a gyors belépés kikapcsolva')
    return []
  }
}

export const DEV_ACCOUNTS: DevAccount[] = LOCAL_ONLY ? parseAccounts() : []

export const DEV_LOGIN_ENABLED = DEV_ACCOUNTS.length > 0

// Helyben futunk, de egy fiók sincs beállítva → a bejelentkező oldalon
// megmutatjuk, mit kell a .env.local-ba írni
export const DEV_LOGIN_SETUP_HINT = LOCAL_ONLY && DEV_ACCOUNTS.length === 0
