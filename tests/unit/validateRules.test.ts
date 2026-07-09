import { describe, it, expect } from 'vitest'
import { importProject } from '../../shared/schema/normalize'
import { validateProjectDoc, type ValidationIssue } from '../../shared/schema/validate'
import {
  MAX_CUSTOM_CODE_ANIMATION_DURATION,
  MAX_DESIGN_ELEMENT_DURATION,
} from '../../shared/schema/constants'

/**
 * Rule-branch coverage for validate.ts. The image-project branch and the
 * snapshotTime/quality-on-video checks live in tests/imageMode.test.ts; the
 * "examples validate clean" sweep lives in tests/roundtrip.test.ts — neither
 * is duplicated here.
 */

const issuesOf = (raw: Record<string, any>): ValidationIssue[] =>
  validateProjectDoc(importProject(raw).doc)

const at = (issues: ValidationIssue[], path: string) =>
  issues.filter((i) => i.path === path)

/** resolution preset avoids the custom-resolution warning polluting results */
const base = (extra: Record<string, any> = {}) => ({ resolution: 'hd', ...extra })

const text = (fields: Record<string, any> = {}) => ({
  type: 'TEXT',
  text: 'hi',
  ...fields,
})

/* ------------------------------------------------------------------ */
/* visual source / type checks                                         */
/* ------------------------------------------------------------------ */

