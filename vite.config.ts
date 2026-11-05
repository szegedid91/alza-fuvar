import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
const BUILD_TIME = new Date().toISOString()

export default defineConfig(({ mode }) => ({
  define: {
    // Build-időbélyeg a Profil oldalon — látszik, melyik verzió fut az eszközön
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
    // Fejlesztői gyors-belépés fiókjai: ÉLES buildből (mode=production, pl. Cloudflare,
    // `npm run build`) mindig kimaradnak — akkor is, ha a gépen van .env.local.
    // Helyi előnézethez `npm run preview` (mode=preview) tartja meg őket; a panel
    // futásidőben csak localhoston jelenik meg (lásd src/lib/devAuth.ts).
    // SEC-15: csak a dev szerver (mode=development) és a helyi preview (mode=preview) tartja meg
    // őket; bármely más build-mód (production, staging, …) nélkülük készül
    ...(mode === 'development' || mode === 'preview' ? {} : { 'import.meta.env.VITE_DEV_ACCOUNTS': '""' }),
  },
  plugins: [
    react(),
    // version.json: a futó app ebből tudja meg (service workertől függetlenül), hogy van-e újabb build
    { name: 'alza-version', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_TIME }) }) } },
    VitePWA({
      // 'prompt': az új verzió nem tölti újra magától az oldalt — az app sávot
      // mutat, és a felhasználó dönt (lásd main.tsx / UpdateBanner)
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Alza Fuvarszervező',
        short_name: 'Alza',
        description: 'Fuvarszervezés sofőröknek és rakodóknak',
        lang: 'hu',
        theme_color: '#0f766e',
        background_color: '#0b1220',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Az aktivált új SW azonnal átveszi a nyitott lapokat — enélkül a „Frissítés” után
        // nem jött controllerchange, és az oldal nem töltött újra
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        globIgnores: ['**/version.json'],
        importScripts: ['/push-sw.js'], // Web Push kezelők
        // A kezdőlap '/' néven kerül a gyorsítótárba (nem 'index.html'-ként): a Cloudflare Pages az
        // /index.html-t átirányítja a '/'-re, és ha a gyorsítótárból valamiért hiányzik a kezdőlap,
        // a service worker hálózati tartaléka átirányított választ kapna — azt a böngésző oldal-
        // betöltésre nem fogadja el („a webhely nem érhető el”). A '/' közvetlenül, átirányítás
        // nélkül jön, így hiány esetén is betölt az oldal a hálózatról.
        navigateFallback: '/',
        manifestTransforms: [
          (entries) => ({ manifest: entries.map((e) => (e.url === 'index.html' ? { ...e, url: '/' } : e)), warnings: [] }),
        ],
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//],
        runtimeCaching: [
          {
            // Supabase Storage képek: cache-first, hogy offline is látszódjanak
            urlPattern: /\/storage\/v1\/object\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'supabase-storage',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
              // Az aláírt URL-ek tokenje óránként változik — a query nélkül
              // keresve a korábban cache-elt kép offline is megtalálható
              matchOptions: { ignoreSearch: true },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { host: true, port: 5173 },
  // Teszteléshez: a preview-t alagúton (trycloudflare) is elérjük telefonról
  preview: { host: true, port: 4173, allowedHosts: true },
}))
