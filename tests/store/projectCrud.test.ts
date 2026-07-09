import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProjectStore } from '../../stores/project'
import { useEditorStore } from '../../stores/editor'

/**
 * CRUD + getter coverage for stores/project.ts. The lane allocator
 * (nextFreeTrack) is module-local to project.ts, so the omitted-track path
 * can be exercised directly — it only reads editor.extra*Tracks.
 */

function textItem(extra: Record<string, any> = {}) {
  return { type: 'TEXT', text: 'hi', ...extra }
}

describe('project store — add', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('addVisual keeps an explicit track and assigns a vis-prefixed _id', () => {
    const store = useProjectStore()
    const added = store.addVisual('root', textItem({ track: 3 }))
    expect(added._id).toMatch(/^vis_/)
    expect(added.track).toBe(3)
    expect(store.doc.visuals).toHaveLength(1)
  })

  it('addVisual auto-allocates lanes when track is omitted', () => {
    const store = useProjectStore()
    // lane 0 is free — nextFreeTrack returns 0, which is left implicit
    const first = store.addVisual('root', textItem())
    expect(first.track).toBeUndefined()
    // lane 0 occupied, no extra lanes — a fresh lane above the topmost
    const second = store.addVisual('root', textItem())
    expect(second.track).toBe(1)
    const third = store.addVisual('root', textItem())
    expect(third.track).toBe(2)
  })

  it('addVisual fills manually added empty lanes first', () => {
    const store = useProjectStore()
    const editor = useEditorStore()
    editor.extraVisualTracks = [1, 2]
    store.addVisual('root', textItem()) // lane 0 (implicit)
    const a = store.addVisual('root', textItem())
    expect(a.track).toBe(1) // lowest empty visible lane
    const b = store.addVisual('root', textItem())
    expect(b.track).toBe(2)
    const c = store.addVisual('root', textItem())
    expect(c.track).toBe(3) // all visible lanes full → above topmost
  })

  it('addVisual targets a scene context', () => {
    const store = useProjectStore()
    store.doc.scenes = [
      { _id: 'scn_1', id: 'scene-0', duration: 5, visuals: [], audios: [] } as any,
    ]
    const added = store.addVisual('scn_1', textItem({ track: 0 }))
    expect(store.doc.visuals).toHaveLength(0)
    expect(store.doc.scenes![0].visuals[0]._id).toBe(added._id)
  })

  it('addAudio auto-allocates audio lanes independently', () => {
    const store = useProjectStore()
    const editor = useEditorStore()
    editor.extraAudioTracks = [1]
    const first = store.addAudio('root', { src: 'a.mp3' })
    expect(first._id).toMatch(/^aud_/)
    expect(first.track).toBeUndefined() // lane 0
    const second = store.addAudio('root', { src: 'b.mp3' })
    expect(second.track).toBe(1)
    const third = store.addAudio('root', { src: 'c.mp3' })
    expect(third.track).toBe(2)
    expect(store.doc.audios).toHaveLength(3)
  })
})

