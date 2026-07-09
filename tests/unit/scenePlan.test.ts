import { describe, it, expect } from 'vitest'
import {
  computeSceneAutoDuration,
  buildScenePlan,
  projectTotalDuration,
  type ProbeDurationFn,
} from '../../shared/schema/scenePlan'
import {
  DEFAULT_SCENE_DURATION,
  DEFAULT_SCENE_TRANSITION_DURATION,
} from '../../shared/schema/constants'
import { importProject } from '../../shared/schema/normalize'
import type { SceneDoc } from '../../shared/schema/types'

/** Probe cache stub: url → duration. */
const probe =
  (map: Record<string, number> = {}): ProbeDurationFn =>
  (src) =>
    map[src]

const noProbe = probe({})

/** Build a real SceneDoc through the importer (ids, _ids, arrays normalized). */
function scene(raw: Record<string, any>): SceneDoc {
  const { doc } = importProject({ scenes: [raw] })
  return doc.scenes![0]
}

function docWith(raw: Record<string, any>) {
  return importProject(raw).doc
}

/* ------------------------------------------------------------------ */
/* computeSceneAutoDuration                                            */
/* ------------------------------------------------------------------ */

describe('computeSceneAutoDuration', () => {
  it('empty scene falls back to the default scene duration', () => {
    expect(computeSceneAutoDuration(scene({}), noProbe)).toBe(DEFAULT_SCENE_DURATION)
    expect(DEFAULT_SCENE_DURATION).toBe(10)
  })

  it('uses a visual explicit exitEnd as a candidate (rounded to 2 decimals)', () => {
    const s = scene({ visuals: [{ type: 'TEXT', text: 'x', exitEnd: 7.523 }] })
    expect(computeSceneAutoDuration(s, noProbe)).toBe(7.52)
  })

  it('non-VIDEO visuals without exitEnd contribute nothing', () => {
    const s = scene({
      visuals: [
        { type: 'TEXT', text: 'x' },
        { type: 'IMAGE', src: 'https://x/a.png' },
      ],
    })
    expect(computeSceneAutoDuration(s, noProbe)).toBe(DEFAULT_SCENE_DURATION)
  })

  it('VIDEO without exitEnd derives length from probe: enterBegin + (end - begin)/speed', () => {
    const s = scene({
      visuals: [
        {
          type: 'VIDEO',
          src: 'https://x/v.mp4',
          enterBegin: 1,
          videoBegin: 2,
          speed: 2,
        },
      ],
    })
    // 1 + (8 - 2) / 2 = 4
    expect(computeSceneAutoDuration(s, probe({ 'https://x/v.mp4': 8 }))).toBe(4)
  })

  it('VIDEO with an explicit videoEnd does not need the probe', () => {
    const s = scene({
      visuals: [{ type: 'VIDEO', src: 'https://x/v.mp4', videoBegin: 1, videoEnd: 6 }],
    })
    const neverProbe: ProbeDurationFn = () => {
      throw new Error('probe should not be needed')
    }
    // NOTE: probe IS still called lazily only when videoEnd is missing — with
    // videoEnd present the ?? short-circuits, so this must not throw
    expect(computeSceneAutoDuration(s, neverProbe)).toBe(5)
  })

  it('VIDEO whose duration cannot be probed is skipped', () => {
    const s = scene({ visuals: [{ type: 'VIDEO', src: 'https://x/unknown.mp4' }] })
    expect(computeSceneAutoDuration(s, noProbe)).toBe(DEFAULT_SCENE_DURATION)
  })

  it('a visual explicit exitEnd wins over its own video math (continue)', () => {
    const s = scene({
      visuals: [
        { type: 'VIDEO', src: 'https://x/v.mp4', exitEnd: 3, videoBegin: 0, videoEnd: 99 },
      ],
    })
    expect(computeSceneAutoDuration(s, noProbe)).toBe(3)
  })

  it('audio explicit exit is a candidate', () => {
    const s = scene({ audios: [{ src: 'https://x/a.mp3', exit: 9 }] })
    expect(computeSceneAutoDuration(s, noProbe)).toBe(9)
  })

  it('audio without exit derives enter + (audioEnd - audioBegin)/speed', () => {
    const s = scene({
      audios: [{ src: 'https://x/a.mp3', enter: 0.5, audioBegin: 1, audioEnd: 7, speed: 2 }],
    })
    expect(computeSceneAutoDuration(s, noProbe)).toBe(3.5)
  })

  it('audio without audioEnd falls back to the probed source duration', () => {
    const s = scene({ audios: [{ src: 'https://x/a.mp3', enter: 1 }] })
    expect(computeSceneAutoDuration(s, probe({ 'https://x/a.mp3': 12 }))).toBe(13)
  })

  it('takes the max across all visual and audio candidates', () => {
    const s = scene({
      visuals: [
        { type: 'TEXT', text: 'x', exitEnd: 4 },
        { type: 'VIDEO', src: 'https://x/v.mp4' },
      ],
      audios: [{ src: 'https://x/a.mp3', exit: 5.107 }],
    })
    expect(
      computeSceneAutoDuration(s, probe({ 'https://x/v.mp4': 6.001 }))
    ).toBe(6) // round2(max(4, 6.001, 5.107))
  })
})

