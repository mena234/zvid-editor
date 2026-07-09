/**
 * Launch the dash PRODUCTION build with its .env loaded (Nuxt prod does not
 * auto-load .env). Far more stable than `nuxt dev` for a full E2E run.
 *   node tests/real-e2e/helpers/start-dash-prod.mjs
 * Requires `nuxt build` to have been run in zvid-dash first.
 */
import { readFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const DASH = resolve(process.cwd(), '..', 'zvid-dash')
const envPath = resolve(DASH, '.env')
const env = { ...process.env, PORT: process.env.PORT || '3002', NITRO_PORT: '3002' }

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && !line.trim().startsWith('#')) {
      env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}

const child = spawn('node', [resolve(DASH, '.output', 'server', 'index.mjs')], {
  env,
  stdio: 'inherit',
})
process.on('SIGINT', () => child.kill())
process.on('SIGTERM', () => child.kill())
child.on('exit', (c) => process.exit(c ?? 0))
