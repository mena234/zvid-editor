import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/live-e2e', testMatch: 'pin-template.setup.ts',
  workers: 1, retries: 0, timeout: 180_000,
  outputDir: './tests/live-e2e/.runs/pin-results',
  reporter: [['list']], use: { trace: 'off', screenshot: 'off', video: 'off' },
})
