import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// '~' mirrors Nuxt's srcDir alias so store/composable modules can be
// imported in unit tests (Nuxt auto-imports still need explicit stubs).
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