describe('project store — patch/remove/duplicate/replace', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('patchVisual sets values and deletes keys patched to undefined', () => {
    const store = useProjectStore()
    const v = store.addVisual('root', textItem({ track: 0, opacity: 0.5 }))
    store.patchVisual(v._id, { x: 10, opacity: undefined })
    const got = store.visualById(v._id)!
    expect(got.x).toBe(10)
    expect('opacity' in got).toBe(false)
  })

  it('patchVisual/patchAudio are no-ops for unknown ids', () => {
    const store = useProjectStore()
    expect(() => store.patchVisual('nope', { x: 1 })).not.toThrow()
    expect(() => store.patchAudio('nope', { volume: 0.2 })).not.toThrow()
  })

  it('patchVisual reaches visuals inside scenes', () => {
    const store = useProjectStore()
    store.doc.scenes = [
      {
        _id: 'scn_1',
        id: 'scene-0',
        duration: 5,
        visuals: [{ _id: 'vis_s', type: 'TEXT', text: 'x' } as any],
        audios: [],
      } as any,
    ]
    store.patchVisual('vis_s', { y: 7 })
    expect(store.doc.scenes![0].visuals[0].y).toBe(7)
  })

  it('patchAudio sets and deletes fields', () => {
    const store = useProjectStore()
    const a = store.addAudio('root', { src: 'a.mp3', track: 0, volume: 0.4 })
    store.patchAudio(a._id, { speed: 2, volume: undefined })
    const got = store.audioById(a._id)!
    expect(got.speed).toBe(2)
    expect('volume' in got).toBe(false)
  })

  it('removeVisual removes from root and from scenes', () => {
    const store = useProjectStore()
    const v = store.addVisual('root', textItem({ track: 0 }))
    store.doc.scenes = [
      {
        _id: 'scn_1',
        id: 'scene-0',
        duration: 5,
        visuals: [{ _id: 'vis_s', type: 'TEXT', text: 'x' } as any],
        audios: [],
      } as any,
    ]
    store.removeVisual(v._id)
    expect(store.doc.visuals).toHaveLength(0)
    store.removeVisual('vis_s')
    expect(store.doc.scenes![0].visuals).toHaveLength(0)
    expect(() => store.removeVisual('missing')).not.toThrow()
  })

  it('removeAudio removes from root and from scenes', () => {
    const store = useProjectStore()
    const a = store.addAudio('root', { src: 'a.mp3', track: 0 })
    store.doc.scenes = [
      {
        _id: 'scn_1',
        id: 'scene-0',
        duration: 5,
        visuals: [],
        audios: [{ _id: 'aud_s', src: 's.mp3' } as any],
      } as any,
    ]
    store.removeAudio(a._id)
    expect(store.doc.audios).toHaveLength(0)
    store.removeAudio('aud_s')
    expect(store.doc.scenes![0].audios).toHaveLength(0)
  })

  it('duplicateVisual offsets by 24px, renames id with -copy and mints a new _id', () => {
    const store = useProjectStore()
    const v = store.addVisual(
      'root',
      textItem({ track: 0, id: 'title', x: 100, y: 50 })
    )
    const copy = store.duplicateVisual(v._id)!
    expect(copy._id).not.toBe(v._id)
    expect(copy.id).toBe('title-copy')
    expect(copy.x).toBe(124)
    expect(copy.y).toBe(74)
    expect(store.doc.visuals).toHaveLength(2)
  })

  it('duplicateVisual treats missing x/y as 0 and converts position presets to custom', () => {
    const store = useProjectStore()
    const v = store.addVisual(
      'root',
      textItem({ track: 0, position: 'center-center' })
    )
    const copy = store.duplicateVisual(v._id)!
    expect(copy.x).toBe(24)
    expect(copy.y).toBe(24)
    expect(copy.position).toBe('custom')
    expect(copy.anchor).toBe('center-center')
  })

  it('duplicateVisual duplicates into the owning scene; unknown id returns undefined', () => {
    const store = useProjectStore()
    store.doc.scenes = [
      {
        _id: 'scn_1',
        id: 'scene-0',
        duration: 5,
        visuals: [{ _id: 'vis_s', type: 'TEXT', text: 'x' } as any],
        audios: [],
      } as any,
    ]
    const copy = store.duplicateVisual('vis_s')!
    expect(store.doc.scenes![0].visuals).toHaveLength(2)
    expect(store.doc.visuals).toHaveLength(0)
    expect(copy._id).not.toBe('vis_s')
    expect(store.duplicateVisual('missing')).toBeUndefined()
  })

  it('replaceVisual swaps content wholesale but keeps the _id', () => {
    const store = useProjectStore()
    const v = store.addVisual('root', textItem({ track: 0, opacity: 0.5 }))
    store.replaceVisual(v._id, { type: 'IMAGE', src: 'pic.png' })
    const got = store.visualById(v._id)!
    expect(got._id).toBe(v._id)
    expect(got.type).toBe('IMAGE')
    expect((got as any).src).toBe('pic.png')
    // old fields are gone — it is a replacement, not a merge
    expect('text' in got).toBe(false)
    expect('opacity' in got).toBe(false)
  })

  it('replaceVisual works inside scenes', () => {
    const store = useProjectStore()
    store.doc.scenes = [
      {
        _id: 'scn_1',
        id: 'scene-0',
        duration: 5,
        visuals: [{ _id: 'vis_s', type: 'TEXT', text: 'x' } as any],
        audios: [],
      } as any,
    ]
    store.replaceVisual('vis_s', { type: 'TEXT', text: 'replaced' })
    expect(store.doc.scenes![0].visuals[0].text).toBe('replaced')
    expect(store.doc.scenes![0].visuals[0]._id).toBe('vis_s')
  })
})

