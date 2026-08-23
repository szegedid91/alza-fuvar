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

export const DEV_LOGIN_ENABLED = import.meta.env.DEV

export const DEV_ACCOUNTS: DevAccount[] = [
  { key: 'crew1',   label: 'Munkatárs 1', sub: 'crew — napi szerep a beosztásból', icon: '🧑‍🔧', email: 'sofor.teszt@alza.hu',   password: 'Teszt-1234' },
  { key: 'crew2',   label: 'Munkatárs 2', sub: 'crew — napi szerep a beosztásból', icon: '🧑‍🔧', email: 'rakodo.teszt@alza.hu',  password: 'Teszt-1234' },
  { key: 'manager', label: 'Menedzser',   sub: 'beosztás, jóváhagyás',             icon: '🧭', email: 'manager.teszt@alza.hu', password: 'Teszt-1234' },
  { key: 'admin',   label: 'Admin',       sub: 'minden munkaterület, bér',         icon: '🛠️', email: 'admin@alza.hu',         password: 'Alza-Admin-2026' },
]
