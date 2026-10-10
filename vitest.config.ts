import { defineConfig } from 'vitest/config'

// Egységtesztek a tiszta logikára (bér, dátum, Excel-parser, naptár).
// Külön config: a vite.config PWA-pluginje és a define itt nem kell.
export default defineConfig({
  define: { __BUILD_TIME__: JSON.stringify('test') },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
