import { projectSchema, canonicalVisualType } from './types'
import type {
  ProjectDoc,
  VisualDoc,
  AudioDoc,
  SceneDoc,
  RawProject,
} from './types'

let idCounter = 0
export function makeId(prefix = 'el'): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`
}

export interface ImportResult {
  doc: ProjectDoc
  warnings: string[]
}

const PROJECT_KEYS = new Set([
  'name',
  'resolution',
  'width',
  'height',
  'duration',
  'frameRate',
  'backgroundColor',
  'outputFormat',
  'thumbnail',
  'visuals',
  'audios',
  'subtitle',
  'scenes',
])

/**
 * Parse + validate raw JSON into the editor document. Types are canonicalized
 * to upper-case (the package upper-cases them itself); unknown fields are
 * preserved. Throws a readable Error when zod validation fails.
 */
export function importProject(raw: unknown): ImportResult {
  const warnings: string[] = []
  const parsed = projectSchema.safeParse(raw)
  if (!parsed.success) {
    const msgs = parsed.error.issues
      .slice(0, 20)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new Error(`Invalid project JSON:\n${msgs.join('\n')}`)
  }
  const p = parsed.data as RawProject & Record<string, any>

  const importVisual = (v: Record<string, any>, where: string): VisualDoc => {
    const canonical = canonicalVisualType(String(v.type))
    if (!canonical) {
      warnings.push(`${where}: unknown visual type "${v.type}" — kept as-is`)
    } else if (v.type !== canonical) {
      // package upper-cases types on render; keep the canonical form
      v = { ...v, type: canonical }
    }
    return { ...(v as any), _id: makeId('vis') }
  }

  const importAudio = (a: Record<string, any>): AudioDoc => ({
    ...(a as any),
    _id: makeId('aud'),
  })

  const scenes: SceneDoc[] | undefined = p.scenes?.map((s, i) => {
    const { visuals, audios, ...rest } = s as Record<string, any>
    return {
      ...(rest as any),
      _id: makeId('scn'),
      id: (s.id as string) ?? `scene-${i}`,
      visuals: (visuals ?? []).map((v: any, j: number) =>
        importVisual(v, `scenes[${i}].visuals[${j}]`)
      ),
      audios: (audios ?? []).map(importAudio),
    }
  })

  const extra: Record<string, any> = {}
  for (const [k, v] of Object.entries(p)) {
    if (!PROJECT_KEYS.has(k)) extra[k] = v
  }

  const doc: ProjectDoc = {
    name: p.name,
    resolution: p.resolution,
    width: p.width,
    height: p.height,
    duration: p.duration,
    frameRate: p.frameRate,
    backgroundColor: p.backgroundColor,
    outputFormat: p.outputFormat,
    thumbnail: p.thumbnail,
    visuals: (p.visuals ?? []).map((v: any, i: number) =>
      importVisual(v, `visuals[${i}]`)
    ),
    audios: (p.audios ?? []).map(importAudio),
    subtitle: p.subtitle,
    scenes,
    extra: Object.keys(extra).length ? extra : undefined,
  }
  return { doc, warnings }
}

/* ------------------------------------------------------------------ */
/* Export: minimal, canonical-ordered JSON                             */
/* ------------------------------------------------------------------ */

/** Editor-only / derived fields stripped on export. */
const STRIP_ITEM_FIELDS = new Set(['_id', 'imageSrc', 'inputNumber', 'hasAudio'])

const VISUAL_KEY_ORDER = [
  'type',
  'id',
  'src',
  'text',
  'html',
  'svg',
  'width',
  'height',
  'x',
  'y',
  'position',
  'anchor',
  'resize',
  'track',
  'enterBegin',
  'enterEnd',
  'exitBegin',
  'exitEnd',
  'enterAnimation',
  'exitAnimation',
  'videoBegin',
  'videoEnd',
  'videoDuration',
  'volume',
  'speed',
  'transition',
  'transitionId',
  'transitionDuration',
  'opacity',
  'angle',
  'flipH',
  'flipV',
  'cropParams',
  'radius',
  'chromaKey',
  'filter',
  'zoom',
  'style',
  'customCode',
]

const AUDIO_KEY_ORDER = [
  'src',
  'enter',
  'exit',
  'audioBegin',
  'audioEnd',
  'volume',
  'speed',
  'track',
]

const PROJECT_KEY_ORDER = [
  'name',
  'resolution',
  'width',
  'height',
  'duration',
  'frameRate',
  'backgroundColor',
  'outputFormat',
  'thumbnail',
  'scenes',
  'visuals',
  'audios',
  'subtitle',
]

const SCENE_KEY_ORDER = [
  'id',
  'duration',
  'backgroundColor',
  'transition',
  'transitionId',
  'transitionDuration',
  'visuals',
  'audios',
]

function orderKeys(obj: Record<string, any>, order: string[]) {
  const out: Record<string, any> = {}
  for (const k of order) if (k in obj) out[k] = obj[k]
  for (const k of Object.keys(obj)) if (!(k in out)) out[k] = obj[k]
  return out
}

function isDefaultValue(key: string, value: any): boolean {
  switch (key) {
    case 'x':
    case 'y':
    case 'enterBegin':
    case 'angle':
    case 'audioBegin':
    case 'enter':
      return value === 0
    case 'opacity':
    case 'volume':
    case 'speed':
      return value === 1
    case 'track':
      return value === 0
    case 'flipH':
    case 'flipV':
      return value === false
    case 'enterAnimation':
    case 'exitAnimation':
    case 'transition':
    case 'transitionId':
      return value === null
    case 'position':
      return value === 'custom'
    default:
      return false
  }
}

function cleanVisual(v: VisualDoc): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, val] of Object.entries(v)) {
    if (STRIP_ITEM_FIELDS.has(k)) continue
    if (val === undefined) continue
    if (isDefaultValue(k, val)) continue
    if (k === 'anchor' && v.position && v.position !== 'custom' && val === v.position)
      continue // package re-derives anchor from position
    if (k === 'style' && val && typeof val === 'object' && !Object.keys(val).length)
      continue
    out[k] = val
  }
  // enterEnd equal to enterBegin adds nothing (no animation window)
  if (
    out.enterEnd !== undefined &&
    out.enterEnd === (out.enterBegin ?? 0) &&
    !out.enterAnimation
  ) {
    delete out.enterEnd
  }
  return orderKeys(out, VISUAL_KEY_ORDER)
}

function cleanAudio(a: AudioDoc): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, val] of Object.entries(a)) {
    if (k === '_id' || val === undefined) continue
    if (isDefaultValue(k, val)) continue
    out[k] = val
  }
  return orderKeys(out, AUDIO_KEY_ORDER)
}

function cleanCaption(c: Record<string, any>) {
  const out: Record<string, any> = { start: c.start, end: c.end }
  if (c.text !== undefined) out.text = c.text
  out.words = (c.words ?? []).map((w: any) => ({
    start: w.start,
    end: w.end,
    text: w.text,
  }))
  for (const k of Object.keys(c))
    if (!(k in out) && k !== 'words') out[k] = c[k]
  return out
}

/**
 * Serialize the editor document to the minimal package JSON. Values that
 * merely restate package defaults are omitted so exports stay diffable, like
 * the shipped examples.
 */
export function exportProject(doc: ProjectDoc): Record<string, any> {
  const out: Record<string, any> = {}
  if (doc.name !== undefined) out.name = doc.name
  if (doc.resolution !== undefined) out.resolution = doc.resolution
  if (doc.resolution === 'custom' || !doc.resolution) {
    if (doc.width !== undefined) out.width = doc.width
    if (doc.height !== undefined) out.height = doc.height
  } else {
    // keep explicit width/height only if they were authored alongside a preset
    if (doc.width !== undefined) out.width = doc.width
    if (doc.height !== undefined) out.height = doc.height
  }
  if (doc.duration !== undefined) out.duration = doc.duration
  if (doc.frameRate !== undefined) out.frameRate = doc.frameRate
  if (doc.backgroundColor !== undefined) out.backgroundColor = doc.backgroundColor
  if (doc.outputFormat !== undefined) out.outputFormat = doc.outputFormat
  if (doc.thumbnail !== undefined && doc.thumbnail !== '')
    out.thumbnail = doc.thumbnail

  if (doc.scenes?.length) {
    out.scenes = doc.scenes.map((s) => {
      const { _id, visuals, audios, ...rest } = s
      const scene: Record<string, any> = { ...rest }
      for (const k of Object.keys(scene)) {
        if (scene[k] === undefined) delete scene[k]
        else if (isDefaultValue(k, scene[k]) && k !== 'transitionId') delete scene[k]
      }
      if (scene.transition == null) {
        delete scene.transition
        delete scene.transitionId
        delete scene.transitionDuration
      }
      if (visuals.length) scene.visuals = visuals.map(cleanVisual)
      if (audios.length) scene.audios = audios.map(cleanAudio)
      return orderKeys(scene, SCENE_KEY_ORDER)
    })
  }

  if (doc.visuals.length) out.visuals = doc.visuals.map(cleanVisual)
  if (doc.audios.length) out.audios = doc.audios.map(cleanAudio)

  if (doc.subtitle && (doc.subtitle.captions?.length || doc.subtitle.styles)) {
    const sub: Record<string, any> = {}
    if (doc.subtitle.styles && Object.keys(doc.subtitle.styles).length)
      sub.styles = doc.subtitle.styles
    sub.captions = (doc.subtitle.captions ?? []).map(cleanCaption)
    out.subtitle = sub
  }

  if (doc.extra) Object.assign(out, doc.extra)
  return orderKeys(out, PROJECT_KEY_ORDER)
}

export function exportProjectString(doc: ProjectDoc): string {
  return JSON.stringify(exportProject(doc), null, 2)
}

/** A fresh empty document for "New project". */
export function newProjectDoc(): ProjectDoc {
  return {
    name: 'untitled-video',
    resolution: 'full-hd',
    duration: 10,
    frameRate: 30,
    backgroundColor: '#0b0d12',
    outputFormat: 'mp4',
    visuals: [],
    audios: [],
  }
}
