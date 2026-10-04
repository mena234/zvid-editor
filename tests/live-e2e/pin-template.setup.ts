import { test } from '@playwright/test'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { env } from './helpers/env'
import { chooseTemplate, type TemplateCandidate } from './helpers/template'

test('pin the shortest eligible published video template (no account or credits)', async ({ request }) => {
  if (existsSync(env.templatePath)) throw new Error('A template pin already exists. Review and remove it explicitly before selecting a replacement.')
  const response = await request.get(`${env.apiUrl}/api/library/examples`)
  if (!response.ok()) throw new Error(`Catalogue unavailable (${response.status()})`)
  const body = await response.json()
  if (!Array.isArray(body.items)) throw new Error('Unexpected library response')
  const items = body.items.filter((item: any) => item.meta?.type !== 'image' && !item.meta?.premium)
  const candidates: TemplateCandidate[] = []
  // Four read-only requests at a time; validation/selection remains deterministic.
  for (let start = 0; start < items.length; start += 4) {
    const batch = await Promise.all(items.slice(start, start + 4).map(async (item: any) => {
      // Use the same real editor proxy as customers (it follows the CDN redirect server-side).
      const content = await request.get(`${env.editorUrl}/api/library/examples/${encodeURIComponent(item.slug)}/content`, { timeout: 30000 })
      if (!content.ok()) throw new Error(`Template content unavailable for ${item.slug} (${content.status()})`)
      return { slug: item.slug, title: item.title, version: item.version, isFree: true, content: await content.json() }
    }))
    candidates.push(...batch)
  }
  const selected = chooseTemplate(candidates)
  mkdirSync(dirname(env.templatePath), { recursive: true })
  writeFileSync(env.templatePath, JSON.stringify(selected.pin, null, 2) + '\n', { flag: 'wx' })
  console.log(`Pinned ${selected.pin.slug} v${selected.pin.version}; ${selected.cost} video credits, plus 1 image credit per full run.`)
})