describe('project store — image projects strip time-domain fields', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('addVisual drops every IMAGE_STRIPPED_ITEM_FIELDS key', () => {
    const store = useProjectStore()
    store.doc.type = 'image'
    const added = store.addVisual('root', {
      type: 'VIDEO',
      src: 'v.mp4',
      x: 5,
      enterBegin: 0,
      enterEnd: 1,
      exitBegin: 4,
      exitEnd: 5,
      enterAnimation: 'fade',
      exitAnimation: 'fade',
      transition: 'wipe',
      transitionId: 'next',
      transitionDuration: 0.5,
      videoBegin: 1,
      videoEnd: 2,
      videoDuration: 1,
      volume: 0.5,
      speed: 2,
    })
    for (const k of [
      'enterBegin',
      'enterEnd',
      'exitBegin',
      'exitEnd',
      'enterAnimation',
      'exitAnimation',
      'transition',
      'transitionId',
      'transitionDuration',
      'videoBegin',
      'videoEnd',
      'videoDuration',
      'volume',
      'speed',
    ]) {
      expect(k in (added as any), k).toBe(false)
    }
    // non-time-domain fields survive
    expect((added as any).src).toBe('v.mp4')
    expect(added.x).toBe(5)
  })

  it('addAudio on an image project returns a detached doc (nothing attached)', () => {
    const store = useProjectStore()
    store.doc.type = 'image'
    const a = store.addAudio('root', { src: 'a.mp3' })
    expect(a._id).toMatch(/^aud_/)
    expect(store.doc.audios).toHaveLength(0)
  })
})

describe('project store — getters', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function seedScenes(store: ReturnType<typeof useProjectStore>) {
    store.doc.scenes = [
      {
        _id: 'scn_1',
        id: 'scene-0',
        duration: 20,
        visuals: [{ _id: 'vis_s', type: 'TEXT', text: 'x' } as any],
        audios: [{ _id: 'aud_s', src: 's.mp3' } as any],
      } as any,
      { _id: 'scn_2', id: 'scene-1', duration: -1, visuals: [], audios: [] } as any,
    ]
  }

  it('visualById/audioById find root and scene items, else undefined', () => {
    const store = useProjectStore()
    const v = store.addVisual('root', textItem({ track: 0 }))
    const a = store.addAudio('root', { src: 'a.mp3', track: 0 })
    seedScenes(store)
    expect(store.visualById(v._id)?._id).toBe(v._id)
    expect(store.visualById('vis_s')?._id).toBe('vis_s')
    expect(store.visualById('missing')).toBeUndefined()
    expect(store.audioById(a._id)?._id).toBe(a._id)
    expect(store.audioById('aud_s')?._id).toBe('aud_s')
    expect(store.audioById('missing')).toBeUndefined()
  })

  it('contextOfVisual reports the owning scene, root otherwise', () => {
    const store = useProjectStore()
    const v = store.addVisual('root', textItem({ track: 0 }))
    seedScenes(store)
    expect(store.contextOfVisual('vis_s')).toBe('scn_1')
    expect(store.contextOfVisual(v._id)).toBe('root')
    // unknown ids also fall back to root
    expect(store.contextOfVisual('missing')).toBe('root')
  })

  it('contextDurationOf: flat root uses the resolved project duration', () => {
    const store = useProjectStore()
    expect(store.contextDurationOf('root')).toBe(10) // newProjectDoc default
    store.doc.duration = 25
    expect(store.contextDurationOf('root')).toBe(25)
    delete store.doc.duration
    expect(store.contextDurationOf('root')).toBe(10) // PROJECT_DEFAULTS.duration
  })

  it('contextDurationOf: scene contexts use the scene duration, -1 when unknowable', () => {
    const store = useProjectStore()
    seedScenes(store)
    expect(store.contextDurationOf('scn_1')).toBe(20)
    expect(store.contextDurationOf('scn_2')).toBe(-1) // auto duration
  })

  it('contextDurationOf: root of a scenes project sums scenes (default for auto ones)', () => {
    const store = useProjectStore()
    seedScenes(store)
    // 20 + DEFAULT_SCENE_DURATION(10) = 30 > base 10
    expect(store.contextDurationOf('root')).toBe(30)
    store.doc.duration = 99 // base wins when larger
    expect(store.contextDurationOf('root')).toBe(99)
  })
})
