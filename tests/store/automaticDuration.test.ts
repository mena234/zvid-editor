import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectStore } from '../../stores/project'
import { useRenderPayload } from '../../composables/useRenderPayload'
import { useMediaProbe } from '../../composables/useMediaProbe'
import {
  buildScenePlan,
  projectContentDuration,
  projectTotalDuration,
} from '../../shared/schema/scenePlan'
import { resolveAudioTiming } from '../../shared/schema/defaults'

const noProbe = () => undefined
describe('automatic project timing', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useMediaProbe().cache.clear()
  })
  const length = () => projectTotalDuration(useProjectStore().doc, noProbe)

  it('starts automatic, follows three scenes, transitions and deletion, with atomic undo', () => {
    const p = useProjectStore()
    expect(p.doc.durationMode).toBe('auto')
    expect(p.doc.duration).toBeUndefined()
    for (let i = 0; i < 3; i++) p.patchScene(p.addScene()._id, { duration: 5 })
    expect(length()).toBe(15)
    p.patchScene(p.doc.scenes![0]._id, {
      transition: 'fade',
      transitionDuration: 1,
    })
    expect(length()).toBe(14)
    p.removeScene(p.doc.scenes![2]._id)
    expect(length()).toBe(9)
    p.undo()
    expect(length()).toBe(14)
    p.redo()
    expect(length()).toBe(9)
  })

  it('follows trimmed media and preserves until-end overlays without a circular floor', () => {
    const p = useProjectStore()
    p.addVisual('root', { type: 'TEXT', text: 'Logo' })
    const v = p.addVisual('root', {
      type: 'VIDEO',
      src: 'clip.mp4',
      videoEnd: 15,
      exitEnd: 15,
    })
    expect(length()).toBe(15)
    p.patchVisual(v._id, { speed: 3 })
    expect(length()).toBe(5)
    p.patchVisual(v._id, { videoBegin: 3 })
    expect(length()).toBe(4)
    expect(p.doc.duration).toBeUndefined()
  })

  it('grows auto scenes and shifts later scenes, while set lengths remain set', () => {
    const p = useProjectStore()
    const a = p.addScene()
    const b = p.addScene()
    p.patchScene(b._id, { duration: 5 })
    const v = p.addVisual(a._id, { type: 'TEXT', text: 'Title', exitEnd: 5 })
    p.patchVisual(v._id, { exitEnd: 8 })
    expect(length()).toBe(13)
    expect(buildScenePlan(p.doc, noProbe).entries[1].start).toBe(8)
    p.addVisual(
      b._id,
      { type: 'VIDEO', src: 'clip.mp4', exitEnd: 12 },
      { extendDurationTo: 12 }
    )
    expect(b.duration).toBe(5)
    expect(length()).toBe(13)
  })

  it('includes caption/global ends, minimum length, and music that follows the project', () => {
    const p = useProjectStore()
    p.patchScene(p.addScene()._id, { duration: 5 })
    p.patchProject({
      subtitle: { captions: [{ start: 5, end: 7, text: 'End', words: [] }] },
    })
    const audio = p.addAudio('root', {
      src: 'music.mp3',
      audioEnd: 120,
      matchDuration: true,
    })
    expect(length()).toBe(7)
    expect(resolveAudioTiming(audio, 7, 120).exit).toBe(7)
    p.patchProject({ duration: 20 })
    expect(length()).toBe(20)
    expect(projectContentDuration(p.doc, noProbe)).toBe(7)
    p.patchProject({ duration: undefined })
    expect(length()).toBe(7)
    p.patchAudio(audio._id, { exit: 12 })
    expect(length()).toBe(12)
  })

  it('round-trips auto mode and minimum without baking the computed end into the document', () => {
    const p = useProjectStore()
    p.patchProject({ duration: 4 })
    p.addVisual('root', { type: 'TEXT', text: 'Title', exitEnd: 15 })
    const exported = p.exportRaw()
    p.loadRaw(exported)
    expect(length()).toBe(15)
    expect(p.doc.duration).toBe(4)
    p.patchVisual(p.doc.visuals[0]._id, { exitEnd: 2 })
    expect(length()).toBe(4)
    p.loadRaw({
      duration: 10,
      visuals: [{ type: 'TEXT', text: 'Legacy', exitEnd: 15 }],
    })
    expect(length()).toBe(10)
  })

  it('freezes a render after probing and keeps the saved auto document unchanged', () => {
    const p = useProjectStore()
    p.addVisual('root', {
      type: 'VIDEO',
      src: 'clip.mp4',
      videoBegin: 2,
      speed: 2,
    })
    p.addAudio('root', { src: 'music.mp3', matchDuration: true })
    const payload = useRenderPayload()
    expect(() => payload()).toThrow(/length is not available/)
    useMediaProbe().cache.set('video:clip.mp4', {
      kind: 'video',
      status: 'ok',
      duration: 12,
    })
    expect(payload().duration).toBe(5)
    expect(payload().audios[0].exit).toBe(5)
    expect(payload().durationMode).toBeUndefined()
    expect(p.doc.duration).toBeUndefined()
    expect(p.doc.audios[0].matchDuration).toBe(true)
  })

  it('resolves template scene lengths and repeated scenes for render', () => {
    const p = useProjectStore()
    p.loadRaw({
      durationMode: 'auto',
      variables: { seconds: 5 },
      scenes: [
        { id: 'first', duration: '{{seconds}}' },
        { id: 'second', duration: 10 },
      ],
    })
    expect(useRenderPayload()().duration).toBe(15)
    expect(p.exportRaw().scenes[0].duration).toBe('{{seconds}}')
  })
})
