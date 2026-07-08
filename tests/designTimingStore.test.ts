import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProjectStore } from '../stores/project'
import { MAX_DESIGN_ELEMENT_DURATION } from '../shared/schema/constants'
import { round3 } from '../utils/time'

// splitVisualAt uses the Nuxt-auto-imported round3; vitest has no auto-imports
;(globalThis as any).round3 = round3

/**
 * Integration coverage for the design-element 15s cap at the store level —
 * the same code paths the panels, timeline gestures and inspector go through.
 * Items pass an explicit `track` so the Nuxt-auto-imported track allocator
 * is never reached (vitest has no auto-imports).
 */

const DESIGNER = { version: 1, layers: [] }

function designItem(extra: Record<string, any> = {}) {
  return {
    type: 'TEXT',
    html: '<span>hi</span>',
    designer: DESIGNER,
    track: 0,
    ...extra,
  }
}

describe('project store — design element 15s cap', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('clamps an over-long design element on add', () => {
    const store = useProjectStore()
    const added = store.addVisual('root', designItem({ enterBegin: 0, exitEnd: 30 }))
    expect(added.exitEnd).toBe(MAX_DESIGN_ELEMENT_DURATION)
  })

  it('leaves non-design elements alone on add', () => {
    const store = useProjectStore()
    store.doc.duration = 60
    const added = store.addVisual('root', {
      type: 'TEXT',
      text: 'plain',
      track: 0,
      enterBegin: 0,
      exitEnd: 30,
    })
    expect(added.exitEnd).toBe(30)
  })

  it('clamps exitEnd patches (inspector / trim-r path)', () => {
    const store = useProjectStore()
    const added = store.addVisual('root', designItem({ enterBegin: 2, exitEnd: 7 }))
    store.patchVisual(added._id, { exitEnd: 40 })
    expect(store.visualById(added._id)!.exitEnd).toBe(2 + MAX_DESIGN_ELEMENT_DURATION)
  })

  it('pulls the start when only enterBegin is patched (trim-l path)', () => {
    const store = useProjectStore()
    const added = store.addVisual('root', designItem({ enterBegin: 20, exitEnd: 30 }))
    store.patchVisual(added._id, { enterBegin: 5 })
    const v = store.visualById(added._id)!
    expect(v.exitEnd).toBe(30)
    expect(v.enterBegin).toBe(30 - MAX_DESIGN_ELEMENT_DURATION)
  })

  it('re-bounds a cleared exitEnd in a long project', () => {
    const store = useProjectStore()
    store.doc.duration = 60
    const added = store.addVisual('root', designItem({ enterBegin: 0, exitEnd: 10 }))
    store.patchVisual(added._id, { exitEnd: undefined })
    expect(store.visualById(added._id)!.exitEnd).toBe(MAX_DESIGN_ELEMENT_DURATION)
  })

  it('pins a cleared exitEnd to the timeline end so later growth cannot stretch it', () => {
    const store = useProjectStore()
    store.doc.duration = 10
    const added = store.addVisual('root', designItem({ enterBegin: 0, exitEnd: 8 }))
    store.patchVisual(added._id, { exitEnd: undefined })
    expect(store.visualById(added._id)!.exitEnd).toBe(10)
  })

  it('re-clamps design elements when the project duration grows', () => {
    const store = useProjectStore()
    store.doc.duration = 10
    // legacy open-ended element injected without going through the clamp
    store.doc.visuals.push({
      _id: 'vis_open',
      type: 'TEXT',
      html: 'x',
      designer: DESIGNER,
      enterBegin: 0,
    } as any)
    store.patchProject({ duration: 60 })
    expect(store.visualById('vis_open')!.exitEnd).toBe(MAX_DESIGN_ELEMENT_DURATION)
  })

  it('re-clamps design elements when a scene duration grows', () => {
    const store = useProjectStore()
    store.doc.scenes = [
      {
        _id: 'scn_g',
        id: 'scene-0',
        duration: 8,
        visuals: [
          { _id: 'vis_scn', type: 'TEXT', html: 'x', designer: DESIGNER } as any,
        ],
        audios: [],
      } as any,
    ]
    store.patchScene('scn_g', { duration: 40 })
    expect(store.visualById('vis_scn')!.exitEnd).toBe(MAX_DESIGN_ELEMENT_DURATION)
  })

  it('splits over-long legacy design elements into capped, contiguous halves', () => {
    const store = useProjectStore()
    store.doc.duration = 60
    store.doc.visuals.push({
      _id: 'vis_split',
      type: 'TEXT',
      html: 'x',
      designer: DESIGNER,
      enterBegin: 0,
      exitEnd: 40,
    } as any)
    const right = store.splitVisualAt('vis_split', 20)!
    const left = store.visualById('vis_split')!
    // cut edge stays at 20s; each half obeys the cap
    expect(left.exitEnd).toBe(20)
    expect(left.enterBegin).toBe(20 - MAX_DESIGN_ELEMENT_DURATION)
    expect(right.enterBegin).toBe(20)
    expect(right.exitEnd).toBe(20 + MAX_DESIGN_ELEMENT_DURATION)
  })

  it('unrelated patches shorten over-long legacy elements', () => {
    const store = useProjectStore()
    store.doc.duration = 60
    // legacy doc injected without going through addVisual
    store.doc.visuals.push({
      _id: 'vis_legacy',
      type: 'TEXT',
      html: 'x',
      designer: DESIGNER,
      enterBegin: 0,
      exitEnd: 40,
    } as any)
    store.patchVisual('vis_legacy', { x: 100 })
    expect(store.visualById('vis_legacy')!.exitEnd).toBe(MAX_DESIGN_ELEMENT_DURATION)
  })

  it('clamps duplicates of over-long legacy elements', () => {
    const store = useProjectStore()
    store.doc.duration = 60
    store.doc.visuals.push({
      _id: 'vis_legacy2',
      type: 'TEXT',
      html: 'x',
      designer: DESIGNER,
      enterBegin: 0,
      exitEnd: 40,
    } as any)
    const copy = store.duplicateVisual('vis_legacy2')!
    expect(copy.exitEnd).toBe(MAX_DESIGN_ELEMENT_DURATION)
    // the untouched original keeps its window until it is edited
    expect(store.visualById('vis_legacy2')!.exitEnd).toBe(40)
  })

  it('clamps raw-JSON replacements', () => {
    const store = useProjectStore()
    const added = store.addVisual('root', designItem({ enterBegin: 0, exitEnd: 5 }))
    store.replaceVisual(added._id, {
      type: 'TEXT',
      html: 'y',
      designer: DESIGNER,
      enterBegin: 1,
      exitEnd: 50,
    })
    expect(store.visualById(added._id)!.exitEnd).toBe(1 + MAX_DESIGN_ELEMENT_DURATION)
  })

  it('uses the scene duration for open-ended windows inside scenes', () => {
    const store = useProjectStore()
    store.doc.scenes = [
      { _id: 'scn_a', id: 'scene-0', duration: 30, visuals: [], audios: [] } as any,
    ]
    const added = store.addVisual('scn_a', designItem({ enterBegin: 0 }))
    expect(added.exitEnd).toBe(MAX_DESIGN_ELEMENT_DURATION)

    store.doc.scenes.push({
      _id: 'scn_b',
      id: 'scene-1',
      duration: 8,
      visuals: [],
      audios: [],
    } as any)
    const short = store.addVisual('scn_b', designItem({ enterBegin: 0 }))
    expect(short.exitEnd).toBe(8)
  })

  it('caps open-ended windows in auto-duration (-1) scenes', () => {
    const store = useProjectStore()
    store.doc.scenes = [
      { _id: 'scn_auto', id: 'scene-0', duration: -1, visuals: [], audios: [] } as any,
    ]
    const added = store.addVisual('scn_auto', designItem({ enterBegin: 0 }))
    // the real (probe-derived) duration is unknowable here — pin to the ceiling
    expect(added.exitEnd).toBe(MAX_DESIGN_ELEMENT_DURATION)
  })

  it("root context of a scenes project uses the movie total, not the doc default", () => {
    const store = useProjectStore()
    store.doc.duration = 10
    store.doc.scenes = [
      { _id: 's1', id: 'scene-0', duration: 20, visuals: [], audios: [] } as any,
      { _id: 's2', id: 'scene-1', duration: 20, visuals: [], audios: [] } as any,
    ]
    // a root overlay spans the whole 40s movie — open-ended must cap at 15
    const added = store.addVisual('root', designItem({ enterBegin: 0 }))
    expect(added.exitEnd).toBe(MAX_DESIGN_ELEMENT_DURATION)
  })

  it('flatten pins scene-bounded open windows to their OWN scene end', () => {
    const store = useProjectStore()
    store.doc.scenes = [
      {
        _id: 'sA',
        id: 'scene-0',
        duration: 10,
        visuals: [{ _id: 'vis_a', type: 'TEXT', html: 'x', designer: DESIGNER } as any],
        audios: [],
      } as any,
      { _id: 'sB', id: 'scene-1', duration: 10, visuals: [], audios: [] } as any,
    ]
    store.flattenScenes({ sA: 0, sB: 10 })
    // "until end of scene A" must not become "until 15s over scene B"
    expect(store.visualById('vis_a')!.exitEnd).toBe(10)
  })

  it('flatten leaves template-string timing alone', () => {
    const store = useProjectStore()
    store.doc.scenes = [
      { _id: 'sA', id: 'scene-0', duration: 10, visuals: [], audios: [] } as any,
      {
        _id: 'sB',
        id: 'scene-1',
        duration: 10,
        visuals: [
          {
            _id: 'vis_var',
            type: 'TEXT',
            html: 'x',
            designer: DESIGNER,
            enterBegin: '{{start}}',
            exitEnd: '{{end}}',
          } as any,
        ],
        audios: [],
      } as any,
    ]
    store.flattenScenes({ sA: 0, sB: 10 })
    const v = store.visualById('vis_var')!
    expect(v.enterBegin).toBe('{{start}}')
    expect(v.exitEnd).toBe('{{end}}')
  })

  it('splits open-ended visuals inside long scenes (context-aware guard)', () => {
    const store = useProjectStore()
    store.doc.scenes = [
      {
        _id: 'sL',
        id: 'scene-0',
        duration: 30,
        visuals: [{ _id: 'vis_long', type: 'TEXT', text: 'plain' } as any],
        audios: [],
      } as any,
    ]
    const right = store.splitVisualAt('vis_long', 15)
    expect(right).toBeDefined()
    expect(store.visualById('vis_long')!.exitEnd).toBe(15)
    expect(right!.enterBegin).toBe(15)
  })

  it('re-clamps root design overlays when a scene duration grows', () => {
    const store = useProjectStore()
    store.doc.scenes = [
      { _id: 's1', id: 'scene-0', duration: 20, visuals: [], audios: [] } as any,
      { _id: 's2', id: 'scene-1', duration: 20, visuals: [], audios: [] } as any,
    ]
    store.doc.visuals.push({
      _id: 'vis_overlay',
      type: 'TEXT',
      html: 'x',
      designer: DESIGNER,
      enterBegin: 0,
    } as any)
    store.patchScene('s1', { duration: 30 })
    expect(store.visualById('vis_overlay')!.exitEnd).toBe(MAX_DESIGN_ELEMENT_DURATION)
  })

  it('re-clamps root design overlays when scenes are added', () => {
    const store = useProjectStore()
    store.doc.scenes = [
      { _id: 's1', id: 'scene-0', duration: 20, visuals: [], audios: [] } as any,
    ]
    store.doc.visuals.push({
      _id: 'vis_overlay2',
      type: 'TEXT',
      html: 'x',
      designer: DESIGNER,
      enterBegin: 0,
    } as any)
    store.addScene()
    expect(store.visualById('vis_overlay2')!.exitEnd).toBe(MAX_DESIGN_ELEMENT_DURATION)
  })

  it('never adds timing fields to image projects', () => {
    const store = useProjectStore()
    store.doc.type = 'image'
    const added = store.addVisual('root', designItem({ enterBegin: 0, exitEnd: 30 }))
    expect(added.exitEnd).toBeUndefined()
    expect(added.enterBegin).toBeUndefined()
  })
})
