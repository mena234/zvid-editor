import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { importProject, exportProject } from '../shared/schema/normalize'
import {
  resolveVisualTiming,
  resolveProjectDefaults,
} from '../shared/schema/defaults'
import { validateProjectDoc } from '../shared/schema/validate'
import { canonicalVisualType } from '../shared/schema/types'

const EXAMPLES_DIR = join(__dirname, '..', 'data', 'examples')

const exampleFiles = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.json'))

/**
 * Semantic normal form: what the package's defaults engine would see.
 * Export is allowed to drop keys that restate defaults, so we compare
 * default-applied views instead of raw key sets.
 */
function semanticForm(raw: any) {
  const { doc } = importProject(raw)
  const defaults = resolveProjectDefaults(doc)

  const normVisual = (v: any, contextDuration: number) => {
    const t = resolveVisualTiming(v, contextDuration)
    const { _id, ...rest } = v
    return {
      ...rest,
      type: canonicalVisualType(v.type) ?? v.type,
      x: v.x ?? 0,
      y: v.y ?? 0,
      track: v.track ?? 0,
      opacity: v.opacity ?? 1,
      angle: v.angle ?? 0,
      flipH: v.flipH ?? false,
      flipV: v.flipV ?? false,
      enterAnimation: v.enterAnimation ?? null,
      exitAnimation: v.exitAnimation ?? null,
      position: v.position ?? 'custom',
      anchor:
        v.anchor ?? (v.position && v.position !== 'custom' ? v.position : 'top-left'),
      ...t,
    }
  }
  const normAudio = (a: any) => {
    const { _id, ...rest } = a
    return {
      ...rest,
      enter: a.enter ?? 0,
      audioBegin: a.audioBegin ?? 0,
      volume: a.volume ?? 1,
      speed: a.speed ?? 1,
      track: a.track ?? 0,
    }
  }

  return {
    ...defaults,
    resolution: doc.resolution,
    thumbnail: doc.thumbnail,
    visuals: doc.visuals.map((v) => normVisual(v, defaults.duration)),
    audios: doc.audios.map(normAudio),
    subtitle: doc.subtitle,
    scenes: doc.scenes?.map((s) => {
      const { _id, visuals, audios, ...rest } = s
      const sceneDuration = s.duration && s.duration > 0 ? s.duration : defaults.duration
      return {
        ...rest,
        duration: s.duration ?? -1,
        visuals: visuals.map((v) => normVisual(v, sceneDuration)),
        audios: audios.map(normAudio),
      }
    }),
    extra: doc.extra,
  }
}

describe('M0 round-trip over package examples', () => {
  for (const file of exampleFiles) {
    it(`${file} round-trips semantically`, () => {
      const raw = JSON.parse(readFileSync(join(EXAMPLES_DIR, file), 'utf-8'))
      const { doc } = importProject(raw)
      const exported = exportProject(doc)
      expect(semanticForm(exported)).toEqual(semanticForm(raw))
    })

    it(`${file} validates without errors`, () => {
      const raw = JSON.parse(readFileSync(join(EXAMPLES_DIR, file), 'utf-8'))
      const { doc } = importProject(raw)
      const errors = validateProjectDoc(doc).filter((i) => i.level === 'error')
      expect(errors).toEqual([])
    })
  }

  it('double export is stable (export → import → export)', () => {
    for (const file of exampleFiles) {
      const raw = JSON.parse(readFileSync(join(EXAMPLES_DIR, file), 'utf-8'))
      const once = exportProject(importProject(raw).doc)
      const twice = exportProject(importProject(once).doc)
      expect(twice).toEqual(once)
    }
  })

  it('lowercase types are canonicalized', () => {
    const { doc } = importProject({
      visuals: [{ type: 'text', text: 'hi' }, { type: 'image', src: 'x.png' }],
    })
    expect(doc.visuals[0].type).toBe('TEXT')
    expect(doc.visuals[1].type).toBe('IMAGE')
  })

  it('invalid configs produce readable errors', () => {
    expect(() => importProject({ visuals: [{ type: 'BOGUS' }] })).toThrow(
      /Unknown visual type/
    )
    expect(() => importProject({ duration: 'ten' })).toThrow(/duration/)
  })

  it('unknown extra fields survive the round-trip', () => {
    const raw = {
      name: 'x',
      customTopLevel: { a: 1 },
      visuals: [{ type: 'TEXT', text: 'hi', myMeta: 'keep-me' }],
    }
    const exported = exportProject(importProject(raw).doc)
    expect(exported.customTopLevel).toEqual({ a: 1 })
    expect(exported.visuals[0].myMeta).toBe('keep-me')
  })
})
