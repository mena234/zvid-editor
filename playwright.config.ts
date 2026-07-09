import { defineConfig } from '@playwright/test'

/**
 * Playwright config for the editor's E2E + server-route suites
 * (see EDITOR_TESTING_PLAN.md at the repo root).
 *
 * Boots three servers (reused if already running, so you can keep them up
 * while iterating — see tests/README.md):
 *   4597  editor dev server, ORCH_URL pointed at the mock orch
 *   4598  fixture static server (CORS + Range)   } one process
 *   4599  mock orch HTTP + Socket.IO /frontend   }
 *
 * workers: 1 — specs share the dev server and the mock orch's mutable state.
 */
export default defineConfig({
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 1,
  reporter: [['list']],
  outputDir: './tests/e2e/.results',
  projects: [
    { name: 'e2e', testDir: './tests/e2e' },
    // preview-vs-render pixel comparison; real package renders — opt-in via
    // `npm run test:fidelity`, not part of test:all
    { name: 'fidelity', testDir: './tests/fidelity', timeout: 300_000, retries: 0 },
    // REAL-stack workflows (orch + MySQL + Redis + zvid-cell + dash +
    // landing + editor-on-:3000). Opt-in via `npm run test:real-e2e`;
    // consumes real credits, no retries (a retry would double-charge).
    // Prerequisites + env vars: tests/real-e2e/README.md.
    {
      name: 'real-e2e',
      testDir: './tests/real-e2e',
      timeout: 900_000,
      // the dash SSR/render is unstable under sustained load (a real dash
      // defect, documented in the README); one retry recovers transient dash
      // flakes. The only credit-consuming test (core workflow) provisions a
      // fresh disposable account per attempt, so a retry never affects a real
      // user's balance.
      retries: 1,
      use: {
        navigationTimeout: 45_000,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] },
      },
    },
  ],
  use: {
    baseURL: 'http://127.0.0.1:4597',
    viewport: { width: 1600, height: 1000 },
    trace: 'on-first-retry',
    // media autoplay without gestures, silent
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    },
  },
  webServer: [
    {
      command: 'node tests/e2e/helpers/standalone-servers.mjs',
      url: 'http://127.0.0.1:4599/__mock/state',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4597',
      url: 'http://127.0.0.1:4597/',
      reuseExistingServer: true,
      timeout: 240_000,
      env: {
        ORCH_URL: 'http://127.0.0.1:4599',
        NUXT_PUBLIC_ORCH_URL: 'http://127.0.0.1:4599',
        NUXT_TELEMETRY_DISABLED: '1',
      },
    },
  ],
})
