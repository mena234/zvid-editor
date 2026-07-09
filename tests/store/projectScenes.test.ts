import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProjectStore } from '../../stores/project'

/**
 * Scenes lifecycle (add/remove/move/patch, transition-chain reconciliation,
 * convertToScenes, unique scene ids) and template-variable management of
 * stores/project.ts.
 */

function scene(over: Record<string, any> = {}) {
  return {
    _id: over._id ?? `scn_${Math.random().toString(36).slice(2, 8)}`,
    id: over.id ?? 'scene-x',
    duration: 5,
    visuals: [],
    audios: [],
    ...over,
  } as any
}

describe('project store — scenes', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('addScene creates the scenes array with a sequential id and 5s duration', () => {
    const store = useProjectStore()
    expect(store.hasScenes).toBe(false)
    const s0 = store.addScene()
    expect(store.hasScenes).toBe(true)
    expect(s0.id).toBe('scene-0')
    expect(s0.duration).toBe(5)
    expect(s0._id).toMatch(/^scn_/)
    const s1 = store.addScene()
    expect(s1.id).toBe('scene-1')
    expect(store.doc.scenes!.map((s) => s.id)).toEqual(['scene-0', 'scene-1'])
  })

  it('addScene(afterIndex) inserts after the given scene', () => {
    const store = useProjectStore()
    const a = store.addScene()
    const b = store.addScene()
    const mid = store.addScene(0)
    expect(store.doc.scenes!.map((s) => s._id)).toEqual([a._id, mid._id, b._id])
  })

  it('uniqueSceneId skips ids already in use', () => {
    const store = useProjectStore()
    store.doc.scenes = [scene({ _id: 'scn_a', id: 'scene-1' })]
    const added = store.addScene()
    // length is 1 → candidate scene-1 is taken → bumps to scene-2
    expect(added.id).toBe('scene-2')
  })

  it('removeScene deletes the scene and drops the array when the last one goes', () => {
    const store = useProjectStore()
    const a = store.addScene()
    const b = store.addScene()
    store.removeScene(a._id)
    expect(store.doc.scenes!.map((s) => s._id)).toEqual([b._id])
    store.removeScene(b._id)
    expect(store.doc.scenes).toBeUndefined()
    expect(store.hasScenes).toBe(false)
  })

  it('moveScene reorders; out-of-range or unknown moves are no-ops', () => {
    const store = useProjectStore()
    const a = store.addScene()
    const b = store.addScene()
    const c = store.addScene()
    store.moveScene(c._id, -1)
    expect(store.doc.scenes!.map((s) => s._id)).toEqual([a._id, c._id, b._id])
    store.moveScene(a._id, -1) // already first
    expect(store.doc.scenes!.map((s) => s._id)).toEqual([a._id, c._id, b._id])
    store.moveScene(b._id, 1) // already last
    expect(store.doc.scenes!.map((s) => s._id)).toEqual([a._id, c._id, b._id])
    store.moveScene('missing', 1)
    expect(store.doc.scenes!.map((s) => s._id)).toEqual([a._id, c._id, b._id])
  })

  it('reconcileSceneTransitions points every transitionId at the next scene', () => {
    const store = useProjectStore()
    store.doc.scenes = [
      scene({ _id: 'sA', id: 'scene-0', transition: 'fade' }),
      scene({ _id: 'sB', id: 'scene-1', transition: 'wipeleft' }),
      scene({ _id: 'sC', id: 'scene-2' }),
    ]
    store.reconcileSceneTransitions()
    const [a, b, c] = store.doc.scenes!
    expect(a.transitionId).toBe('scene-1')
    expect(b.transitionId).toBe('scene-2')
    expect('transitionId' in c).toBe(false)
  })

  it('a trailing transition is deleted outright (nothing to transition into)', () => {
    const store = useProjectStore()
    store.doc.scenes = [
      scene({ _id: 'sA', id: 'scene-0' }),
      scene({
        _id: 'sB',
        id: 'scene-1',
        transition: 'fade',
        transitionId: 'stale',
        transitionDuration: 0.7,
      }),
    ]
    store.reconcileSceneTransitions()
    const b = store.doc.scenes![1]
    expect('transition' in b).toBe(false)
    expect('transitionId' in b).toBe(false)
    expect('transitionDuration' in b).toBe(false)
  })

  it('moveScene re-chains transitions after the reorder', () => {
    const store = useProjectStore()
    store.doc.scenes = [
      scene({ _id: 'sA', id: 'scene-0', transition: 'fade' }),
      scene({ _id: 'sB', id: 'scene-1' }),
      scene({ _id: 'sC', id: 'scene-2' }),
    ]
    store.reconcileSceneTransitions()
    expect(store.doc.scenes![0].transitionId).toBe('scene-1')
    // A jumps to the middle: its transition now targets C
    store.moveScene('sA', 1)
    const a = store.doc.scenes!.find((s) => s._id === 'sA')!
    expect(a.transitionId).toBe('scene-2')
    // A jumps to the end: its transition disappears
    store.moveScene('sA', 1)
    expect('transition' in store.doc.scenes![2]).toBe(false)
    expect('transitionId' in store.doc.scenes![2]).toBe(false)
  })

  it('removeScene re-chains the surviving scenes', () => {
    const store = useProjectStore()
    store.doc.scenes = [
      scene({ _id: 'sA', id: 'scene-0', transition: 'fade' }),
      scene({ _id: 'sB', id: 'scene-1' }),
      scene({ _id: 'sC', id: 'scene-2' }),
    ]
    store.reconcileSceneTransitions()
    store.removeScene('sB')
    expect(store.doc.scenes![0].transitionId).toBe('scene-2')
  })

  it('patchScene sets/deletes fields and reconciles on transition or id patches', () => {
    const store = useProjectStore()
    store.doc.scenes = [
      scene({ _id: 'sA', id: 'scene-0' }),
      scene({ _id: 'sB', id: 'scene-1' }),
    ]
    store.patchScene('sA', { transition: 'fade' })
    expect(store.doc.scenes![0].transitionId).toBe('scene-1')

    // renaming the target scene re-points the chain
    store.patchScene('sB', { id: 'outro' })
    expect(store.doc.scenes![0].transitionId).toBe('outro')

    store.patchScene('sA', { backgroundColor: '#fff' })
    expect(store.doc.scenes![0].backgroundColor).toBe('#fff')
    store.patchScene('sA', { backgroundColor: undefined })
    expect('backgroundColor' in store.doc.scenes![0]).toBe(false)

    expect(() => store.patchScene('missing', { duration: 9 })).not.toThrow()
  })

  it('convertToScenes wraps the flat timeline into a single scene', () => {
    const store = useProjectStore()
    store.doc.duration = 25
    const v = store.addVisual('root', { type: 'TEXT', text: 'x', track: 0 })
    const a = store.addAudio('root', { src: 'a.mp3', track: 0 })
    store.convertToScenes()
    expect(store.doc.visuals).toHaveLength(0)
    expect(store.doc.audios).toHaveLength(0)
    const s = store.doc.scenes![0]
    expect(s.id).toBe('scene-0')
    expect(s.duration).toBe(25)
    expect(s.visuals[0]._id).toBe(v._id)
    expect(s.audios[0]._id).toBe(a._id)
  })

  it('convertToScenes defaults the scene duration to 10 and is a no-op when scenes exist', () => {
    const store = useProjectStore()
    delete store.doc.duration
    store.convertToScenes()
    expect(store.doc.scenes![0].duration).toBe(10)
    const before = store.doc.scenes!.length
    store.convertToScenes()
    expect(store.doc.scenes!.length).toBe(before)
  })
})

