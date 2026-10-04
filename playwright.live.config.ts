import { defineConfig, devices } from '@playwright/test'
import { env } from './tests/live-e2e/helpers/env'

export default defineConfig({
  testDir: './tests/live-e2e',
  testMatch: '*.spec.ts',
  testIgnore: '**/.runs/**',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  globalSetup: './tests/live-e2e/setup.ts',
  reporter: [
    ['./tests/live-e2e/reporter.ts'],
    ['html', { outputFolder: `${env.runDir}/report`, open: 'never' }],
  ],
  outputDir: `${env.runDir}/results`,
  projects: [{ name: 'live-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } } }],
  use: {
    baseURL: env.dashboardUrl,
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    acceptDownloads: true,
    // Raw traces, videos and automatic screenshots can contain credentials/keys.
    // The fixture attaches sanitized diagnostics and explicitly masked screenshots.
    trace: 'off', video: 'off', screenshot: 'off',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] },
  },
})
