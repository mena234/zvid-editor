import { describe, it, expect } from 'vitest'
import { importProject, exportProject } from '../shared/schema/normalize'
import {
  resolveVisualTiming,
  resolveProjectDefaults,
} from '../shared/schema/defaults'
import { validateProjectDoc } from '../shared/schema/validate'
import { canonicalVisualType } from '../shared/schema/types'

// The example library is CDN-canonical (project JSON lives in B2, not the
// repo), so this sweep runs over representative inline fixtures covering the
// features the import/export round-trip must preserve: multi-scene video with
// per-lane tracks + a transition, variables/iterate/condition, and a still
// image project. (The full library is validated at publish time.)
const FIXTURES: Record<string, any> = {
  'video-scenes': {
    name: 'fx-video',
    resolution: 'instagram-reel',
    frameRate: 30,
    backgroundColor: '#0A0F1E',
    outputFormat: 'mp4',
    scenes: [
      {
        id: 'hook',
        duration: 3,
        backgroundColor: '#0A0F1E',
        transition: 'fade',
        transitionId: 'reveal',
        transitionDuration: 0.5,
        visuals: [
          {
            type: 'IMAGE',
            src: 'https://example.com/bg.jpg',
            width: 1080,
            height: 1920,
            position: 'center-center',
            resize: 'cover',
            track: 0,
            enterBegin: 0,
            exitEnd: 3,
          },
          {
            type: 'TEXT',
            x: 540,
            y: 900,
            anchor: 'top-center',
            track: 1,
            enterBegin: 0.2,
            exitEnd: 3,
            html: "<div style='color:#fff;font-size:72px'>Hello</div>",
          },
        ],
      },
      {
        id: 'reveal',
        duration: 3,
        backgroundColor: '#0A0F1E',
        visuals: [
          {
            type: 'TEXT',
            x: 540,
            y: 900,
            anchor: 'top-center',
            track: 0,
            enterBegin: 0.2,
            exitEnd: 3,
            html: "<div style='color:#fff;font-size:56px'>World</div>",
          },
        ],
      },
    ],
    audios: [
      { src: 'https://example.com/music.mp3', volume: 0.2, track: 0 },
    ],
  },
  'video-iterate': {
    name: 'fx-iterate',
    resolution: 'instagram-post',
    frameRate: 30,
    backgroundColor: '#111111',
    outputFormat: 'mp4',
    variables: {
      items: [{ label: 'A' }, { label: 'B' }],
      showCta: true,
      cta: 'Go',
    },
    scenes: [
      {
        id: 'item',
        iterate: 'items',
        iterateAs: 'it',
        duration: 2,
        visuals: [
          {
            type: 'TEXT',
            x: 540,
            y: 540,
            anchor: 'center-center',
            track: 0,
            enterBegin: 0,
            exitEnd: 2,
            html: "<div style='color:#fff;font-size:80px'>{{it.label}}</div>",
          },
        ],
      },
      {
        id: 'cta',
        condition: '{{showCta}}',
        duration: 2,
        visuals: [
          {
            type: 'TEXT',
            x: 540,
            y: 540,
            anchor: 'center-center',
            track: 0,
            enterBegin: 0,
            exitEnd: 2,
            html: "<div style='color:#fff;font-size:64px'>{{cta}}</div>",
          },
        ],
      },
    ],
  },
  'image-poster': {
    name: 'fx-image',
    type: 'image',
    resolution: 'instagram-post',
    backgroundColor: '#F3EEE4',
    outputFormat: 'png',
    visuals: [
      {
        type: 'TEXT',
        x: 540,
        y: 540,
        anchor: 'center-center',
        track: 1,
        html: "<div style='color:#111;font-size:90px'>Poster</div>",
      },
      {
        type: 'SVG',
        width: 1080,
        height: 1080,
        track: 0,
        svg: "<svg width='1080' height='1080' xmlns='http://www.w3.org/2000/svg'><rect width='1080' height='1080' fill='none' stroke='#111' stroke-width='8'/></svg>",
      },
    ],
  },
}

const exampleFiles = Object.keys(FIXTURES)

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

describe('M0 round-trip over representative fixtures', () => {
  for (const file of exampleFiles) {
    it(`${file} round-trips semantically`, () => {
      const raw = FIXTURES[file]
      const { doc } = importProject(raw)
      const exported = exportProject(doc)
      expect(semanticForm(exported)).toEqual(semanticForm(raw))
    })

    it(`${file} validates without errors`, () => {
      const raw = FIXTURES[file]
      const { doc } = importProject(raw)
      const errors = validateProjectDoc(doc).filter((i) => i.level === 'error')
      expect(errors).toEqual([])
    })
  }

  it('double export is stable (export → import → export)', () => {
    for (const file of exampleFiles) {
      const raw = FIXTURES[file]
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
