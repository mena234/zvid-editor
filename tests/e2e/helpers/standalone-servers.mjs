/**
 * Boots the two support servers for the Playwright suite and stays alive:
 *   4598  fixture static server (CORS + Range)
 *   4599  mock orch (HTTP API + Socket.IO /frontend)
 * Started by playwright.config.ts (webServer entry); health-checked via
 * http://127.0.0.1:4599/__mock/state.
 */
import { startFixtureServer } from './fixtureServer.mjs'
import { startMockOrch } from './mockOrch.mjs'

const FIXTURE_PORT = 4598
const ORCH_PORT = 4599

await startFixtureServer(FIXTURE_PORT)
await startMockOrch(ORCH_PORT)
console.log(`fixture server on :${FIXTURE_PORT}, mock orch on :${ORCH_PORT}`)
// keep the process alive
setInterval(() => {}, 1 << 30)
