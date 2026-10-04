import { createHash } from 'node:crypto'
import { importProject, exportProject } from '../../../shared/schema/normalize'
import { buildScenePlan, projectTotalDuration } from '../../../shared/schema/scenePlan'
import { RESOLUTION_PRESETS } from '../../../shared/schema/constants'

export interface TemplateCandidate {
  slug: string
  title: string
  version: string | number
  content: Record<string, any>
  /** The catalogue adapter must explicitly confirm free access. */
  isFree?: boolean
  access?: string
}
export interface TemplatePin {
  slug: string
  title: string
  version: string | number
  contentHash: string
  duration: number
  width: number
  height: number
}
export interface ChosenTemplate {
  item: TemplateCandidate
  pin: TemplatePin
  payload: Record<string, any>
  cost: number
}

/** Stable JSON hash; object key order does not affect a pin or payload proof. */
export function contentHash(value: unknown): string {
  const canonical = (item: any): any => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Non-finite JSON content')
    if (Array.isArray(item)) return item.map(canonical)
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().filter(k => item[k] !== undefined).map(k => [k, canonical(item[k])]))
    }
    return item
  }
  const text = JSON.stringify(canonical(value))
  if (text === undefined) throw new Error('JSON content is required')
  return createHash('sha256').update(text).digest('hex')
}

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0

function rejectDynamic(value: unknown, path = 'project'): void {
  if (typeof value === 'string' && (value.includes('{{') || value.includes('}}'))) throw new Error(`Unresolved template expression at ${path}`)
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Non-finite number at ${path}`)
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (['variables', 'condition', 'iterate', 'iterateAs'].includes(key)) throw new Error(`Dynamic template field ${path}.${key} is not eligible`)
    if (key === 'matchDuration' && child !== false && child !== undefined) throw new Error(`Automatic audio timing at ${path}`)
    if (key === 'durationMode' && child !== undefined && child !== 'fixed') throw new Error(`Automatic duration at ${path}`)
    rejectDynamic(child, `${path}.${key}`)
  }
}

/** Same import/export and scene math as useRenderPayload, without probes. */
export function normalizeFixedVideo(raw: Record<string, any>): Record<string, any> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('A project object is required')
  rejectDynamic(raw)
  const { doc, warnings } = importProject(raw)
  if (doc.type === 'image') throw new Error('A video template is required')
  if (warnings.length) throw new Error(`Uncertain template normalization: ${warnings.join('; ')}`)
  if (!doc.scenes?.length && !positive(doc.duration)) throw new Error('An explicit fixed video duration is required')
  if (doc.duration !== undefined && !positive(doc.duration)) throw new Error('Invalid fixed project duration')
  for (const scene of doc.scenes ?? []) {
    if (!positive(scene.duration)) throw new Error('Every scene must have an explicit fixed duration')
  }
  // Omitted media end times do not make a fixed container automatic. The
  // editor only probes media when deriving an automatic project/scene end;
  // those modes are rejected above. Preserve audio/video fields exactly as
  // the real submit path does, and fail if shared timing code asks to probe.
  const noProbe = () => { throw new Error('Media probing is not permitted for pinned live templates') }
  const plan = buildScenePlan(doc, noProbe)
  for (let index = 0; index < plan.entries.length; index++) {
    const entry = plan.entries[index]
    const next = plan.entries[index + 1]
    if (entry.transition && (!positive(entry.transitionDuration) || !next
      || entry.transitionDuration >= Math.min(entry.duration, next.duration))) throw new Error('Uncertain scene transition timing')
  }
  const duration = projectTotalDuration(doc, noProbe)
  if (!positive(duration)) throw new Error('Invalid resolved video duration')
  const payload = exportProject(doc)
  delete payload.durationMode
  payload.duration = duration
  // matchDuration=true is rejected above; false still disappears on submit.
  for (const audio of payload.audios ?? []) delete audio.matchDuration
  payload.scenes?.forEach((scene: any, index: number) => {
    scene.duration = plan.entries[index].duration
    for (const audio of scene.audios ?? []) delete audio.matchDuration
  })
  return payload
}

/** Image submission uses the editor's direct export, with no video timing. */
export function normalizeImage(raw: Record<string, any>): Record<string, any> {
  rejectDynamic(raw)
  const { doc, warnings } = importProject(raw)
  if (doc.type !== 'image') throw new Error('An explicit image project is required')
  if (warnings.length) throw new Error(`Uncertain image normalization: ${warnings.join('; ')}`)
  if (doc.duration !== undefined || doc.durationMode !== undefined || doc.frameRate !== undefined || doc.scenes?.length || doc.audios.length || doc.subtitle) {
    throw new Error('Image project contains video timing or audio')
  }
  return exportProject(doc)
}

export function dimensions(payload: Record<string, any>): { width: number; height: number } {
  const preset = payload.resolution && payload.resolution !== 'custom'
    ? RESOLUTION_PRESETS[payload.resolution as keyof typeof RESOLUTION_PRESETS] : null
  if (payload.resolution && payload.resolution !== 'custom' && !preset) throw new Error('Unknown resolution preset')
  const width = preset?.width ?? payload.width ?? 1280
  const height = preset?.height ?? payload.height ?? 720
  if (!positive(width) || !positive(height) || !Number.isInteger(width) || !Number.isInteger(height)) throw new Error('Invalid output dimensions')
  if (width * height > 1920 * 1080) throw new Error('Live template output exceeds Full HD pixel count')
  return { width, height }
}

function inspectTemplate(item: TemplateCandidate): ChosenTemplate {
  if (!item.slug?.trim() || !item.title?.trim() || (typeof item.version !== 'number' && typeof item.version !== 'string')
    || !String(item.version).trim() || (typeof item.version === 'number' && !Number.isFinite(item.version))) throw new Error('Template metadata is incomplete')
  if (item.isFree === false || (item.isFree !== true && item.access !== 'free')) throw new Error('Template must be explicitly free')
  const payload = normalizeFixedVideo(item.content)
  const size = dimensions(payload)
  const cost = Math.ceil(payload.duration)
  if (cost < 1 || cost > 19) throw new Error('Template exceeds the 19-credit video allowance')
  return {
    item,
    payload,
    cost,
    pin: { slug: item.slug, title: item.title, version: item.version, contentHash: contentHash(item.content), duration: payload.duration, ...size },
  }
}

export function chooseTemplate(candidates: TemplateCandidate[]): ChosenTemplate {
  const eligible: ChosenTemplate[] = []
  for (const item of candidates) {
    try { eligible.push(inspectTemplate(item)) } catch { /* Ineligible catalogue entries are never submitted. */ }
  }
  eligible.sort((a, b) => a.pin.duration - b.pin.duration || (a.pin.slug < b.pin.slug ? -1 : a.pin.slug > b.pin.slug ? 1 : 0))
  if (!eligible.length) throw new Error('No free, fixed-duration, Full HD video template fits the 19-credit allowance')
  return eligible[0]
}

export function assertPinnedTemplate(item: TemplateCandidate, pin: TemplatePin): Record<string, any> {
  const selected = inspectTemplate(item)
  for (const key of ['slug', 'title', 'version', 'contentHash', 'duration', 'width', 'height'] as const) {
    if (selected.pin[key] !== pin[key]) throw new Error(`Pinned template ${key} changed; stop and repin explicitly`)
  }
  return selected.payload
}
