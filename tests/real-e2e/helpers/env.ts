/**
 * Environment for the real-stack E2E suite (see tests/real-e2e/README.md).
 * Everything is overridable; defaults match the local dev stack.
 */

const num = (v: string | undefined, d: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : d
}

// NOTE: "localhost" (not 127.0.0.1) everywhere — the httpOnly auth_token
// cookie is host-scoped and shared across ports (dash:3002 ↔ editor:3000 ↔
// orch:4000 socket), and orch's CORS_ORIGINS lists localhost origins.
export const ENV = {
  /** orch API origin (no /api suffix) */
  orchUrl: process.env.REAL_ORCH_URL || 'http://localhost:4000',
  /** editor instance whose ORCH_URL points at the REAL orch (the editor's dev
   *  default) — `npm run dev` in editor/ serves exactly this on :3000 */
  editorUrl: process.env.REAL_EDITOR_URL || 'http://localhost:3000',
  dashUrl: process.env.REAL_DASH_URL || 'http://localhost:3002',
  landingUrl: process.env.REAL_LANDING_URL || 'http://localhost:3003',
  /** deterministic local media served by the suite's fixture server */
  fixtureUrl: process.env.REAL_FIXTURE_URL || 'http://127.0.0.1:4598',

  /** meets orch's password policy (upper+lower+digit+special, ≥8) */
  password: process.env.REAL_E2E_PASSWORD || 'Str0ng!Pass9',

  /** seconds to wait for a render job to reach a terminal state */
  renderTimeoutMs: num(process.env.REAL_RENDER_TIMEOUT, 480) * 1000,
  /** polling interval for job state */
  pollIntervalMs: num(process.env.REAL_POLL_INTERVAL, 3) * 1000,

  /** feature toggles */
  skipRender: process.env.REAL_SKIP_RENDER === '1',
  /** delete created resources at the end of each spec (default on) */
  cleanup: process.env.REAL_CLEANUP !== '0',
}

/**
 * Synthetic-account conventions shared with k6-tests: the @zvid-test.io
 * domain marks disposable accounts; unique local part prevents collisions.
 * Registered users are never deleted (same convention as k6) — uniqueness
 * is the cleanup strategy for accounts.
 */
export function newIdentity(tag = 'pw') {
  const suffix =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  return {
    email: `${tag}+${suffix}@zvid-test.io`,
    password: ENV.password,
    firstName: 'PW',
    lastName: `Runner${suffix.slice(-4)}`,
  }
}

/** resource-name prefix for filterable cleanup (k6 uses "k6-") */
export const NAME_PREFIX = 'pw-e2e-'
