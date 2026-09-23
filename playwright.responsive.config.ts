import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/** Feature parity: real desktop input and touch-emulated tablet/phone workflows. */
export default defineConfig({
  ...base,
  testDir: './tests/e2e',
  testMatch: ['responsive*.spec.ts', 'touch-timeline.spec.ts'],
  outputDir: '../tmp/editor-responsive-results',
  retries: 0,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    // These engines cover UI workflows; Chromium-only CDP gesture suites run
    // in the first project. Device specs choose their own viewport/touch input.
    { name: 'webkit', testMatch: ['responsive-workflows.spec.ts', 'responsive-support.spec.ts'], use: { browserName: 'webkit', launchOptions: { args: [] } } },
    { name: 'firefox', testMatch: ['responsive-workflows.spec.ts', 'responsive-support.spec.ts'], use: { browserName: 'firefox', launchOptions: { args: [] } } },
  ],
})
