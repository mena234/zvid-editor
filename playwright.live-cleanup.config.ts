import { defineConfig } from '@playwright/test'
import { env } from './tests/live-e2e/helpers/env'
export default defineConfig({
  testDir: './tests/live-e2e', testMatch: 'cleanup.setup.ts',
  workers: 1, retries: 0, timeout: 180_000,
  reporter: [['./tests/live-e2e/reporter.ts'], ['html', { outputFolder: `${env.runDir}/report`, open: 'never' }]],
  outputDir: `${env.runDir}/results`,
  use: { actionTimeout: 15_000, navigationTimeout: 45_000, trace: 'off', screenshot: 'off', video: 'off' },
})
