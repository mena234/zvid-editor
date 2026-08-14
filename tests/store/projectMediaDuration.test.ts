import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectStore } from '../../stores/project'
import { computeSceneAutoDuration } from '../../shared/schema/scenePlan'

describe('project store — media duration growth', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('adds a video and extends a flat project in one undo step', () => {
    const store = useProjectStore()
    store.doc.duration = 5
    store.resetHistory()

    const video = store.addVisual(
      'root',
      {
        type: 'VIDEO',
        src: 'clip.mp4',
        enterBegin: 3,
        exitEnd: 11,
      },
      { extendDurationTo: 11, currentDuration: 5 }
    )

    expect(video.exitEnd).toBe(11)
    expect(store.doc.duration).toBe(11)
    expect(store.doc.visuals).toHaveLength(1)

    store.undo()
    expect(store.doc.duration).toBe(5)
    expect(store.doc.visuals).toHaveLength(0)
  })

  it('never shortens an already longer project', () => {
    const store = useProjectStore()
    store.doc.duration = 20
    store.addVisual(
      'root',
      { type: 'VIDEO', src: 'clip.mp4', exitEnd: 8 },
      { extendDurationTo: 8, currentDuration: 20 }
    )
    expect(store.doc.duration).toBe(20)
  })

  it('adds audio and extends an explicit scene in one undo step', () => {
    const store = useProjectStore()
    store.doc.scenes = [
      {
        _id: 'scn_1',
        id: 'scene-1',
        duration: 5,
        visuals: [],
        audios: [],
      } as any,
    ]
    store.resetHistory()

    const audio = store.addAudio(
      'scn_1',
      {
        src: 'track.mp3',
        enter: 3,
        exit: 11,
        audioEnd: 8,
      },
      { extendDurationTo: 11, currentDuration: 5 }
    )

    expect(audio.enter).toBe(3)
    expect(audio.exit).toBe(11)
    expect(store.doc.scenes![0].duration).toBe(11)

    store.undo()
    expect(store.doc.scenes![0].duration).toBe(5)
    expect(store.doc.scenes![0].audios).toHaveLength(0)
  })

  it('preserves auto scene mode while explicit media ends grow its derived duration', () => {
    const store = useProjectStore()
    store.doc.scenes = [
      {
        _id: 'scn_auto',
        id: 'scene-auto',
        duration: -1,
        visuals: [],
        audios: [],
      } as any,
    ]

    store.addVisual(
      'scn_auto',
      { type: 'VIDEO', src: 'clip.mp4', enterBegin: 2, exitEnd: 12 },
      { extendDurationTo: 12, currentDuration: 5 }
    )
    store.addAudio(
      'scn_auto',
      { src: 'track.mp3', enter: 5, exit: 15, audioEnd: 10 },
      { extendDurationTo: 15, currentDuration: 12 }
    )

    const scene = store.doc.scenes![0]
    expect(scene.duration).toBe(-1)
    expect(computeSceneAutoDuration(scene, () => undefined)).toBe(15)
  })

  it('raises a root duration variable without replacing its template binding', () => {
    const store = useProjectStore()
    ;(store.doc as any).duration = '{{projectLength}}'
    store.doc.extra = { variables: { projectLength: 5 } }
    store.resetHistory()

    store.addVisual(
      'root',
      { type: 'VIDEO', src: 'clip.mp4', enterBegin: 3, exitEnd: 8 },
      // Raw template fields fall back to the editor's 10s default while the
      // variables preview is off. The scoped 5s default must still win.
      { extendDurationTo: 8, currentDuration: 10 }
    )

    expect((store.doc as any).duration).toBe('{{projectLength}}')
    expect(store.doc.extra.variables.projectLength).toBe(8)

    store.undo()
    expect((store.doc as any).duration).toBe('{{projectLength}}')
    expect(store.doc.extra!.variables.projectLength).toBe(5)
    expect(store.doc.visuals).toHaveLength(0)
  })

  it('does not overwrite a non-numeric duration-variable default', () => {
    const store = useProjectStore()
    ;(store.doc as any).duration = '{{projectLength}}'
    store.doc.extra = { variables: { projectLength: '{{fallbackLength}}' } }

    store.addVisual(
      'root',
      { type: 'VIDEO', src: 'clip.mp4', enterBegin: 3, exitEnd: 11 },
      { extendDurationTo: 11, currentDuration: 5 }
    )

    expect((store.doc as any).duration).toBe('{{projectLength}}')
    expect(store.doc.extra.variables.projectLength).toBe('{{fallbackLength}}')
  })

  it('raises the scoped scene duration variable and keeps one-step undo', () => {
    const store = useProjectStore()
    store.doc.extra = { variables: { sceneLength: 20 } }
    store.doc.scenes = [
      {
        _id: 'scn_template',
        id: 'scene-template',
        duration: '{{sceneLength}}',
        variables: { sceneLength: 5 },
        visuals: [],
        audios: [],
      } as any,
    ]
    store.resetHistory()

    store.addAudio(
      'scn_template',
      { src: 'track.mp3', enter: 3, exit: 11, audioEnd: 8 },
      { extendDurationTo: 11, currentDuration: 5 }
    )

    const scene = store.doc.scenes![0] as any
    expect(scene.duration).toBe('{{sceneLength}}')
    expect(scene.variables.sceneLength).toBe(11)
    expect(store.doc.extra.variables.sceneLength).toBe(20)

    store.undo()
    expect((store.doc.scenes![0] as any).variables.sceneLength).toBe(5)
    expect(store.doc.scenes![0].audios).toHaveLength(0)
  })

  it('re-evaluates root design timing after an auto scene grows', () => {
    const store = useProjectStore()
    store.doc.visuals = [
      {
        _id: 'vis_root_design',
        type: 'TEXT',
        html: 'overlay',
        designer: { layers: [] },
      } as any,
    ]
    store.doc.scenes = [
      {
        _id: 'scn_auto',
        id: 'scene-auto',
        duration: -1,
        visuals: [],
        audios: [],
      } as any,
    ]

    store.addVisual(
      'scn_auto',
      { type: 'VIDEO', src: 'clip.mp4', enterBegin: 2, exitEnd: 12 },
      { extendDurationTo: 12, currentDuration: 5 }
    )

    expect(store.doc.visuals[0].exitEnd).toBe(12)
    expect(store.doc.scenes![0].duration).toBe(-1)
  })
})
