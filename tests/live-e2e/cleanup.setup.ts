import { test } from '@playwright/test'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { editorRoot, env, requireCredentials } from './helpers/env'
import { RunState } from './helpers/run-state'
import { LiveApi } from './helpers/api'
import { cleanupResources } from './helpers/cleanup'
import { login } from './helpers/dashboard'

test('clean only the exact resources in a previous live-run manifest', async ({ page, context }, info) => {
  requireCredentials()
  const target = process.env.LIVE_E2E_CLEANUP_RUN_DIR
  if (!target) throw new Error('Set LIVE_E2E_CLEANUP_RUN_DIR to the previous run directory printed in its report')
  const root = realpathSync(resolve(editorRoot, 'tests/live-e2e/.runs'))
  const dir = realpathSync(resolve(editorRoot, target))
  const path = relative(root, dir)
  if (!path || isAbsolute(path) || path.startsWith('..')) throw new Error('Cleanup manifest must be inside tests/live-e2e/.runs')
  const manifest = JSON.parse(readFileSync(resolve(dir, 'run-state.json'), 'utf8'))
  const run = new RunState(dir, manifest.cap)
  await login(page, { env, sensitive: true })
  const failures = await cleanupResources(new LiveApi(context.request, env), run)
  await info.attach('cleanup-manifest', { body: JSON.stringify(run.snapshot(), null, 2), contentType: 'application/json' })
  if (failures.length) throw new Error(`Resources retained: ${failures.join('; ')}`)
})