describe('project store — template variables', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('variables getter returns {} until variables exist (and for non-object shapes)', () => {
    const store = useProjectStore()
    expect(store.variables).toEqual({})
    store.doc.extra = { variables: ['not', 'an', 'object'] as any }
    expect(store.variables).toEqual({})
  })

  it('setVariable creates extra.variables lazily and sets values', () => {
    const store = useProjectStore()
    store.setVariable('title', 'Hello')
    expect(store.doc.extra!.variables).toEqual({ title: 'Hello' })
    store.setVariable('count', 3)
    expect(store.variables).toEqual({ title: 'Hello', count: 3 })
    // an array in the slot is replaced by a fresh object
    store.doc.extra!.variables = ['bad'] as any
    store.setVariable('x', 1)
    expect(store.doc.extra!.variables).toEqual({ x: 1 })
  })

  it('renameVariable rebuilds the map preserving declaration order', () => {
    const store = useProjectStore()
    store.setVariable('a', 1)
    store.setVariable('b', 2)
    store.setVariable('c', 3)
    store.renameVariable('b', 'middle')
    const vars = store.doc.extra!.variables as Record<string, unknown>
    expect(Object.keys(vars)).toEqual(['a', 'middle', 'c'])
    expect(vars.middle).toBe(2)
  })

  it('renameVariable guards: missing old, identical name, existing target', () => {
    const store = useProjectStore()
    store.setVariable('a', 1)
    store.setVariable('b', 2)
    store.renameVariable('zzz', 'q') // old missing
    store.renameVariable('a', 'a') // same name
    store.renameVariable('a', 'b') // target exists — would clobber b
    expect(store.doc.extra!.variables).toEqual({ a: 1, b: 2 })
  })

  it('removeVariable deletes and cleans up empty containers', () => {
    const store = useProjectStore()
    store.setVariable('a', 1)
    store.setVariable('b', 2)
    store.removeVariable('a')
    expect(store.variables).toEqual({ b: 2 })
    store.removeVariable('b')
    expect(store.doc.extra).toBeUndefined() // variables and extra both cleaned
    expect(() => store.removeVariable('ghost')).not.toThrow()
  })

  it('removeVariable keeps extra when it still holds other passthrough keys', () => {
    const store = useProjectStore()
    store.doc.extra = { webhookUrl: 'https://x', variables: { a: 1 } }
    store.removeVariable('a')
    expect(store.doc.extra).toEqual({ webhookUrl: 'https://x' })
  })
})
