import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

// Only this dedicated file is loaded. Never fall back to application/orch env files.
export const editorRoot = resolve(import.meta.dirname, '../../..')
const envFile = resolve(editorRoot, process.env.LIVE_E2E_ENV_FILE || '.env.live')
if (existsSync(envFile)) process.loadEnvFile(envFile)

function positiveInteger(value: string | undefined, fallback: number, maximum: number) {
  const n = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(n) || n < 1 || n > maximum)
    throw new Error(`Live E2E numeric configuration must be an integer between 1 and ${maximum}`)
  return n
}

function origin(value: string | undefined, fallback: string) {
  const url = new URL(value || fallback)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Live E2E origins must be HTTPS origins without credentials, paths or queries')
  return url.origin
}

// Assigned in the parent runner and inherited by replacement workers.
process.env.LIVE_E2E_RUN_ID ||= `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
const runId = process.env.LIVE_E2E_RUN_ID
if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('Invalid LIVE_E2E_RUN_ID')

export const env = {
  dashboardUrl: origin(process.env.LIVE_E2E_DASHBOARD_URL, 'https://app.zvid.io'),
  editorUrl: origin(process.env.LIVE_E2E_EDITOR_URL, 'https://editor.zvid.io'),
  apiUrl: origin(process.env.LIVE_E2E_API_URL, 'https://api.zvid.io'),
  email: process.env.LIVE_E2E_EMAIL || '',
  password: process.env.LIVE_E2E_PASSWORD || '',
  creditLimit: positiveInteger(process.env.LIVE_E2E_CREDIT_LIMIT, 20, 20),
  renderTimeoutMs: positiveInteger(process.env.LIVE_E2E_RENDER_TIMEOUT_SECONDS, 480, 900) * 1000,
  runId,
  runDir: resolve(editorRoot, 'tests/live-e2e/.runs', runId),
  templatePath: resolve(editorRoot, process.env.LIVE_E2E_TEMPLATE_FILE || 'tests/live-e2e/fixtures/video-template.json'),
}
export type LiveEnvironment = typeof env

export function requireCredentials() {
  if (!env.email || !env.password) throw new Error(
    'Set LIVE_E2E_EMAIL and LIVE_E2E_PASSWORD in editor/.env.live (or the process environment). A dedicated verified, onboarded non-admin customer account is required. No live actions were performed.',
  )
}

export function redact(value: string) {
  let safe = value
  for (const secret of [env.password, env.email].filter(Boolean)) safe = safe.split(secret).join('[redacted]')
  return safe.replace(/zvid_[A-Za-z0-9_-]+/g, '[redacted-key]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-token]')
    .replace(/([?&](?:token|key|api_key|signature|auth)\w*=)[^&#\s]*/gi, '$1[redacted]')
}