describe('visual source and type checks', () => {
  it('flags an unknown visual type that slipped past the importer', () => {
    const { doc } = importProject(base({ visuals: [text()] }))
    ;(doc.visuals[0] as any).type = 'BOGUS'
    const issues = at(validateProjectDoc(doc), 'visuals[0]')
    expect(issues).toEqual([
      {
        level: 'error',
        path: 'visuals[0]',
        message:
          'Unknown visual type "BOGUS" — must map to VIDEO, IMAGE, GIF, TEXT or SVG.',
      },
    ])
  })

  it('VIDEO / IMAGE / GIF without src are errors', () => {
    const issues = issuesOf(
      base({ visuals: [{ type: 'VIDEO' }, { type: 'IMAGE' }, { type: 'GIF' }] })
    )
    for (const [i, type] of (['VIDEO', 'IMAGE', 'GIF'] as const).entries()) {
      expect(at(issues, `visuals[${i}]`)).toContainEqual({
        level: 'error',
        path: `visuals[${i}]`,
        message: `${type} item is missing "src".`,
      })
    }
  })

  it('SVG without markup is an error', () => {
    const issues = issuesOf(base({ visuals: [{ type: 'SVG' }] }))
    expect(at(issues, 'visuals[0]')).toEqual([
      { level: 'error', path: 'visuals[0]', message: 'SVG item is missing "svg" markup.' },
    ])
  })

  it('TEXT with neither text nor html only warns', () => {
    const issues = issuesOf(base({ visuals: [{ type: 'TEXT' }] }))
    expect(at(issues, 'visuals[0]')).toEqual([
      {
        level: 'warning',
        path: 'visuals[0]',
        message: 'TEXT item has neither "text" nor "html" — it will render empty.',
      },
    ])
  })

  it('local-path src warns; remote, data: and {{var}} sources do not', () => {
    const issues = issuesOf(
      base({
        visuals: [
          { type: 'IMAGE', src: 'C:\\media\\a.png' },
          { type: 'IMAGE', src: 'https://cdn.zvid.io/a.png' },
          { type: 'IMAGE', src: 'data:image/png;base64,AA==' },
          { type: 'IMAGE', src: '{{heroImage}}' },
        ],
      })
    )
    expect(at(issues, 'visuals[0].src')).toEqual([
      {
        level: 'warning',
        path: 'visuals[0].src',
        message:
          '"C:\\media\\a.png" is a local path — it must exist on the machine that runs the render.',
      },
    ])
    expect(at(issues, 'visuals[1].src')).toEqual([])
    expect(at(issues, 'visuals[2].src')).toEqual([])
    expect(at(issues, 'visuals[3].src')).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* timing order                                                        */
/* ------------------------------------------------------------------ */

describe('visual timing-order rules', () => {
  it('enterEnd before enterBegin is an error', () => {
    const issues = issuesOf(base({ visuals: [text({ enterBegin: 3, enterEnd: 1 })] }))
    expect(at(issues, 'visuals[0]')).toContainEqual({
      level: 'error',
      path: 'visuals[0]',
      message: 'enterEnd (1) is before enterBegin (3).',
    })
  })

  it('exitBegin after exitEnd is an error', () => {
    const issues = issuesOf(base({ visuals: [text({ exitBegin: 8, exitEnd: 5 })] }))
    expect(at(issues, 'visuals[0]')).toContainEqual({
      level: 'error',
      path: 'visuals[0]',
      message: 'exitBegin (8) is after exitEnd (5).',
    })
  })

  it('a window that never shows (exitEnd ≤ enterBegin) is an error', () => {
    const issues = issuesOf(
      base({ duration: 10, visuals: [text({ enterBegin: 5, exitEnd: 3 })] })
    )
    expect(at(issues, 'visuals[0]')).toContainEqual({
      level: 'error',
      path: 'visuals[0]',
      message: 'Item is never visible: exitEnd (3) ≤ enterBegin (5).',
    })
  })

  it('enterBegin beyond the timeline is only a warning', () => {
    const issues = issuesOf(
      base({ duration: 10, visuals: [text({ enterBegin: 12, exitEnd: 15 })] })
    )
    expect(at(issues, 'visuals[0]')).toEqual([
      {
        level: 'warning',
        path: 'visuals[0]',
        message: 'enterBegin (12s) is beyond the timeline duration (10s).',
      },
    ])
  })

  it('placeholder timing is exempt from ordering checks', () => {
    const issues = issuesOf(
      base({
        visuals: [
          text({ enterBegin: '{{start}}', enterEnd: 1 }),
          text({ exitBegin: '{{late}}', exitEnd: 2 }),
        ],
      })
    )
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* animations / transitions (xfade whitelist)                          */
/* ------------------------------------------------------------------ */

describe('xfade effect whitelist', () => {
  it('unknown enter/exit animation names are errors on their own paths', () => {
    const issues = issuesOf(
      base({
        visuals: [text({ enterAnimation: 'sparkle', exitAnimation: 'wobble' })],
      })
    )
    expect(at(issues, 'visuals[0].enterAnimation')).toEqual([
      {
        level: 'error',
        path: 'visuals[0].enterAnimation',
        message: 'Unknown animation "sparkle". Must be one of the FFmpeg xfade effects.',
      },
    ])
    expect(at(issues, 'visuals[0].exitAnimation')).toEqual([
      {
        level: 'error',
        path: 'visuals[0].exitAnimation',
        message: 'Unknown animation "wobble". Must be one of the FFmpeg xfade effects.',
      },
    ])
  })

  it('whitelisted names with real windows pass clean', () => {
    const issues = issuesOf(
      base({
        duration: 10,
        visuals: [
          text({
            enterAnimation: 'circlecrop',
            enterBegin: 0,
            enterEnd: 1,
            exitAnimation: 'fadegrays',
            exitBegin: 9,
            exitEnd: 10,
          }),
        ],
      })
    )
    expect(issues).toEqual([])
  })

  it('an enterAnimation without a window warns (enterEnd defaults to enterBegin)', () => {
    const issues = issuesOf(base({ visuals: [text({ enterAnimation: 'fade' })] }))
    expect(at(issues, 'visuals[0]')).toEqual([
      {
        level: 'warning',
        path: 'visuals[0]',
        message: 'enterAnimation "fade" has a zero-length window (set enterEnd > enterBegin).',
      },
    ])
  })

  it('an exitAnimation without a window warns (exitBegin defaults to exitEnd)', () => {
    const issues = issuesOf(base({ visuals: [text({ exitAnimation: 'fade' })] }))
    expect(at(issues, 'visuals[0]')).toEqual([
      {
        level: 'warning',
        path: 'visuals[0]',
        message: 'exitAnimation "fade" has a zero-length window (set exitBegin < exitEnd).',
      },
    ])
  })

  it('exitAnimation + linked transition on the same video warns (renderer suppresses the exit)', () => {
    const issues = issuesOf(
      base({
        duration: 10,
        visuals: [
          {
            type: 'VIDEO',
            src: 'https://x/v.mp4',
            exitAnimation: 'fade',
            exitBegin: 8,
            exitEnd: 10,
            transition: 'wipeleft',
            transitionId: 'next-clip',
          },
        ],
      })
    )
    expect(at(issues, 'visuals[0]')).toEqual([
      {
        level: 'warning',
        path: 'visuals[0]',
        message:
          'This video has both an exitAnimation and a transition — the renderer suppresses the exit animation when a transition is set.',
      },
    ])
  })

  it('an unknown per-video transition is an error', () => {
    const issues = issuesOf(
      base({ visuals: [{ type: 'VIDEO', src: 'https://x/v.mp4', transition: 'swoosh' }] })
    )
    expect(at(issues, 'visuals[0].transition')).toEqual([
      { level: 'error', path: 'visuals[0].transition', message: 'Unknown transition "swoosh".' },
    ])
  })
})

/* ------------------------------------------------------------------ */
/* customCode + designer                                               */
/* ------------------------------------------------------------------ */

describe('customCode rules', () => {
  it('animationDuration above the 15s ceiling is an error', () => {
    const issues = issuesOf(
      base({ visuals: [text({ customCode: { animationDuration: 20 } })] })
    )
    expect(at(issues, 'visuals[0].customCode.animationDuration')).toEqual([
      {
        level: 'error',
        path: 'visuals[0].customCode.animationDuration',
        message: `animationDuration must be ≤ ${MAX_CUSTOM_CODE_ANIMATION_DURATION}s (got 20).`,
      },
    ])
  })

  it('non-positive animationDuration is an error; exactly 15 is fine', () => {
    const zero = issuesOf(base({ visuals: [text({ customCode: { animationDuration: 0 } })] }))
    expect(at(zero, 'visuals[0].customCode.animationDuration')).toEqual([
      {
        level: 'error',
        path: 'visuals[0].customCode.animationDuration',
        message: 'animationDuration must be positive.',
      },
    ])
    const max = issuesOf(
      base({ visuals: [text({ customCode: { animationDuration: 15 } })] })
    )
    expect(at(max, 'visuals[0].customCode.animationDuration')).toEqual([])
  })

  it('network/storage APIs in customCode.js warn', () => {
    const issues = issuesOf(
      base({ visuals: [text({ customCode: { js: 'fetch("https://evil")' } })] })
    )
    expect(at(issues, 'visuals[0].customCode.js')).toEqual([
      {
        level: 'warning',
        path: 'visuals[0].customCode.js',
        message:
          'customCode.js appears to use network/storage/navigation APIs — the renderer rejects those at render time.',
      },
    ])
    const benign = issuesOf(
      base({ visuals: [text({ customCode: { js: 'el.style.opacity = 0.5' } })] })
    )
    expect(at(benign, 'visuals[0].customCode.js')).toEqual([])
  })

  it('design elements longer than the 15s cap warn; {{var}} edges are exempt', () => {
    const capped = issuesOf(
      base({
        duration: 30,
        visuals: [text({ designer: { version: 1 }, enterBegin: 0, exitEnd: 20 })],
      })
    )
    expect(at(capped, 'visuals[0]')).toEqual([
      {
        level: 'warning',
        path: 'visuals[0]',
        message: `Design studio elements can stay on screen for at most ${MAX_DESIGN_ELEMENT_DURATION}s (this one runs 20s) — the animation freezes past that; shorten the element's window.`,
      },
    ])
    const varred = issuesOf(
      base({
        duration: 30,
        visuals: [text({ designer: { version: 1 }, enterBegin: 0, exitEnd: '{{end}}' })],
      })
    )
    expect(at(varred, 'visuals[0]')).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* video-branch checks                                                 */
/* ------------------------------------------------------------------ */

describe('VIDEO-only field rules', () => {
  const video = (fields: Record<string, any>) => ({
    type: 'VIDEO',
    src: 'https://x/v.mp4',
    ...fields,
  })

  it('negative volume and non-positive speed are errors', () => {
    const issues = issuesOf(base({ visuals: [video({ volume: -1, speed: 0 })] }))
    const errs = at(issues, 'visuals[0]')
    expect(errs).toContainEqual({
      level: 'error',
      path: 'visuals[0]',
      message: 'volume must be ≥ 0.',
    })
    expect(errs).toContainEqual({
      level: 'error',
      path: 'visuals[0]',
      message: 'speed must be > 0.',
    })
  })

  it('videoEnd at or before videoBegin is an error', () => {
    const issues = issuesOf(base({ visuals: [video({ videoBegin: 5, videoEnd: 5 })] }))
    expect(at(issues, 'visuals[0]')).toContainEqual({
      level: 'error',
      path: 'visuals[0]',
      message: 'videoEnd (5) must be after videoBegin (5).',
    })
  })

  it('placeholder videoBegin/videoEnd are exempt', () => {
    const issues = issuesOf(
      base({ visuals: [video({ videoBegin: '{{in}}', videoEnd: 2 })] })
    )
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
  })

  it('the same fields on an IMAGE are not checked (video branch only)', () => {
    const issues = issuesOf(
      base({ visuals: [{ type: 'IMAGE', src: 'https://x/a.png', volume: -5, speed: 0 }] })
    )
    expect(issues).toEqual([])
  })

  it('opacity outside 0..1 is an error on any visual', () => {
    const issues = issuesOf(base({ visuals: [text({ opacity: 1.5 })] }))
    expect(at(issues, 'visuals[0].opacity')).toEqual([
      {
        level: 'error',
        path: 'visuals[0].opacity',
        message: 'opacity must be between 0 and 1 (got 1.5).',
      },
    ])
  })
})

/* ------------------------------------------------------------------ */
/* project-level checks                                                */
/* ------------------------------------------------------------------ */

describe('project-level rules', () => {
  it('a bogus project type is an error', () => {
    const issues = issuesOf(base({ type: 'gifzz' }))
    expect(at(issues, 'type')).toEqual([
      { level: 'error', path: 'type', message: 'Project type must be "video" or "image" (got "gifzz").' },
    ])
  })

  it('video output format whitelist: bad name errors, case is ignored', () => {
    expect(at(issuesOf(base({ outputFormat: 'gif' })), 'outputFormat')[0]?.level).toBe(
      'error'
    )
    expect(at(issuesOf(base({ outputFormat: 'MOV' })), 'outputFormat')).toEqual([])
    expect(at(issuesOf(base({ outputFormat: 'webm' })), 'outputFormat')).toEqual([])
  })

  it('transparent on a video project is an error (image-only knob)', () => {
    const issues = issuesOf(base({ transparent: true }))
    expect(at(issues, 'transparent')).toEqual([
      {
        level: 'error',
        path: 'transparent',
        message: '"transparent" is only applicable to image renders (type: "image").',
      },
    ])
  })

  it('non-positive duration is an error', () => {
    expect(at(issuesOf(base({ duration: 0 })), 'duration')).toEqual([
      { level: 'error', path: 'duration', message: 'duration must be > 0.' },
    ])
  })

  it('frameRate outside 1..120 is an error; 120 is allowed', () => {
    expect(at(issuesOf(base({ frameRate: 0 })), 'frameRate')[0]?.level).toBe('error')
    expect(at(issuesOf(base({ frameRate: 121 })), 'frameRate')[0]?.level).toBe('error')
    expect(at(issuesOf(base({ frameRate: 120 })), 'frameRate')).toEqual([])
  })

  it('custom/absent resolution without explicit dimensions warns', () => {
    expect(at(issuesOf({}), 'resolution')[0]?.level).toBe('warning')
    expect(at(issuesOf({ resolution: 'custom', width: 100 }), 'resolution')[0]?.level).toBe(
      'warning'
    )
    expect(at(issuesOf({ resolution: 'custom', width: 100, height: 100 }), 'resolution')).toEqual(
      []
    )
  })

  it('non-hex backgroundColor warns; 3/6/8-digit hex passes', () => {
    expect(at(issuesOf(base({ backgroundColor: 'red' })), 'backgroundColor')[0]?.level).toBe(
      'warning'
    )
    for (const ok of ['#abc', '#aabbcc', '#aabbccdd']) {
      expect(at(issuesOf(base({ backgroundColor: ok })), 'backgroundColor')).toEqual([])
    }
  })
})

/* ------------------------------------------------------------------ */
/* audio checks                                                        */
/* ------------------------------------------------------------------ */

describe('audio rules', () => {
  it('empty src is an error (and skips the local-path warning)', () => {
    const issues = issuesOf(base({ audios: [{ src: '' }] }))
    expect(at(issues, 'audios[0]')).toEqual([
      { level: 'error', path: 'audios[0]', message: 'Audio item is missing "src".' },
    ])
    expect(at(issues, 'audios[0].src')).toEqual([])
  })

  it('local-path src warns', () => {
    const issues = issuesOf(base({ audios: [{ src: './music.mp3' }] }))
    expect(at(issues, 'audios[0].src')).toEqual([
      {
        level: 'warning',
        path: 'audios[0].src',
        message: '"./music.mp3" is a local path — it must exist on the render machine.',
      },
    ])
  })

  it('a {{placeholder}} src is NOT flagged as a local path (bugfix 2026-07-09)', () => {
    // resolves at render time — same exemption the visuals check has
    const issues = issuesOf(base({ audios: [{ src: '{{musicUrl}}' }] }))
    expect(at(issues, 'audios[0].src')).toEqual([])
    const mixed = issuesOf(base({ audios: [{ src: '{{cdnBase}}/music.mp3' }] }))
    expect(at(mixed, 'audios[0].src')).toEqual([])
  })

  it('exit at or before enter is an error; {{var}} is exempt', () => {
    const issues = issuesOf(
      base({ audios: [{ src: 'https://x/a.mp3', enter: 5, exit: 5 }] })
    )
    expect(at(issues, 'audios[0]')).toEqual([
      { level: 'error', path: 'audios[0]', message: 'exit (5) must be after enter (5).' },
    ])
    const varred = issuesOf(
      base({ audios: [{ src: 'https://x/a.mp3', enter: 5, exit: '{{end}}' }] })
    )
    expect(at(varred, 'audios[0]')).toEqual([])
  })

  it('audioEnd at or before audioBegin is an error (audioBegin defaults to 0)', () => {
    const issues = issuesOf(
      base({
        audios: [
          { src: 'https://x/a.mp3', audioBegin: 4, audioEnd: 4 },
          { src: 'https://x/b.mp3', audioEnd: 0 },
        ],
      })
    )
    expect(at(issues, 'audios[0]')).toEqual([
      { level: 'error', path: 'audios[0]', message: 'audioEnd (4) must be after audioBegin (4).' },
    ])
    expect(at(issues, 'audios[1]')).toEqual([
      { level: 'error', path: 'audios[1]', message: 'audioEnd (0) must be after audioBegin (0).' },
    ])
  })
})

/* ------------------------------------------------------------------ */
/* scene checks                                                        */
/* ------------------------------------------------------------------ */

describe('scene rules', () => {
  it('scene duration 0 or negative (≠ -1) is an error; -1 and {{var}} are fine', () => {
    const issues = issuesOf(
      base({
        scenes: [
          { id: 'a', duration: 0 },
          { id: 'b', duration: -5 },
          { id: 'c', duration: -1 },
          { id: 'd', duration: '{{len}}' },
        ],
      })
    )
    expect(at(issues, 'scenes[0]')).toEqual([
      {
        level: 'error',
        path: 'scenes[0]',
        message: 'Scene duration must be positive or -1 for auto (got 0).',
      },
    ])
    expect(at(issues, 'scenes[1]')[0]?.level).toBe('error')
    expect(at(issues, 'scenes[2]')).toEqual([])
    expect(at(issues, 'scenes[3]')).toEqual([])
  })

  it('a non-placeholder string duration is an error', () => {
    const { doc } = importProject(base({ scenes: [{ id: 'a', duration: 5 }] }))
    ;(doc.scenes![0] as any).duration = 'ten'
    const issues = at(validateProjectDoc(doc), 'scenes[0]')
    expect(issues).toEqual([
      {
        level: 'error',
        path: 'scenes[0]',
        message: 'Scene duration must be a number, -1 for auto, or a {{placeholder}} (got "ten").',
      },
    ])
  })

  it('an unknown scene transition is an error', () => {
    const issues = issuesOf(
      base({ scenes: [{ id: 'a', duration: 2, transition: 'melt' }, { id: 'b', duration: 2 }] })
    )
    expect(at(issues, 'scenes[0].transition')).toEqual([
      { level: 'error', path: 'scenes[0].transition', message: 'Unknown transition "melt".' },
    ])
  })

  it('a transition on the last scene warns (renderer ignores it)', () => {
    const issues = issuesOf(base({ scenes: [{ id: 'a', duration: 2, transition: 'fade' }] }))
    expect(at(issues, 'scenes[0]')).toEqual([
      {
        level: 'warning',
        path: 'scenes[0]',
        message: 'Last scene defines a transition — the renderer ignores it.',
      },
    ])
  })

  it('a transitionId not matching the next scene id warns of a hard cut', () => {
    const issues = issuesOf(
      base({
        scenes: [
          { id: 'a', duration: 2, transition: 'fade', transitionId: 'zzz' },
          { id: 'b', duration: 2 },
        ],
      })
    )
    expect(at(issues, 'scenes[0].transitionId')).toEqual([
      {
        level: 'warning',
        path: 'scenes[0].transitionId',
        message:
          'transitionId "zzz" doesn\'t match the next scene\'s id "b" — the renderer falls back to a hard cut.',
      },
    ])
    // matching id and "none" both stay silent
    for (const tid of ['b', 'none']) {
      const ok = issuesOf(
        base({
          scenes: [
            { id: 'a', duration: 2, transition: 'fade', transitionId: tid },
            { id: 'b', duration: 2 },
          ],
        })
      )
      expect(at(ok, 'scenes[0].transitionId')).toEqual([])
    }
  })

  it('non-positive transitionDuration is an error', () => {
    const issues = issuesOf(
      base({
        scenes: [
          { id: 'a', duration: 2, transition: 'fade', transitionDuration: 0 },
          { id: 'b', duration: 2 },
        ],
      })
    )
    expect(at(issues, 'scenes[0].transitionDuration')).toEqual([
      {
        level: 'error',
        path: 'scenes[0].transitionDuration',
        message: 'transitionDuration must be greater than 0.',
      },
    ])
  })

  it('duplicate scene ids are flagged on every duplicate', () => {
    const issues = issuesOf(
      base({ scenes: [{ id: 'dup', duration: 2 }, { id: 'dup', duration: 2 }] })
    )
    expect(at(issues, 'scenes[0].id')).toEqual([
      { level: 'error', path: 'scenes[0].id', message: 'Duplicate scene id "dup".' },
    ])
    expect(at(issues, 'scenes[1].id')).toEqual([
      { level: 'error', path: 'scenes[1].id', message: 'Duplicate scene id "dup".' },
    ])
  })

  it('a design element without exitEnd inside an auto scene warns (cap unverifiable)', () => {
    const issues = issuesOf(
      base({
        scenes: [
          {
            id: 'a',
            duration: -1,
            visuals: [{ type: 'TEXT', text: 'x', designer: { version: 1 } }],
          },
        ],
      })
    )
    expect(at(issues, 'scenes[0].visuals[0]')).toEqual([
      {
        level: 'warning',
        path: 'scenes[0].visuals[0]',
        message: `Design studio element has no explicit end inside an auto-duration scene — the ${MAX_DESIGN_ELEMENT_DURATION}s cap cannot be verified; set "exitEnd".`,
      },
    ])
    // an explicit scene duration removes the warning
    const fixed = issuesOf(
      base({
        scenes: [
          {
            id: 'a',
            duration: 8,
            visuals: [{ type: 'TEXT', text: 'x', designer: { version: 1 } }],
          },
        ],
      })
    )
    expect(at(fixed, 'scenes[0].visuals[0]')).toEqual([])
  })

  it('root visuals of a scene project resolve timing against the scenes total', () => {
    const scenes = [
      { id: 'a', duration: 20 },
      { id: 'b', duration: 15 },
    ]
    // rootDuration = max(10, 20 + 15) = 35 → enterBegin 25 is fine…
    const inside = issuesOf(
      base({ scenes, visuals: [{ type: 'TEXT', text: 'x', enterBegin: 25 }] })
    )
    expect(at(inside, 'visuals[0]')).toEqual([])
    // …but 40 is past the whole movie
    const outside = issuesOf(
      base({ scenes, visuals: [{ type: 'TEXT', text: 'x', enterBegin: 40, exitEnd: 45 }] })
    )
    expect(at(outside, 'visuals[0]')).toEqual([
      {
        level: 'warning',
        path: 'visuals[0]',
        message: 'enterBegin (40s) is beyond the timeline duration (35s).',
      },
    ])
  })
})

/* ------------------------------------------------------------------ */
/* subtitles                                                           */
/* ------------------------------------------------------------------ */

describe('subtitle rules', () => {
  it('caption end at or before start is an error', () => {
    const issues = issuesOf(
      base({ subtitle: { captions: [{ start: 2, end: 1, text: '' }] } })
    )
    expect(at(issues, 'subtitle.captions[0]')).toEqual([
      {
        level: 'error',
        path: 'subtitle.captions[0]',
        message: 'Caption end (1) must be after start (2).',
      },
    ])
  })

  it('a word outside its caption bounds warns; the 1ms tolerance is honored', () => {
    const issues = issuesOf(
      base({
        subtitle: {
          captions: [
            {
              start: 1,
              end: 2,
              text: 'hi there',
              words: [
                { start: 0.5, end: 1.5, text: 'hi' }, // starts before the caption
                { start: 0.9995, end: 2.0005, text: 'there' }, // inside tolerance
              ],
            },
          ],
        },
      })
    )
    expect(at(issues, 'subtitle.captions[0].words[0]')).toEqual([
      {
        level: 'warning',
        path: 'subtitle.captions[0].words[0]',
        message: 'Word "hi" (0.5–1.5) is outside its caption bounds (1–2).',
      },
    ])
    expect(at(issues, 'subtitle.captions[0].words[1]')).toEqual([])
  })

  it('a word that ends before it starts is an error', () => {
    const issues = issuesOf(
      base({
        subtitle: {
          captions: [
            { start: 1, end: 2, text: 'x', words: [{ start: 1.5, end: 1.2, text: 'x' }] },
          ],
        },
      })
    )
    expect(at(issues, 'subtitle.captions[0].words[0]')).toEqual([
      {
        level: 'error',
        path: 'subtitle.captions[0].words[0]',
        message: 'Word "x" ends before it starts.',
      },
    ])
  })
})