/* ------------------------------------------------------------------ */
/* buildScenePlan                                                      */
/* ------------------------------------------------------------------ */

describe('buildScenePlan', () => {
  it('returns an empty plan for a project without scenes', () => {
    const plan = buildScenePlan(docWith({ visuals: [] }), noProbe)
    expect(plan.entries).toEqual([])
    expect(plan.totalScenesDuration).toBe(0)
  })

  it('scenes overlap by transitionDuration when the transition chain is valid', () => {
    const doc = docWith({
      scenes: [
        {
          id: 'a',
          duration: 5,
          transition: 'fade',
          transitionId: 'b',
          transitionDuration: 1,
        },
        { id: 'b', duration: 4 },
      ],
    })
    const plan = buildScenePlan(doc, noProbe)
    expect(plan.entries[0].start).toBe(0)
    expect(plan.entries[0].transition).toBe('fade')
    expect(plan.entries[0].transitionDuration).toBe(1)
    expect(plan.entries[1].start).toBe(4) // 5 - 1 overlap
    expect(plan.totalScenesDuration).toBe(8)
  })

  it('missing transitionDuration falls back to the 0.5s default', () => {
    const doc = docWith({
      scenes: [
        { id: 'a', duration: 5, transition: 'wipeleft', transitionId: 'b' },
        { id: 'b', duration: 4 },
      ],
    })
    const plan = buildScenePlan(doc, noProbe)
    expect(DEFAULT_SCENE_TRANSITION_DURATION).toBe(0.5)
    expect(plan.entries[0].transitionDuration).toBe(0.5)
    expect(plan.entries[1].start).toBe(4.5)
    expect(plan.totalScenesDuration).toBe(8.5)
  })

  it('a transitionId that does not match the next scene id becomes a hard cut', () => {
    const doc = docWith({
      scenes: [
        {
          id: 'a',
          duration: 5,
          transition: 'fade',
          transitionId: 'not-b',
          transitionDuration: 1,
        },
        { id: 'b', duration: 4 },
      ],
    })
    const plan = buildScenePlan(doc, noProbe)
    expect(plan.entries[0].transition).toBeNull()
    expect(plan.entries[0].transitionDuration).toBe(0)
    expect(plan.entries[1].start).toBe(5) // no overlap
    expect(plan.totalScenesDuration).toBe(9)
  })

  it('transitionId of undefined, null or "none" all still point to the next scene', () => {
    for (const tid of [undefined, null, 'none'] as const) {
      const doc = docWith({
        scenes: [
          { id: 'a', duration: 5, transition: 'fade', transitionId: tid, transitionDuration: 1 },
          { id: 'b', duration: 4 },
        ],
      })
      const plan = buildScenePlan(doc, noProbe)
      expect(plan.entries[0].transition).toBe('fade')
      expect(plan.entries[1].start).toBe(4)
    }
  })

  it('a transition on the last scene is dropped', () => {
    const doc = docWith({
      scenes: [{ id: 'only', duration: 6, transition: 'fade', transitionDuration: 2 }],
    })
    const plan = buildScenePlan(doc, noProbe)
    expect(plan.entries[0].transition).toBeNull()
    expect(plan.entries[0].transitionDuration).toBe(0)
    expect(plan.totalScenesDuration).toBe(6)
  })

  it('duration -1, 0 and undefined all resolve through auto-duration', () => {
    for (const duration of [-1, 0, undefined]) {
      const doc = docWith({
        scenes: [
          { id: 'a', duration, visuals: [{ type: 'TEXT', text: 'x', exitEnd: 3 }] },
        ],
      })
      const plan = buildScenePlan(doc, noProbe)
      expect(plan.entries[0].duration).toBe(3)
    }
  })

  it('a "{{placeholder}}" duration plans as auto so the timeline stays finite', () => {
    const doc = docWith({
      scenes: [
        {
          id: 'a',
          duration: '{{sceneLength}}',
          visuals: [{ type: 'TEXT', text: 'x', exitEnd: 2 }],
        },
        { id: 'b', duration: 4 },
      ],
    })
    const plan = buildScenePlan(doc, noProbe)
    expect(plan.entries[0].duration).toBe(2)
    expect(plan.entries[1].start).toBe(2)
  })

  it('auto durations feed the probe cache through to start offsets', () => {
    const doc = docWith({
      scenes: [
        {
          id: 'a',
          duration: -1,
          transition: 'fade',
          transitionId: 'b',
          transitionDuration: 0.5,
          visuals: [{ type: 'VIDEO', src: 'https://x/v.mp4' }],
        },
        { id: 'b', duration: 3 },
      ],
    })
    const plan = buildScenePlan(doc, probe({ 'https://x/v.mp4': 6 }))
    expect(plan.entries[0].duration).toBe(6)
    expect(plan.entries[1].start).toBe(5.5)
    expect(plan.totalScenesDuration).toBe(8.5)
  })

  it('start offsets accumulate and are rounded to 2 decimals', () => {
    const doc = docWith({
      scenes: [
        { id: 'a', duration: 1.333 },
        { id: 'b', duration: 2.333 },
        { id: 'c', duration: 3 },
      ],
    })
    const plan = buildScenePlan(doc, noProbe)
    // round2 applies at each step: 1.333→1.33, then 1.33+2.333=3.663→3.66
    expect(plan.entries.map((e) => e.start)).toEqual([0, 1.33, 3.66])
    expect(plan.totalScenesDuration).toBe(6.66)
  })

  it('backgroundColor resolves scene → project → #ffffff', () => {
    const doc = docWith({
      backgroundColor: '#111111',
      scenes: [{ id: 'a', duration: 1, backgroundColor: '#222222' }, { id: 'b', duration: 1 }],
    })
    const plan = buildScenePlan(doc, noProbe)
    expect(plan.entries[0].backgroundColor).toBe('#222222')
    expect(plan.entries[1].backgroundColor).toBe('#111111')

    const bare = docWith({ scenes: [{ id: 'a', duration: 1 }] })
    expect(buildScenePlan(bare, noProbe).entries[0].backgroundColor).toBe('#ffffff')
  })
})

