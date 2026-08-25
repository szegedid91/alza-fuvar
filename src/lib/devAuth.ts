// Fejlesztői gyors-belépés — CSAK dev buildben aktív.
// A `vite build` (éles) során az `import.meta.env.DEV` false, így a Login
// oldalon a panel meg sem jelenik, és élesben rendesen be kell jelentkezni.
//
// A gombok VALÓDI, előre felvett demo-fiókokba lépnek be (Supabase Auth),
// hogy minden RLS-es adat-hozzáférés és írás rendesen működjön — csak épp
// nem kell gépelni. Ezek a fiókok az "Alza" munkaterülethez tartoznak.
//
// FONTOS: a sofőr/rakodó megkülönböztetés NEM itt dől el. A munkatársak
// egységes "crew" szerepűek; hogy ma ki a sofőr és ki a rakodó, azt a
// menedzser beosztása (shift) határozza meg. Ezért a két crew-fiók csak
// két különböző munkatárs — a napi szerepük a beosztástól függ.

export interface DevAccount {
  key: string
  label: string
  sub: string
  icon: string
  email: string
  password: string
}

// A jelszavak SOHA nem kerülhetnek a kódba: a repó publikus, és a fiókok
// az ÉLES backendhez tartoznak. A .env.local-ból jönnek (nincs verziókövetve),
// formátum:  VITE_DEV_PASSWORDS=sofor.teszt@alza.hu:jelszó,admin@alza.hu:jelszó
const DEV_PASSWORDS: Record<string, string> = Object.fromEntries(
  ((import.meta.env.VITE_DEV_PASSWORDS as string | undefined) ?? '')
    .split(',')
    .map((pair) => pair.split(':'))
    .filter((p): p is [string, string] => p.length === 2 && !!p[0].trim() && !!p[1].trim())
    .map(([email, pw]) => [email.trim(), pw.trim()]),
)

const DEV_ACCOUNT_META: Omit<DevAccount, 'password'>[] = [
  { key: 'crew1',   label: 'Munkatárs 1', sub: 'crew — napi szerep a beosztásból', icon: '🧑‍🔧', email: 'sofor.teszt@alza.hu' },
  { key: 'crew2',   label: 'Munkatárs 2', sub: 'crew — napi szerep a beosztásból', icon: '🧑‍🔧', email: 'rakodo.teszt@alza.hu' },
  { key: 'manager', label: 'Menedzser',   sub: 'beosztás, jóváhagyás',             icon: '🧭', email: 'manager.teszt@alza.hu' },
  { key: 'admin',   label: 'Admin',       sub: 'minden munkaterület, bér',         icon: '🛠️', email: 'admin@alza.hu' },
]

// Csak azok a gombok jelennek meg, amikhez a .env.local ad jelszót
export const DEV_ACCOUNTS: DevAccount[] = DEV_ACCOUNT_META
  .filter((a) => !!DEV_PASSWORDS[a.email])
  .map((a) => ({ ...a, password: DEV_PASSWORDS[a.email] }))

export const DEV_LOGIN_ENABLED = import.meta.env.DEV && DEV_ACCOUNTS.length > 0
