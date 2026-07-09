import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProjectStore } from '../../stores/project'
import { useEditorStore } from '../../stores/editor'
import { usePlayheadJumps } from '../../composables/usePlayheadJumps'

/**
 * Jump-point construction + transport navigation. All modules use explicit
 * imports (no Nuxt auto-imports on these paths), so plain pinia is enough.
 * Media probes stay in 'loading' state under node (no window), which means
 * audio timing resolves without a probed source duration — exactly the
 * fields these tests rely on (enter only).
 */

function stores() {
  return { project: useProjectStore(), editor: useEditorStore() }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('jumpPoints', () => {
  it('an empty flat project has just 0 and the end', () => {
    stores() // default doc: duration 10, no items
    const { jumpPoints } = usePlayheadJumps()
    expect(jumpPoints.value).toEqual([0, 10])
  })

  it('collects visual enterBegins and audio enters, sorted', () => {
    const { project } = stores()
    project.doc.visuals.push(
      { _id: 'v1', type: 'TEXT', text: 'a', enterBegin: 5.5 } as any,
      { _id: 'v2', type: 'TEXT', text: 'b', enterBegin: 2 } as any,
      { _id: 'v3', type: 'TEXT', text: 'c' } as any // default start 0
    )
    project.doc.audios.push(
      { _id: 'a1', enter: 3 } as any,
      { _id: 'a2', src: 'music.mp3', enter: 4 } as any,
      { _id: 'a3' } as any // default enter 0
    )
    const { jumpPoints } = usePlayheadJumps()
    expect(jumpPoints.value).toEqual([0, 2, 3, 4, 5.5, 10])
  })

  it('drops points outside [0, duration]', () => {
    const { project } = stores()
    project.doc.visuals.push(
      { _id: 'v1', type: 'TEXT', text: 'x', enterBegin: 15 } as any,
      { _id: 'v2', type: 'TEXT', text: 'y', enterBegin: -2 } as any,
      { _id: 'v3', type: 'TEXT', text: 'z', enterBegin: 4 } as any
    )
    const { jumpPoints } = usePlayheadJumps()
    expect(jumpPoints.value).toEqual([0, 4, 10])
  })

  it('dedupes sub-millisecond neighbors via round3', () => {
    const { project } = stores()
    project.doc.visuals.push(
      { _id: 'v1', type: 'TEXT', text: 'x', enterBegin: 2 } as any,
      { _id: 'v2', type: 'TEXT', text: 'y', enterBegin: 2.0004 } as any
    )
    const { jumpPoints } = usePlayheadJumps()
    expect(jumpPoints.value).toEqual([0, 2, 10])
  })

  it('root full-preview adds scene block starts', () => {
    const { project } = stores()
    project.doc.scenes = [
      { _id: 's1', id: 'scene-0', duration: 5, visuals: [], audios: [] } as any,
      { _id: 's2', id: 'scene-1', duration: 7, visuals: [], audios: [] } as any,
    ]
    const { jumpPoints } = usePlayheadJumps()
    // total 12 > default duration 10 → context end is the movie total
    expect(jumpPoints.value).toEqual([0, 5, 12])
  })

  it('scene starts respect transition overlaps', () => {
    const { project } = stores()
    project.doc.scenes = [
      {
        _id: 's1',
        id: 'scene-0',
        duration: 5,
        transition: 'fade',
        transitionDuration: 1,
        visuals: [],
        audios: [],
      } as any,
      { _id: 's2', id: 'scene-1', duration: 7, visuals: [], audios: [] } as any,
    ]
    const { jumpPoints } = usePlayheadJumps()
    // second scene starts at 5 - 1 overlap = 4; total 4 + 7 = 11
    expect(jumpPoints.value).toEqual([0, 4, 11])
  })

  it('scene-preview mode "scene" omits scene starts at root', () => {
    const { project, editor } = stores()
    project.doc.scenes = [
      { _id: 's1', id: 'scene-0', duration: 5, visuals: [], audios: [] } as any,
      { _id: 's2', id: 'scene-1', duration: 7, visuals: [], audios: [] } as any,
    ]
    editor.scenePreviewMode = 'scene'
    const { jumpPoints } = usePlayheadJumps()
    // context falls back to the project default duration
    expect(jumpPoints.value).toEqual([0, 10])
  })

  it('inside a scene, points come from THAT scene on its local timeline', () => {
    const { project, editor } = stores()
    project.doc.scenes = [
      { _id: 's1', id: 'scene-0', duration: 5, visuals: [], audios: [] } as any,
      {
        _id: 's2',
        id: 'scene-1',
        duration: 7,
        visuals: [{ _id: 'sv', type: 'TEXT', text: 'x', enterBegin: 1.5 } as any],
        audios: [{ _id: 'sa', enter: 3 } as any],
      } as any,
    ]
    project.doc.visuals.push({ _id: 'rv', type: 'TEXT', text: 'r', enterBegin: 4 } as any)
    editor.context = 's2'
    const { jumpPoints } = usePlayheadJumps()
    // root visual (4) and other scene are not part of this context
    expect(jumpPoints.value).toEqual([0, 1.5, 3, 7])
  })
})

describe('jumpBack / jumpForward', () => {
  function setupFlat() {
    const { project, editor } = stores()
    project.doc.visuals.push(
      { _id: 'v1', type: 'TEXT', text: 'a', enterBegin: 2 } as any,
      { _id: 'v2', type: 'TEXT', text: 'b', enterBegin: 5 } as any
    )
    return { project, editor, jumps: usePlayheadJumps() } // points [0,2,5,10]
  }

  it('jumpForward walks point to point and stops at the end', () => {
    const { editor, jumps } = setupFlat()
    jumps.jumpForward()
    expect(editor.playhead).toBe(2)
    jumps.jumpForward()
    expect(editor.playhead).toBe(5)
    jumps.jumpForward()
    expect(editor.playhead).toBe(10)
    jumps.jumpForward() // already at the last point → stays at the end
    expect(editor.playhead).toBe(10)
  })

  it('jumpBack walks backwards and floors at 0', () => {
    const { editor, jumps } = setupFlat()
    editor.playhead = 10
    jumps.jumpBack()
    expect(editor.playhead).toBe(5)
    jumps.jumpBack()
    expect(editor.playhead).toBe(2)
    jumps.jumpBack()
    expect(editor.playhead).toBe(0)
    jumps.jumpBack()
    expect(editor.playhead).toBe(0)
  })

  it('from between points it goes to the surrounding points', () => {
    const { editor, jumps } = setupFlat()
    editor.playhead = 3.7
    jumps.jumpBack()
    expect(editor.playhead).toBe(2)
    editor.playhead = 3.7
    jumps.jumpForward()
    expect(editor.playhead).toBe(5)
  })

  it('a playhead within half a frame of a point steps past it', () => {
    // eps = 0.5 / 30fps ≈ 0.0167
    const { editor, jumps } = setupFlat()
    editor.playhead = 5.005 // "on" 5
    jumps.jumpBack()
    expect(editor.playhead).toBe(2)
    editor.playhead = 4.995 // "on" 5 from the left
    jumps.jumpForward()
    expect(editor.playhead).toBe(10)
  })

  it('just outside the half-frame tolerance the point is a real stop', () => {
    const { editor, jumps } = setupFlat()
    editor.playhead = 5.02 // 5 < 5.02 - eps(0.0167)
    jumps.jumpBack()
    expect(editor.playhead).toBe(5)
    editor.playhead = 4.98
    jumps.jumpForward()
    expect(editor.playhead).toBe(5)
  })

  it('the epsilon scales with the project frame rate', () => {
    const { project, editor } = stores()
    project.doc.frameRate = 10 // eps = 0.05
    project.doc.visuals.push({ _id: 'v', type: 'TEXT', text: 'x', enterBegin: 5 } as any)
    const jumps = usePlayheadJumps()
    editor.playhead = 5.04 // within 0.05 of 5 → step past
    jumps.jumpBack()
    expect(editor.playhead).toBe(0)
    editor.playhead = 5.06 // outside → 5 is a stop
    jumps.jumpBack()
    expect(editor.playhead).toBe(5)
  })
})