/* ------------------------------------------------------------------ */
/* projectTotalDuration                                                */
/* ------------------------------------------------------------------ */

describe('projectTotalDuration', () => {
  it('non-scene projects use the root duration (default 10)', () => {
    expect(projectTotalDuration(docWith({ duration: 7 }), noProbe)).toBe(7)
    expect(projectTotalDuration(docWith({}), noProbe)).toBe(10)
  })

  it('scene projects without a root duration run exactly the scenes total (bugfix 2026-07-09)', () => {
    // Mirrors package buildSyntheticProject: the 10s default duration never
    // applies to scene projects — no more phantom trailing dead time.
    const short = docWith({ scenes: [{ id: 'a', duration: 4 }] })
    expect(projectTotalDuration(short, noProbe)).toBe(4)

    const long = docWith({
      scenes: [
        { id: 'a', duration: 12 },
        { id: 'b', duration: 13 },
      ],
    })
    expect(projectTotalDuration(long, noProbe)).toBe(25)
  })

  it('an explicit root duration wins when ≥ the scenes total, else the total', () => {
    const doc = docWith({
      duration: 30,
      scenes: [
        { id: 'a', duration: 5 },
        { id: 'b', duration: 7 },
      ],
    })
    expect(projectTotalDuration(doc, noProbe)).toBe(30)

    // shorter than the scenes total → package warns and extends to fit
    expect(projectTotalDuration({ ...doc, duration: 8 }, noProbe)).toBe(12)
  })

  it('scene overlap from transitions shortens the total', () => {
    const doc = docWith({
      scenes: [
        { id: 'a', duration: 8, transition: 'fade', transitionId: 'b', transitionDuration: 2 },
        { id: 'b', duration: 8 },
      ],
    })
    expect(projectTotalDuration(doc, noProbe)).toBe(14) // 8 + 8 - 2
  })
})
