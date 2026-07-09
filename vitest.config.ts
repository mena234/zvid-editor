import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// '~' mirrors Nuxt's srcDir alias so store/composable modules can be
// imported in unit tests (Nuxt auto-imports still need explicit stubs).
//
// Vitest covers the unit layer only (pure logic + pinia stores). The E2E and
// server-route layers run under Playwright — see playwright.config.ts and
// EDITOR_TESTING_PLAN.md at the repo root.
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    include: [
      'tests/*.test.ts',
      'tests/unit/**/*.test.ts',
      'tests/store/**/*.test.ts',
    ],
  },
})
