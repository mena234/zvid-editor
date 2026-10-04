import type { FullConfig } from '@playwright/test'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { env, requireCredentials } from './helpers/env'
import { RunState } from './helpers/run-state'

export default async function setup(config: FullConfig) {
  requireCredentials()
  if (config.workers !== 1 || config.shard || config.projects.length !== 1 ||
      config.projects.some(p => p.retries !== 0 || p.repeatEach !== 1))
    throw new Error('Live runs require one worker/project, zero retries, no repeat-each and no sharding')
  if (!existsSync(env.templatePath)) throw new Error('Missing pinned video template. Run npm run test:e2e:live:pin first (read-only catalogue discovery).')
  try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }) }
  catch { throw new Error('ffprobe must be available on PATH to verify downloaded video output') }
  const state = new RunState(env.runDir, env.creditLimit)
  if (state.snapshot().resources.length || state.snapshot().reservations.length)
    throw new Error('This live run ID was already used. Start a new run; old manifests are only for cleanup.')
}
