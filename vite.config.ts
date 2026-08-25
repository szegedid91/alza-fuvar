import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  // Build-időbélyeg a Profil oldalon — látszik, melyik verzió fut az eszközön
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        importScripts: ['/push-sw.js'], // Web Push kezelők
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
})
